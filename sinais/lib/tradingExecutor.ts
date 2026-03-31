/**
 * Executor de sinais — Binance Futures e Bybit Linear Futures.
 * executeSignal()     = simulação (logs, sem ordens).
 * executeSignalReal() = ordens reais quando TRADING_ENABLED (Binance/Bybit Testnet ou Mainnet).
 * Define EXCHANGE=bybit para usar Bybit em vez de Binance.
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
import {
  hasBybitCredentials,
  isBybitEnabled,
  isBybitPaperTrading,
  isBybitTestnet,
} from './bybitConfig';
import { getTradingEnabled } from './settings';
import {
  createOrder,
  createAlgoOrder,
  getPositionRisk,
  getLotSizeStep,
  getTickSize,
} from './binanceFuturesClient';
import {
  createBybitOrder,
  getBybitPositionRisk,
  getBybitLotSizeStep,
  getBybitTickSize,
} from './bybitFuturesClient';

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
  return (
    n.includes('ma200 top') ||
    n.includes('ma200_volatile') ||
    n.includes('ma cross top') ||
    n.includes('ma_volatile')
  );
}

/** Cobre RSI 1h e RSI 15m (displayName contém "rsi") */
function isRsiStrategy(strategyName: string): boolean {
  return strategyName.toLowerCase().includes('rsi');
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
 * Execução real na Binance Futures (Testnet e Mainnet).
 * Cria ordem MARKET (entrada) + STOP_MARKET (SL) + TAKE_PROFIT_MARKET (TP1/TP2).
 */
async function executeSignalBinance(
  signal: SignalForTrading,
  executionSignal: SignalForTrading,
  params: ReturnType<typeof getExecutionParams>
): Promise<ExecuteResult> {
  if (!hasTradingCredentials()) {
    return { success: false, dryRun: false, message: 'Credenciais Binance não configuradas' };
  }

  try {
    const [stepSize, tickSize] = await Promise.all([
      getLotSizeStep(executionSignal.symbol),
      getTickSize(executionSignal.symbol),
    ]);
    const qty  = typeof params.quantity === 'number' ? params.quantity : 0;
    const step = Number.isFinite(stepSize) && stepSize > 0 ? stepSize : 0.001;
    const tick = Number.isFinite(tickSize) && tickSize > 0 ? tickSize : 0.01;
    const qtyStr          = roundQuantity(qty, step);
    const triggerPriceStr = roundPriceStopLoss(executionSignal.stopLoss, tick, executionSignal.direction);

    if (signal.direction !== executionSignal.direction) {
      console.log(`[Binance] Perfil VS15m: ${signal.symbol} ${signal.direction} -> ${executionSignal.direction}`);
    }

    const entryOrder = await createOrder({
      symbol: executionSignal.symbol,
      side:   executionSignal.direction,
      type:   'MARKET',
      quantity: qtyStr,
    });

    const slSide = executionSignal.direction === 'BUY' ? 'SELL' : 'BUY';
    let stopOrderId: number | undefined;
    try {
      const stopOrder = await createAlgoOrder({
        symbol:       executionSignal.symbol,
        side:         slSide,
        type:         'STOP_MARKET',
        triggerPrice: triggerPriceStr,
        closePosition: true,
      });
      stopOrderId = stopOrder.algoId;
      console.log(`[Binance] Entrada: ${entryOrder.orderId} | SL algo: ${stopOrderId}`);
    } catch (slError: unknown) {
      const slMsg = slError instanceof Error ? slError.message : String(slError);
      if (slMsg.includes('closePosition') && slMsg.includes('existing')) {
        console.log(`[Binance] SL já existe para ${executionSignal.symbol}, entrada OK: ${entryOrder.orderId}`);
      } else {
        throw slError;
      }
    }

    const tps       = params.takeProfits ?? [];
    const totalQty  = qty;
    const tpPercents =
      isMa200Volatile(signal.strategyName) ? [0.40, 0.30] :
      isRsiStrategy(signal.strategyName) && signal.direction === 'BUY'  ? [0.35, 0.35] :
      isRsiStrategy(signal.strategyName) && signal.direction === 'SELL' ? [0.30, 0.35] :
      [0.60, 0.30];
    const tpErrors: string[] = [];
    for (let i = 0; i < Math.min(tps.length, 2); i++) {
      const tp = tps[i];
      if (!tp || tp.price === executionSignal.entryPrice) continue;
      const tpQty    = totalQty * tpPercents[i];
      if (tpQty <= 0) continue;
      const tpQtyStr = roundQuantity(tpQty, step);
      if (parseFloat(tpQtyStr) <= 0) continue;
      const tpTrigger = roundPrice(tp.price, tick);
      try {
        const tpOrder = await createAlgoOrder({
          symbol:       executionSignal.symbol,
          side:         slSide,
          type:         'TAKE_PROFIT_MARKET',
          triggerPrice: tpTrigger,
          quantity:     tpQtyStr,
          reduceOnly:   true,
        });
        console.log(`[Binance] TP${i + 1}: ${tpQtyStr} @ ${tpTrigger} | algo: ${tpOrder.algoId}`);
      } catch (tpErr) {
        const msg = tpErr instanceof Error ? tpErr.message : String(tpErr);
        tpErrors.push(`TP${i + 1}: ${msg}`);
        console.warn(`[Binance] Erro TP${i + 1}:`, tpErr);
      }
    }

    const tpWarning = tpErrors.length > 0 ? ` (TPs não colocados: ${tpErrors.join('; ')})` : '';
    return {
      success:     true,
      dryRun:      false,
      message:     (stopOrderId
        ? `[Binance] Trade: ${executionSignal.symbol} ${executionSignal.direction} order ${entryOrder.orderId}`
        : `[Binance] Entrada: ${executionSignal.symbol}. SL já existia.`) + tpWarning,
      params,
      orderId:     entryOrder.orderId,
      stopOrderId,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Binance] Erro ao executar:', msg);
    return { success: false, dryRun: false, message: `Erro Binance: ${msg}` };
  }
}

/**
 * Execução na Bybit: só Demo Trading ou Testnet (sem Mainnet real).
 * Cria ordem MARKET com SL embutido + ordens condicionais TP1/TP2.
 */
async function executeSignalBybit(
  signal: SignalForTrading,
  executionSignal: SignalForTrading,
  params: ReturnType<typeof getExecutionParams>
): Promise<ExecuteResult> {
  if (!hasBybitCredentials()) {
    return { success: false, dryRun: false, message: 'Credenciais Bybit não configuradas (BYBIT_API_KEY / BYBIT_API_SECRET)' };
  }
  if (!isBybitPaperTrading()) {
    return {
      success: false,
      dryRun: false,
      message:
        'Bybit: só Demo Trading ou Testnet. Define BYBIT_BASE_URL=https://api-demo.bybit.com (API keys criadas no modo Demo em bybit.com) ou https://api-testnet.bybit.com. A Mainnet real (dinheiro) está desactivada.',
    };
  }

  try {
    const [stepSize, tickSize] = await Promise.all([
      getBybitLotSizeStep(executionSignal.symbol),
      getBybitTickSize(executionSignal.symbol),
    ]);
    const qty  = typeof params.quantity === 'number' ? params.quantity : 0;
    const step = Number.isFinite(stepSize) && stepSize > 0 ? stepSize : 0.001;
    const tick = Number.isFinite(tickSize) && tickSize > 0 ? tickSize : 0.01;
    const qtyStr    = roundQuantity(qty, step);
    const slPriceStr = roundPriceStopLoss(executionSignal.stopLoss, tick, executionSignal.direction);

    if (signal.direction !== executionSignal.direction) {
      console.log(`[Bybit] Perfil VS15m: ${signal.symbol} ${signal.direction} -> ${executionSignal.direction}`);
    }

    // Bybit usa "Buy"/"Sell" (capitalizado)
    const bybitSide: 'Buy' | 'Sell' = executionSignal.direction === 'BUY' ? 'Buy' : 'Sell';
    const bybitSlSide: 'Buy' | 'Sell' = bybitSide === 'Buy' ? 'Sell' : 'Buy';

    // Ordem de entrada com SL embutido
    const entryOrder = await createBybitOrder({
      symbol:     executionSignal.symbol,
      side:       bybitSide,
      qty:        qtyStr,
      stopLoss:   slPriceStr,
      slTriggerBy: 'MarkPrice',
    });
    console.log(`[Bybit] Entrada: ${entryOrder.orderId} | SL @ ${slPriceStr}`);

    // Ordens de Take Profit separadas
    const tps        = params.takeProfits ?? [];
    const totalQty   = qty;
    const tpPercents =
      isMa200Volatile(signal.strategyName) ? [0.40, 0.30] :
      isRsiStrategy(signal.strategyName) && signal.direction === 'BUY'  ? [0.35, 0.35] :
      isRsiStrategy(signal.strategyName) && signal.direction === 'SELL' ? [0.30, 0.35] :
      [0.60, 0.30];
    const tpErrors: string[] = [];
    for (let i = 0; i < Math.min(tps.length, 2); i++) {
      const tp = tps[i];
      if (!tp || tp.price === executionSignal.entryPrice) continue;
      const tpQty    = totalQty * tpPercents[i];
      if (tpQty <= 0) continue;
      const tpQtyStr  = roundQuantity(tpQty, step);
      if (parseFloat(tpQtyStr) <= 0) continue;
      const tpTrigger = roundPrice(tp.price, tick);
      try {
        const tpOrder = await createBybitOrder({
          symbol:         executionSignal.symbol,
          side:           bybitSlSide,
          qty:            tpQtyStr,
          stopOrderType:  'TakeProfit',
          triggerPrice:   tpTrigger,
          triggerBy:      'MarkPrice',
          reduceOnly:     true,
        });
        console.log(`[Bybit] TP${i + 1}: ${tpQtyStr} @ ${tpTrigger} | order: ${tpOrder.orderId}`);
      } catch (tpErr) {
        const msg = tpErr instanceof Error ? tpErr.message : String(tpErr);
        tpErrors.push(`TP${i + 1}: ${msg}`);
        console.warn(`[Bybit] Erro TP${i + 1}:`, tpErr);
      }
    }

    const tpWarning = tpErrors.length > 0 ? ` (TPs não colocados: ${tpErrors.join('; ')})` : '';
    // Converter orderId string -> number para compatibilidade com ExecuteResult
    const orderIdNum = parseInt(entryOrder.orderId, 10) || 0;
    return {
      success: true,
      dryRun:  false,
      message: `[Bybit] Trade: ${executionSignal.symbol} ${executionSignal.direction} order ${entryOrder.orderId}` + tpWarning,
      params,
      orderId: orderIdNum,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Bybit] Erro ao executar:', msg);
    return { success: false, dryRun: false, message: `Erro Bybit: ${msg}` };
  }
}

/**
 * Execução real: encaminha para Bybit ou Binance conforme EXCHANGE env var.
 * Só executa se TRADING_ENABLED=true.
 */
export async function executeSignalReal(signal: SignalForTrading): Promise<ExecuteResult> {
  const executionSignal = applyVolumeSpike15mExecutionProfile(signal);
  const check = canExecuteSignal(toSignalForRules(executionSignal));
  if (!check.ok) {
    return { success: false, dryRun: false, message: check.reason ?? 'Sinal não executável' };
  }

  const tradingEnabled = await getTradingEnabled();
  if (!tradingEnabled) {
    return { success: false, dryRun: false, message: 'Trades desativados na aplicação (ativa em Estratégias)' };
  }

  const params = getExecutionParams(toSignalForRules(executionSignal));
  if (!params.canExecute) {
    return { success: false, dryRun: false, message: 'Parâmetros inválidos' };
  }

  // Prioridade: exchange do sinal > variável EXCHANGE global
  const useBybit = signal.exchange === 'bybit' || (signal.exchange !== 'binance' && isBybitEnabled());
  if (useBybit) {
    return executeSignalBybit(signal, executionSignal, params);
  }
  return executeSignalBinance(signal, executionSignal, params);
}

/**
 * Fecha posição ativa de um símbolo (se existir) antes de abrir novo sinal (flip/reversão).
 * Funciona tanto em Binance como em Bybit conforme exchange passada ou EXCHANGE env var.
 */
export async function closeActivePositionForSymbol(
  symbol: string,
  exchange?: 'binance' | 'bybit'
): Promise<ClosePositionResult> {
  const tradingEnabled = await getTradingEnabled();
  if (!tradingEnabled) return { closed: false, message: 'Trades desativados na aplicação' };

  const useBybit = exchange === 'bybit' || (exchange !== 'binance' && isBybitEnabled());

  if (useBybit) {
    // --- Bybit ---
    if (!hasBybitCredentials()) return { closed: false, message: 'Credenciais Bybit não configuradas' };
    if (!isBybitPaperTrading()) {
      return {
        closed: false,
        message:
          'Bybit: só Demo ou Testnet. BYBIT_BASE_URL deve ser api-demo.bybit.com ou api-testnet.bybit.com',
      };
    }

    try {
      const positions = await getBybitPositionRisk(symbol);
      const active = positions.find((p) => p.symbol === symbol && parseFloat(p.size) > 0 && p.side !== 'None');
      if (!active) return { closed: false, message: `Sem posição ativa em ${symbol} (Bybit)` };

      const size      = parseFloat(active.size);
      const closeSide: 'BUY' | 'SELL' = active.side === 'Buy' ? 'SELL' : 'BUY';
      const step      = await getBybitLotSizeStep(symbol);
      const qty       = roundQuantity(size, Number.isFinite(step) && step > 0 ? step : 0.001);

      if (parseFloat(qty) <= 0) return { closed: false, message: `Quantidade inválida para fechar ${symbol}: ${qty}` };

      const bybitSide: 'Buy' | 'Sell' = closeSide === 'BUY' ? 'Buy' : 'Sell';
      const closeOrder = await createBybitOrder({ symbol, side: bybitSide, qty, reduceOnly: true });
      return {
        closed: true,
        message: `Posição fechada em ${symbol} (Bybit)`,
        side: closeSide,
        quantity: qty,
        orderId: parseInt(closeOrder.orderId, 10) || 0,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { closed: false, message: `Erro Bybit ao fechar ${symbol}: ${msg}` };
    }
  }

  // --- Binance (default) ---
  if (!hasTradingCredentials()) return { closed: false, message: 'Credenciais Binance não configuradas' };

  try {
    const positions = await getPositionRisk();
    const active = positions.find((p) => p.symbol === symbol && Math.abs(parseFloat(p.positionAmt)) > 0);
    if (!active) return { closed: false, message: `Sem posição ativa em ${symbol}` };

    const amt       = parseFloat(active.positionAmt);
    const closeSide: 'BUY' | 'SELL' = amt > 0 ? 'SELL' : 'BUY';
    const step      = await getLotSizeStep(symbol);
    const qty       = roundQuantity(Math.abs(amt), Number.isFinite(step) && step > 0 ? step : 0.001);

    if (parseFloat(qty) <= 0) return { closed: false, message: `Quantidade inválida para fechar ${symbol}: ${qty}` };

    const closeOrder = await createOrder({ symbol, side: closeSide, type: 'MARKET', quantity: qty, reduceOnly: true });
    return {
      closed: true,
      message: `Posição fechada em ${symbol} (Binance)`,
      side: closeSide,
      quantity: qty,
      orderId: closeOrder.orderId,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { closed: false, message: `Erro Binance ao fechar ${symbol}: ${msg}` };
  }
}

/**
 * Verifica se o executor pode correr (credenciais, trades ativados).
 * `ready` é true se pelo menos uma exchange estiver configurada (Binance ou Bybit),
 * para o botão "Executar" funcionar com a exchange definida por estratégia.
 */
export async function getExecutorStatus(): Promise<{
  exchange:       string;
  hasCredentials: boolean;
  tradingEnabled: boolean;
  isTestnet:      boolean;
  ready:          boolean;
  reason?:        string;
  readyBinance?:  boolean;
  readyBybit?:    boolean;
}> {
  const tradingEnabled   = await getTradingEnabled();
  const envExchange      = isBybitEnabled() ? 'bybit' : 'binance';
  const hasBinance       = hasTradingCredentials();
  const hasBybit         = hasBybitCredentials();
  const bybitTestnet     = isBybitTestnet();
  const binanceTestnet   = isTestnet();

  const paperBybit   = isBybitPaperTrading();
  const readyBinance = hasBinance;
  const readyBybit   = hasBybit && paperBybit;
  const ready        = tradingEnabled && (readyBinance || readyBybit);

  let reason: string | undefined;
  if (!tradingEnabled) {
    reason = 'Trades desativados (ativa em Estratégias)';
  } else if (!readyBinance && !readyBybit) {
    if (!hasBinance && !hasBybit) {
      reason = 'Configure BINANCE_API_KEY/SECRET e/ou BYBIT_API_KEY/SECRET';
    } else if (hasBybit && !paperBybit) {
      reason =
        'Bybit: BYBIT_BASE_URL deve ser https://api-demo.bybit.com (Demo) ou https://api-testnet.bybit.com — não uses api.bybit.com (real)';
    } else {
      reason = 'Credenciais incompletas para executar';
    }
  }

  return {
    exchange: envExchange,
    hasCredentials: envExchange === 'bybit' ? hasBybit : hasBinance,
    tradingEnabled,
    isTestnet: envExchange === 'bybit' ? bybitTestnet : binanceTestnet,
    ready,
    reason,
    readyBinance,
    readyBybit,
  };
}
