/**
 * Executor de sinais Volume Spike.
 * executeSignal() = simulação (logs).
 * executeSignalReal() = ordens reais na Binance (apenas Testnet quando TRADING_ENABLED).
 */

import {
  canExecuteSignal,
  getExecutionParams,
  roundQuantity,
  roundPrice,
  roundPriceStopLoss,
  type SignalForTrading,
} from './tradingRules';
import {
  hasTradingCredentials,
  isTestnet,
} from './binanceConfig';
import { getTradingEnabled } from './settings';
import {
  createOrder,
  createAlgoOrder,
  getPositionRisk,
  getLotSizeStep,
  getTickSize,
} from './binanceFuturesClient';

export interface ExecuteResult {
  success: boolean;
  dryRun: boolean;
  message: string;
  params?: ReturnType<typeof getExecutionParams>;
  orderId?: number;
  stopOrderId?: number;
}

export interface ClosePositionResult {
  closed: boolean;
  message: string;
  side?: 'BUY' | 'SELL';
  quantity?: string;
  orderId?: number;
}

function isVolumeSpike15m(strategyName: string): boolean {
  return strategyName.toLowerCase().includes('volume spike 15m');
}

function isMa200Volatile(strategyName: string): boolean {
  const n = strategyName.toLowerCase();
  return n.includes('ma200 top') || n.includes('ma200_volatile');
}

/**
 * Regra operacional validada em backtests:
 * - Volume Spike 15m executa sempre como SELL (inclui sinais BUY invertidos)
 * - SL 7%, TP1 10%, TP2 11%
 */
function applyVolumeSpike15mExecutionProfile(signal: SignalForTrading): SignalForTrading {
  if (!isVolumeSpike15m(signal.strategyName)) {
    return signal;
  }

  const entry = signal.entryPrice;
  return {
    ...signal,
    direction: 'SELL',
    stopLoss: entry * 1.07,
    target1: entry * 0.90,
    target2: entry * 0.89,
    target3: null,
  };
}

function toSignalForRules(signal: SignalForTrading): SignalForTrading {
  return {
    id: signal.id,
    symbol: signal.symbol,
    direction: signal.direction,
    entryPrice: signal.entryPrice,
    stopLoss: signal.stopLoss,
    target1: signal.target1,
    target2: signal.target2,
    target3: signal.target3,
    strength: signal.strength,
    strategyName: signal.strategyName,
    status: signal.status,
  };
}

/**
 * Simulação: verifica regras, calcula params e faz LOG. NÃO cria ordens.
 */
export function executeSignal(signal: SignalForTrading): ExecuteResult {
  const executionSignal = applyVolumeSpike15mExecutionProfile(signal);
  const check = canExecuteSignal(toSignalForRules(executionSignal));
  if (!check.ok) {
    console.log(`[TradingExecutor] Sinal ${signal.id} rejeitado: ${check.reason}`);
    return {
      success: false,
      dryRun: true,
      message: check.reason ?? 'Sinal não executável',
    };
  }

  const params = getExecutionParams(toSignalForRules(executionSignal));
  if (!params.canExecute || !params.positionSizeUsdt) {
    return {
      success: false,
      dryRun: true,
      message: 'Parâmetros inválidos',
    };
  }

  console.log('[TradingExecutor] ===== SIMULAÇÃO (dry run) =====');
  if (signal.direction !== executionSignal.direction) {
    console.log(`[TradingExecutor] Perfil Volume Spike 15m aplicado: ${signal.symbol} ${signal.direction} -> ${executionSignal.direction} (SL 7%, TP1 10%, TP2 11%)`);
  }
  console.log(`[TradingExecutor] Sinal: ${executionSignal.symbol} ${executionSignal.direction} | Força ${executionSignal.strength}`);
  console.log(`[TradingExecutor] Entrada: ${params.entryPrice} | Qty: ${params.quantity} | Posição: ${params.positionSizeUsdt} USDT`);
  console.log(`[TradingExecutor] Stop Loss: ${params.stopLoss}`);
  params.takeProfits.forEach((tp) => {
    console.log(`[TradingExecutor] ${tp.label} (${tp.percentOfPosition}%): ${tp.price}`);
  });
  console.log('[TradingExecutor] ================================');

  return {
    success: true,
    dryRun: true,
    message: `Simulação OK: ${params.symbol} ${params.direction} qty ${params.quantity}`,
    params,
  };
}

/**
 * Execução real: cria ordem MARKET (entrada) + STOP_MARKET (stop loss).
 * Só executa se TRADING_ENABLED=true e BINANCE_FUTURES_BASE_URL for Testnet.
 */
export async function executeSignalReal(signal: SignalForTrading): Promise<ExecuteResult> {
  const executionSignal = applyVolumeSpike15mExecutionProfile(signal);
  const check = canExecuteSignal(toSignalForRules(executionSignal));
  if (!check.ok) {
    return {
      success: false,
      dryRun: false,
      message: check.reason ?? 'Sinal não executável',
    };
  }

  if (!hasTradingCredentials()) {
    return {
      success: false,
      dryRun: false,
      message: 'Credenciais Binance não configuradas',
    };
  }

  const tradingEnabled = await getTradingEnabled();
  if (!tradingEnabled) {
    return {
      success: false,
      dryRun: false,
      message: 'Trades desativados na aplicação (ativa em Estratégias)',
    };
  }

  if (!isTestnet()) {
    return {
      success: false,
      dryRun: false,
      message: 'Execução apenas permitida no Testnet. Configure BINANCE_FUTURES_BASE_URL para testnet.binancefuture.com',
    };
  }

  const params = getExecutionParams(toSignalForRules(executionSignal));
  if (!params.canExecute) {
    return { success: false, dryRun: false, message: 'Parâmetros inválidos' };
  }

  try {
    const [stepSize, tickSize] = await Promise.all([
      getLotSizeStep(executionSignal.symbol),
      getTickSize(executionSignal.symbol),
    ]);
    const qty = typeof params.quantity === 'number' ? params.quantity : 0;
    const step = Number.isFinite(stepSize) && stepSize > 0 ? stepSize : 0.001;
    const tick = Number.isFinite(tickSize) && tickSize > 0 ? tickSize : 0.01;
    const qtyStr = roundQuantity(qty, step);
    const triggerPriceStr = roundPriceStopLoss(executionSignal.stopLoss, tick, executionSignal.direction);

    if (signal.direction !== executionSignal.direction) {
      console.log(`[TradingExecutor] Perfil Volume Spike 15m aplicado: ${signal.symbol} ${signal.direction} -> ${executionSignal.direction} (SL 7%, TP1 10%, TP2 11%)`);
    }

    const entryOrder = await createOrder({
      symbol: executionSignal.symbol,
      side: executionSignal.direction,
      type: 'MARKET',
      quantity: qtyStr,
    });

    const slSide = executionSignal.direction === 'BUY' ? 'SELL' : 'BUY';
    let stopOrderId: number | undefined;
    try {
      const stopOrder = await createAlgoOrder({
        symbol: executionSignal.symbol,
        side: slSide,
        type: 'STOP_MARKET',
        triggerPrice: triggerPriceStr,
        closePosition: true,
      });
      stopOrderId = stopOrder.algoId;
      console.log(`[TradingExecutor] Ordem entrada: ${entryOrder.orderId} | Stop Loss algo: ${stopOrderId}`);
    } catch (slError: unknown) {
      const slMsg = slError instanceof Error ? slError.message : String(slError);
      if (slMsg.includes('closePosition') && slMsg.includes('existing')) {
        console.log(`[TradingExecutor] Stop loss já existe para ${executionSignal.symbol}, entrada OK: ${entryOrder.orderId}`);
      } else {
        throw slError;
      }
    }

    // Take Profit:
    //   MA200_VOLATILE  → TP1 40%, TP2 30%, 30% sai na reversão (sem ordem)
    //   Outras          → TP1 60%, TP2 30%, 10% às 24h (sem ordem)
    const tps = params.takeProfits ?? [];
    const totalQty = qty;
    const tpPercents = isMa200Volatile(signal.strategyName)
      ? [0.40, 0.30]   // MA200: 40% TP1, 30% TP2, 30% fecha na reversão
      : [0.60, 0.30];  // outros: 60% TP1, 30% TP2, 10% às 24h
    const tpErrors: string[] = [];
    for (let i = 0; i < Math.min(tps.length, 2); i++) {
      const tp = tps[i];
      if (!tp || tp.price === executionSignal.entryPrice) continue;
      const tpQty = totalQty * tpPercents[i];
      if (tpQty <= 0) continue;
      const tpQtyStr = roundQuantity(tpQty, step);
      if (parseFloat(tpQtyStr) <= 0) continue;
      const tpTriggerStr = roundPrice(tp.price, tick);
      try {
        const tpOrder = await createAlgoOrder({
          symbol: executionSignal.symbol,
          side: slSide,
          type: 'TAKE_PROFIT_MARKET',
          triggerPrice: tpTriggerStr,
          quantity: tpQtyStr,
          reduceOnly: true,
        });
        console.log(`[TradingExecutor] TP${i + 1} (${tp.label}): ${tpQtyStr} @ ${tpTriggerStr} | algo: ${tpOrder.algoId}`);
      } catch (tpErr) {
        const msg = tpErr instanceof Error ? tpErr.message : String(tpErr);
        tpErrors.push(`TP${i + 1}: ${msg}`);
        console.warn(`[TradingExecutor] Erro ao criar TP${i + 1}:`, tpErr);
      }
    }

    const tpWarning = tpErrors.length > 0 ? ` (TP não colocados: ${tpErrors.join('; ')})` : '';

    return {
      success: true,
      dryRun: false,
      message: (stopOrderId
        ? `Trade executado: ${executionSignal.symbol} ${executionSignal.direction} order ${entryOrder.orderId}`
        : `Entrada executada: ${executionSignal.symbol} ${executionSignal.direction}. Stop loss já existia para este par.`) + tpWarning,
      params,
      orderId: entryOrder.orderId,
      stopOrderId,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[TradingExecutor] Erro ao executar:', msg);
    return {
      success: false,
      dryRun: false,
      message: `Erro Binance: ${msg}`,
    };
  }
}

/**
 * Fecha posição ativa de um símbolo (se existir) antes de abrir novo sinal.
 * Útil para estratégia "flip" (ex.: MA60 sinal contrário).
 */
export async function closeActivePositionForSymbol(symbol: string): Promise<ClosePositionResult> {
  if (!hasTradingCredentials()) {
    return { closed: false, message: 'Credenciais Binance não configuradas' };
  }

  const tradingEnabled = await getTradingEnabled();
  if (!tradingEnabled) {
    return { closed: false, message: 'Trades desativados na aplicação' };
  }

  if (!isTestnet()) {
    return { closed: false, message: 'Fecho automático permitido apenas em Testnet' };
  }

  try {
    const positions = await getPositionRisk();
    const active = positions.find((p) => p.symbol === symbol && Math.abs(parseFloat(p.positionAmt)) > 0);

    if (!active) {
      return { closed: false, message: `Sem posição ativa em ${symbol}` };
    }

    const amt = parseFloat(active.positionAmt);
    const closeSide: 'BUY' | 'SELL' = amt > 0 ? 'SELL' : 'BUY';
    const absQty = Math.abs(amt);
    const step = await getLotSizeStep(symbol);
    const qty = roundQuantity(absQty, Number.isFinite(step) && step > 0 ? step : 0.001);

    if (parseFloat(qty) <= 0) {
      return { closed: false, message: `Quantidade inválida para fechar ${symbol}: ${qty}` };
    }

    const closeOrder = await createOrder({
      symbol,
      side: closeSide,
      type: 'MARKET',
      quantity: qty,
      reduceOnly: true,
    });

    return {
      closed: true,
      message: `Posição ativa fechada em ${symbol}`,
      side: closeSide,
      quantity: qty,
      orderId: closeOrder.orderId,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { closed: false, message: `Erro ao fechar posição de ${symbol}: ${msg}` };
  }
}

/**
 * Verifica se o executor pode correr (credenciais, trades ativados na app, Testnet).
 */
export async function getExecutorStatus(): Promise<{
  hasCredentials: boolean;
  tradingEnabled: boolean;
  isTestnet: boolean;
  ready: boolean;
  reason?: string;
}> {
  const hasCredentials = hasTradingCredentials();
  const tradingEnabled = await getTradingEnabled();
  const testnet = isTestnet();
  let reason: string | undefined;
  if (!hasCredentials) reason = 'API Key/Secret não configurados';
  else if (!tradingEnabled) reason = 'Trades desativados (ativa em Estratégias)';
  else if (!testnet) reason = 'Apenas Testnet permitido para execução';

  return {
    hasCredentials,
    tradingEnabled,
    isTestnet: testnet,
    ready: hasCredentials && tradingEnabled && testnet,
    reason,
  };
}
