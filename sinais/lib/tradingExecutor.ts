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
  isTradingEnabled,
  hasTradingCredentials,
  isTestnet,
} from './binanceConfig';
import {
  createOrder,
  createAlgoOrder,
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
  const check = canExecuteSignal(toSignalForRules(signal));
  if (!check.ok) {
    console.log(`[TradingExecutor] Sinal ${signal.id} rejeitado: ${check.reason}`);
    return {
      success: false,
      dryRun: true,
      message: check.reason ?? 'Sinal não executável',
    };
  }

  const params = getExecutionParams(toSignalForRules(signal));
  if (!params.canExecute || !params.positionSizeUsdt) {
    return {
      success: false,
      dryRun: true,
      message: 'Parâmetros inválidos',
    };
  }

  console.log('[TradingExecutor] ===== SIMULAÇÃO (dry run) =====');
  console.log(`[TradingExecutor] Sinal: ${signal.symbol} ${signal.direction} | Força ${signal.strength}`);
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
  const check = canExecuteSignal(toSignalForRules(signal));
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

  if (!isTradingEnabled()) {
    return {
      success: false,
      dryRun: false,
      message: 'Trading desativado (TRADING_ENABLED=false)',
    };
  }

  if (!isTestnet()) {
    return {
      success: false,
      dryRun: false,
      message: 'Execução apenas permitida no Testnet. Configure BINANCE_FUTURES_BASE_URL para testnet.binancefuture.com',
    };
  }

  const params = getExecutionParams(toSignalForRules(signal));
  if (!params.canExecute) {
    return { success: false, dryRun: false, message: 'Parâmetros inválidos' };
  }

  try {
    const [stepSize, tickSize] = await Promise.all([
      getLotSizeStep(signal.symbol),
      getTickSize(signal.symbol),
    ]);
    const qty = typeof params.quantity === 'number' ? params.quantity : 0;
    const step = Number.isFinite(stepSize) && stepSize > 0 ? stepSize : 0.001;
    const tick = Number.isFinite(tickSize) && tickSize > 0 ? tickSize : 0.01;
    const qtyStr = roundQuantity(qty, step);
    const triggerPriceStr = roundPriceStopLoss(signal.stopLoss, tick, signal.direction);

    const entryOrder = await createOrder({
      symbol: signal.symbol,
      side: signal.direction,
      type: 'MARKET',
      quantity: qtyStr,
    });

    const slSide = signal.direction === 'BUY' ? 'SELL' : 'BUY';
    let stopOrderId: number | undefined;
    try {
      const stopOrder = await createAlgoOrder({
        symbol: signal.symbol,
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
        console.log(`[TradingExecutor] Stop loss já existe para ${signal.symbol}, entrada OK: ${entryOrder.orderId}`);
      } else {
        throw slError;
      }
    }

    // Take Profit: TP1 40% (9%), TP2 35% (25%), 25% às 24h (sem ordem na Binance)
    const tps = params.takeProfits ?? [];
    const totalQty = qty;
    const tpPercents = [0.4, 0.35]; // TP1 40%, TP2 35%, 25% às 24h
    const tpErrors: string[] = [];
    for (let i = 0; i < Math.min(tps.length, 2); i++) {
      const tp = tps[i];
      if (!tp || tp.price === signal.entryPrice) continue;
      const tpQty = totalQty * tpPercents[i];
      if (tpQty <= 0) continue;
      const tpQtyStr = roundQuantity(tpQty, step);
      if (parseFloat(tpQtyStr) <= 0) continue;
      const tpTriggerStr = roundPrice(tp.price, tick);
      try {
        const tpOrder = await createAlgoOrder({
          symbol: signal.symbol,
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
        ? `Trade executado: ${signal.symbol} ${signal.direction} order ${entryOrder.orderId}`
        : `Entrada executada: ${signal.symbol} ${signal.direction}. Stop loss já existia para este par.`) + tpWarning,
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
 * Verifica se o executor pode correr (credenciais, TRADING_ENABLED, Testnet).
 */
export function getExecutorStatus(): {
  hasCredentials: boolean;
  tradingEnabled: boolean;
  isTestnet: boolean;
  ready: boolean;
  reason?: string;
} {
  const hasCredentials = hasTradingCredentials();
  const tradingEnabled = isTradingEnabled();
  const testnet = isTestnet();
  let reason: string | undefined;
  if (!hasCredentials) reason = 'API Key/Secret não configurados';
  else if (!tradingEnabled) reason = 'TRADING_ENABLED=false';
  else if (!testnet) reason = 'Apenas Testnet permitido para execução';

  return {
    hasCredentials,
    tradingEnabled,
    isTestnet: testnet,
    ready: hasCredentials && tradingEnabled && testnet,
    reason,
  };
}
