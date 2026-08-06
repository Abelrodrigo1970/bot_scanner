import { prisma } from '@/lib/db';
import { isBybitEnabled } from '@/lib/bybitConfig';
import { strategyAllowsAutoExecuteDirection } from '@/lib/signalEngine';
import { executeSignalReal, inspectActivePositionForSymbol } from '@/lib/tradingExecutor';

type StrategyRow = {
  id: string;
  name: string;
  params: string | null;
};

/** Exchange da estratégia ou EXCHANGE global (Bybit se EXCHANGE=bybit). */
export function resolveStrategyExchange(stratParams: Record<string, unknown>): 'binance' | 'bybit' {
  if (stratParams.exchange === 'bybit') return 'bybit';
  if (stratParams.exchange === 'binance') return 'binance';
  return isBybitEnabled() ? 'bybit' : 'binance';
}

/**
 * Auto-executa sinais NEW para uma estratégia (inspecção, allowBuy/allowSell).
 * Inclui sinais deste ciclo e NEW recentes (até 2h) que falharam antes — senão ficam presos.
 */
export async function autoExecuteNewSignalsForStrategy(opts: {
  strategy: StrategyRow;
  startedAt: Date;
  minStrength: number;
  logPrefix: string;
}): Promise<number> {
  const { strategy, startedAt, minStrength, logPrefix } = opts;
  const stratParams = JSON.parse(strategy.params || '{}') as Record<string, unknown>;
  const exchange = resolveStrategyExchange(stratParams);

  const retrySince = new Date(Math.min(startedAt.getTime(), Date.now() - 2 * 3600_000));

  const newSignals = await prisma.signal.findMany({
    where: {
      strategyId: strategy.id,
      status: 'NEW',
      generatedAt: { gte: retrySince },
      strength: { gte: minStrength },
    },
    orderBy: { generatedAt: 'asc' },
  });

  // NEW demasiado antigos: não executar (preço já andou) — marcar expirados.
  const staleCutoff = new Date(Date.now() - 2 * 3600_000);
  const stale = await prisma.signal.updateMany({
    where: {
      strategyId: strategy.id,
      status: 'NEW',
      generatedAt: { lt: staleCutoff },
    },
    data: { status: 'EXPIRED' },
  });
  if (stale.count > 0) {
    console.log(`${logPrefix} 🧹 ${stale.count} sinal(is) NEW >2h expirados (sem re-execução)`);
  }

  let executed = 0;
  let inspectBlockedLogged = false;

  for (const sig of newSignals) {
    try {
      const positionState = await inspectActivePositionForSymbol(sig.symbol, exchange);
      if (!positionState.inspectable) {
        if (!inspectBlockedLogged) {
          console.warn(
            `${logPrefix} ⚠️ Auto-exec bloqueado (${exchange}): ${positionState.message}`
          );
          inspectBlockedLogged = true;
        }
        continue;
      }

      if (positionState.inspectable && !positionState.hasPosition) {
        const cleared = Number(
          await prisma.$executeRaw`
            UPDATE "Signal"
            SET status = 'EXPIRED'
            WHERE symbol = ${sig.symbol}
              AND "strategyId" = ${strategy.id}
              AND status = 'IN_PROGRESS'
          `
        );
        if (cleared > 0) {
          console.log(`${logPrefix} 🧹 ${sig.symbol}: ${cleared} IN_PROGRESS sem posição real foram limpos`);
        }
      }

      if (positionState.hasPosition && positionState.direction === sig.direction) {
        console.log(
          `${logPrefix} ⏭️ Já existe posição real em ${sig.symbol} (${positionState.direction}) — sinal ignorado`
        );
        continue;
      }

      if (positionState.hasPosition && positionState.direction !== sig.direction) {
        console.log(
          `${logPrefix} ⏭️ Posição oposta em ${sig.symbol} — sem fecho automático (saída só por SL/TP)`
        );
        continue;
      }

      if (!strategyAllowsAutoExecuteDirection(sig.direction as 'BUY' | 'SELL', stratParams)) {
        console.log(
          `${logPrefix} ⏭️ Auto-exec ${sig.direction} desactivada (allowBuy/allowSell) — sinal mantido: ${sig.symbol}`
        );
        continue;
      }

      console.log(
        `${logPrefix} → Auto-exec ${sig.direction} ${sig.symbol} via ${exchange} (força ${sig.strength})`
      );

      const execResult = await executeSignalReal({
        id: sig.id,
        symbol: sig.symbol,
        direction: sig.direction as 'BUY' | 'SELL',
        entryPrice: sig.entryPrice,
        stopLoss: sig.stopLoss,
        target1: sig.target1,
        target2: sig.target2,
        target3: sig.target3 ?? null,
        strength: sig.strength,
        strategyName: strategy.name,
        status: sig.status,
        extraInfo: sig.extraInfo,
        exchange,
      });

      if (execResult.success && execResult.orderId) {
        await prisma.$executeRaw`UPDATE "Signal" SET status = 'IN_PROGRESS' WHERE id = ${sig.id}`;
        console.log(
          `${logPrefix} ✅ Auto-executado: ${sig.symbol} ${sig.direction} order ${execResult.orderId}`
        );
        executed++;
      } else {
        console.warn(`${logPrefix} ⚠️ Auto-exec falhou ${sig.symbol}: ${execResult.message}`);
      }
    } catch (err) {
      console.error(`${logPrefix} ❌ Erro auto-exec ${sig.symbol}:`, err);
    }
  }

  return executed;
}

/** RSI removido do bot_scanner. */
export const RSI_1H_AUTO_EXEC_STRATEGY_NAMES = [] as const;
