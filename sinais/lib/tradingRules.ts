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
  /** JSON string com detalhes de execução do sinal. */
  extraInfo?: string | null;
}

/** Estratégias permitidas para trading automático */
const ALLOWED_STRATEGIES = [
  'Volume Spike',
  'Volume Spike 1h',
  '15MVolume',
  'MA200 Top Voláteis',
  'MA200_VOLATILE',
  'MA Cross 5m',
  'MA Cross 15m',
  'MA12/MA30',
  'MA_CROSS_5M',
  'EMA_SCALPING',
  'EMA Ribbon Scalping BUY',
  'EMA_SCALPING_SELL',
  'EMA Ribbon Scalping SELL',
  'MACD Histogram 1h + PMO',
  'MACD_HISTOGRAM_PMO',
  'Afastamento médio 30m',
  'AFASTAMENTO_MEDIO_30M',
  'RSI pullback bear 1h',
  'RSI queda de 70',
  'RSI_OVERBOUGHT_DROP_1H',
  'RSI queda de 70 (mín. 4 pts) + afastamento >10% (1h)',
  'RSI_OVERBOUGHT_DROP_LEGACY_1H',
  'Pivot Boss Bear',
  'PIVOT_BOSS_BEAR_15M',
  'PIVOT_BOSS_BEAR_1H',
  'Scanner 1 Top 8',
  'SCANNER1_TOP8',
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
 * Retorna os níveis de TP definidos no sinal.
 * Quando a estratégia não define TP intermédio, não criamos ordens TP.
 */
export function getTakeProfitLevels(signal: SignalForTrading): Array<{
  price: number;
  percentOfPosition: number;
  label: string;
}> {
  if (signal.target1 == null && signal.target2 == null) {
    return [];
  }

  const levels: Array<{ price: number; percentOfPosition: number; label: string }> = [];
  let tp1Position = 60;
  let tp2Position = 30;

  if (signal.extraInfo) {
    try {
      const extra = JSON.parse(signal.extraInfo);
      const parsedTp1 = parsePercentValue(extra?.tp1Position);
      const parsedTp2 = parsePercentValue(extra?.tp2Position);
      if (parsedTp1 !== null) tp1Position = parsedTp1;
      if (parsedTp2 !== null) tp2Position = parsedTp2;
    } catch {
      // Ignora extraInfo inválido e mantém os defaults históricos.
    }
  }

  if (signal.target1 != null) {
    levels.push({ price: signal.target1, percentOfPosition: tp1Position, label: 'TP1' });
  }
  if (signal.target2 != null) {
    levels.push({ price: signal.target2, percentOfPosition: tp2Position, label: 'TP2' });
  }

  return levels;
}

function parsePercentValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace('%', '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
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
