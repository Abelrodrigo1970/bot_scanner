/**
 * Regras de trading para o bot Volume Spike.
 * Fase 2: apenas lógica, sem ordens reais.
 */

import { getPositionSizeUsdt } from './binanceConfig';

export interface SignalForTrading {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  target1: number | null;
  target2: number | null;
  target3: number | null;
  strength: number;
  strategyName: string;
  status: string;
  /** Exchange onde executar: 'binance' | 'bybit'. Sobrepõe a variável EXCHANGE global. */
  exchange?: 'binance' | 'bybit';
}

/** Estratégias permitidas para trading automático */
const ALLOWED_STRATEGIES = [
  'Volume Spike',
  'Volume Spike 1h',
  '15MVolume',
  'MA Cross Top Voláteis',
  'MA200 Top Voláteis',
  'MA_VOLATILE',
  'MA200_VOLATILE',
  'RSI Top Volatilidade',
  'RSI 15m Top Volatilidade',
  'RSI_15M',
  'RSI',
];

/** Força mínima para executar */
const MIN_STRENGTH = 60;

/** Status que permite execução */
const EXECUTABLE_STATUS = 'NEW';

/**
 * Verifica se um sinal pode ser executado.
 */
export function canExecuteSignal(signal: SignalForTrading): { ok: boolean; reason?: string } {
  if (signal.status !== EXECUTABLE_STATUS) {
    return { ok: false, reason: `Status inválido: ${signal.status} (requer NEW)` };
  }

  if (signal.strength < MIN_STRENGTH) {
    return { ok: false, reason: `Força ${signal.strength} < ${MIN_STRENGTH}` };
  }

  const normalizedName = (signal.strategyName || '').toLowerCase();
  const isAllowed = ALLOWED_STRATEGIES.some((s) => normalizedName.includes(s.toLowerCase()));
  if (!isAllowed) {
    return { ok: false, reason: `Estratégia não permitida: ${signal.strategyName}` };
  }

  if (!signal.symbol || !signal.entryPrice || signal.entryPrice <= 0) {
    return { ok: false, reason: 'Sinal inválido (symbol/entryPrice)' };
  }

  return { ok: true };
}

/**
 * Calcula o tamanho da posição em USDT.
 */
export function calculatePositionSizeUsdt(): number {
  return getPositionSizeUsdt();
}

/**
 * Calcula a quantidade em unidades do ativo base (ex: 0.001 BTC).
 * quantity = positionSizeUsdt / entryPrice
 */
export function calculateQuantity(
  entryPrice: number,
  positionSizeUsdt?: number
): number {
  const size = positionSizeUsdt ?? getPositionSizeUsdt();
  return size / entryPrice;
}

/**
 * Arredonda quantidade para o step size da Binance.
 * Ex: step 0.001 → 0.1234567 vira 0.123
 */
export function roundQuantity(quantity: number, stepSize: number): string {
  const precision = getStepPrecision(stepSize);
  const rounded = Math.floor(quantity / stepSize) * stepSize;
  return formatPrecision(rounded, precision);
}

/**
 * Arredonda preço para o tick size da Binance (PRICE_FILTER).
 */
export function roundPrice(price: number, tickSize: number): string {
  const precision = getStepPrecision(tickSize);
  const rounded = Math.round(price / tickSize) * tickSize;
  return formatPrecision(rounded, precision);
}

/**
 * Arredonda stop loss: BUY=floor (abaixo), SELL=ceil (acima) para garantir 5% correto.
 */
export function roundPriceStopLoss(price: number, tickSize: number, direction: 'BUY' | 'SELL'): string {
  const precision = getStepPrecision(tickSize);
  const mult = price / tickSize;
  const rounded = direction === 'BUY'
    ? Math.floor(mult) * tickSize  // stop abaixo: não arredondar para cima
    : Math.ceil(mult) * tickSize;  // stop acima: não arredondar para baixo
  return formatPrecision(rounded, precision);
}

function getStepPrecision(step: number): number {
  if (step >= 1) return 0;
  const str = step.toString();
  if (str.includes('e')) {
    const [, exp] = str.split('e');
    return Math.abs(parseInt(exp, 10));
  }
  const dec = str.split('.')[1];
  return dec?.length ?? 8;
}

function formatPrecision(value: number, precision: number): string {
  if (precision <= 0) return String(Math.round(value));
  return value.toFixed(precision);
}

/**
 * Parâmetros para ordem de Stop Loss (STOP_MARKET).
 */
export function getStopLossOrderParams(signal: SignalForTrading) {
  return {
    symbol: signal.symbol,
    side: signal.direction === 'BUY' ? 'SELL' as const : 'BUY' as const,
    stopPrice: signal.stopLoss,
    closePosition: true, // Fechar posição inteira no SL
  };
}

/**
 * TP1 = 35% da posição, TP2 = 35% da posição, 30% restante às 24h (sem ordem).
 * Preços vêm do sinal (target1, target2).
 */
export function getTakeProfitLevels(signal: SignalForTrading): Array<{
  price: number;
  percentOfPosition: number;
  label: string;
}> {
  const tp1 = signal.target1 ?? signal.entryPrice;
  const tp2 = signal.target2 ?? signal.entryPrice;

  const levels = [
    { price: tp1, percentOfPosition: 60, label: 'TP1' },
    { price: tp2, percentOfPosition: 30, label: 'TP2' },
  ];
  // 10% restante = fechar às 24h (preço de mercado), não colocamos ordem
  return levels;
}

/**
 * Resumo dos parâmetros que seriam usados para executar o sinal.
 * Útil para logs e testes.
 */
export function getExecutionParams(signal: SignalForTrading) {
  const check = canExecuteSignal(signal);
  if (!check.ok) {
    return { canExecute: false, reason: check.reason };
  }

  const positionSize = calculatePositionSizeUsdt();
  const quantity = calculateQuantity(signal.entryPrice, positionSize);
  const sl = getStopLossOrderParams(signal);
  const tps = getTakeProfitLevels(signal);

  return {
    canExecute: true,
    symbol: signal.symbol,
    direction: signal.direction,
    entryPrice: signal.entryPrice,
    quantity,
    positionSizeUsdt: positionSize,
    stopLoss: sl.stopPrice,
    takeProfits: tps,
  };
}
