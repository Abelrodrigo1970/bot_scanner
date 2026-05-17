import { PrismaClient } from '@prisma/client';
import {
  MA_CROSS_5M_DESC,
  MA_CROSS_5M_DISPLAY,
  MA_CROSS_5M_PARAMS,
  MA_VOLATILE_MA30_SCAN_UNIVERSE_DESCRIPTION,
  migrateVolumeSpike15mToMaCross5m,
  removeDeprecatedStrategies,
} from '../lib/strategyMigrations';

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando seed do banco de dados (RSI + Volume)...');

  const deprecated = await removeDeprecatedStrategies(prisma);
  if (deprecated.removed.length > 0) {
    console.log(`[estratégias retiradas] ${deprecated.removed.join(', ')}`);
  }

  const mig = await migrateVolumeSpike15mToMaCross5m(prisma);
  console.log(`[migração VOLUME_SPIKE_15M] ${mig.action}: ${mig.message}`);
  if (mig.signalsReassigned != null) {
    console.log(`  sinais reatribuídos: ${mig.signalsReassigned}`);
  }
  if (mig.signalsRelabeled != null && mig.signalsRelabeled > 0) {
    console.log(`  strategyName em sinais (estatísticas): ${mig.signalsRelabeled} actualizados para "${MA_CROSS_5M_DISPLAY}"`);
  }

  // Estratégia MA Cross Top Voláteis (universo = MA Cross Proximidade / MaCrossBelow na BD)
  const maVolatileStrategy = await prisma.strategy.upsert({
    where: { name: 'MA_VOLATILE' },
    update: {
      description: MA_VOLATILE_MA30_SCAN_UNIVERSE_DESCRIPTION,
      params: JSON.stringify({
        ma60Period: 60,
        ma200Period: 200,
        confirmationPct: 2,
        buyStopPercent: 15,
        buyTp1Percent: 30,
        buyTp1Position: 40,
        buyTp2Percent: 60,
        buyTp2Position: 30,
        sellStopPercent: 15,
        sellTp1Percent: 30,
        sellTp1Position: 40,
        sellTp2Percent: 60,
        sellTp2Position: 30,
        allowBuy: true,
        allowSell: false,
        exchange: 'binance',
      }),
    },
    create: {
      name: 'MA_VOLATILE',
      displayName: 'MA Cross Top Voláteis',
      description: MA_VOLATILE_MA30_SCAN_UNIVERSE_DESCRIPTION,
      isActive: true,
      params: JSON.stringify({
        ma60Period: 60,
        ma200Period: 200,
        confirmationPct: 2,
        buyStopPercent: 15,
        buyTp1Percent: 30,
        buyTp1Position: 40,
        buyTp2Percent: 60,
        buyTp2Position: 30,
        sellStopPercent: 15,
        sellTp1Percent: 30,
        sellTp1Position: 40,
        sellTp2Percent: 60,
        sellTp2Position: 30,
        allowBuy: true,
        allowSell: false,
        exchange: 'binance',
      }),
    },
  });

  // MA Cross 5m (MA12/MA30) — velas 5m; cron típico a cada 15 min
  const maCross5mStrategy = await prisma.strategy.upsert({
    where: { name: 'MA_CROSS_5M' },
    update: {
      displayName: MA_CROSS_5M_DISPLAY,
      description: MA_CROSS_5M_DESC,
      params: JSON.stringify(MA_CROSS_5M_PARAMS),
    },
    create: {
      name: 'MA_CROSS_5M',
      displayName: MA_CROSS_5M_DISPLAY,
      description: MA_CROSS_5M_DESC,
      isActive: true,
      params: JSON.stringify(MA_CROSS_5M_PARAMS),
    },
  });

  const maCross1hStrategy = await prisma.strategy.upsert({
    where: { name: 'MA_CROSS_1H' },
    update: {
      isActive: true,
      displayName: 'MA Cross 1h (MA12/MA30)',
      description:
        'MA12/MA30 em 1h: entrada por spread (>1,2%). Só entra se |MA30−MA200|/MA200 ≤ 8% (MA200 período 200 em 1h). TP parcial: 60% da posição quando o preço valoriza ≥44% vs entrada. Restante: fecho se spread <0,8%. SL 7%. Filtro BUY e SELL: só se |preço−MA30|/MA30 ≤ 8%. Universo = scan Bybit Volume 1h >500k e MA200 (1h).',
      params: JSON.stringify({
        ma30Period: 12,
        ma200Period: 30,
        maType: 'EMA',
        useDiffMode: true,
        entryDiffPct: 1.2,
        exitDiffPct: 0.8,
        stopPercent: 7,
        buyBlockAbsCloseDistanceFromMa200Pct: 8,
        sellBlockAbsCloseDistanceFromMa200Pct: 8,
        entryMaxAbsPctMa30VsMa200: 8,
        allowBuy: true,
        allowSell: true,
        exchange: 'bybit',
        ma12x30RepeatWhileTrend: true,
        ma12x30GainTpPct: 44,
        ma12x30GainTpPositionPct: 60,
      }),
    },
    create: {
      name: 'MA_CROSS_1H',
      displayName: 'MA Cross 1h (MA12/MA30)',
      description:
        'MA12/MA30 em 1h: entrada por spread (>1,2%). Só entra se |MA30−MA200|/MA200 ≤ 8% (MA200 período 200 em 1h). TP parcial: 60% da posição quando o preço valoriza ≥44% vs entrada. Restante: fecho se spread <0,8%. SL 7%. Filtro BUY e SELL: só se |preço−MA30|/MA30 ≤ 8%. Universo = scan Bybit Volume 1h >500k e MA200 (1h).',
      isActive: true,
      params: JSON.stringify({
        ma30Period: 12,
        ma200Period: 30,
        maType: 'EMA',
        useDiffMode: true,
        entryDiffPct: 1.2,
        exitDiffPct: 0.8,
        stopPercent: 7,
        buyBlockAbsCloseDistanceFromMa200Pct: 8,
        sellBlockAbsCloseDistanceFromMa200Pct: 8,
        entryMaxAbsPctMa30VsMa200: 8,
        allowBuy: true,
        allowSell: true,
        exchange: 'bybit',
        ma12x30RepeatWhileTrend: true,
        ma12x30GainTpPct: 44,
        ma12x30GainTpPositionPct: 60,
      }),
    },
  });

  // Estratégia MA (somente MA200) nos 20 Top Voláteis
  const ma200VolatileStrategy = await prisma.strategy.upsert({
    where: { name: 'MA200_VOLATILE' },
    update: {
      description:
        'MA200 4h. Universo alargado de símbolos líquidos. COMPRA: fecha 2%+ acima MA200, só se a distância à média for inferior a 10% → SL -4% | TP1 +80% (70%) | restante às 24h. VENDA: fecha 2%+ abaixo MA200, só se a distância à média for inferior a 10% → SL +4% | TP1 -80% (70%) | restante às 24h.',
      params: JSON.stringify({
        ma200Period: 200,
        confirmationPct: 2,
        maxDistancePct: 10,
        buyStopPercent: 4,
        buyTp1Percent: 80,
        buyTp1Position: 70,
        sellStopPercent: 4,
        sellTp1Percent: 80,
        sellTp1Position: 70,
        closeAfterHours: 24,
        symbolLimit: 500,
        minQuoteVolume: 100000,
        allowBuy: true,
        allowSell: true,
        exchange: 'binance',
      }),
    },
    create: {
      name: 'MA200_VOLATILE',
      displayName: 'MA200 Top Voláteis',
      description:
        'MA200 4h. Universo alargado de símbolos líquidos. COMPRA: fecha 2%+ acima MA200, só se a distância à média for inferior a 10% → SL -4% | TP1 +80% (70%) | restante às 24h. VENDA: fecha 2%+ abaixo MA200, só se a distância à média for inferior a 10% → SL +4% | TP1 -80% (70%) | restante às 24h.',
      isActive: true,
      params: JSON.stringify({
        ma200Period: 200,
        confirmationPct: 2,
        maxDistancePct: 10,
        buyStopPercent: 4,
        buyTp1Percent: 80,
        buyTp1Position: 70,
        sellStopPercent: 4,
        sellTp1Percent: 80,
        sellTp1Position: 70,
        closeAfterHours: 24,
        symbolLimit: 500,
        minQuoteVolume: 100000,
        allowBuy: true,
        allowSell: true,
        exchange: 'binance',
      }),
    },
  });

  await prisma.strategy.upsert({
    where: { name: 'EMA_SCALPING' },
    update: {
      displayName: 'EMA Ribbon Scalping (15m)',
      description:
        'Scalping 15m tipo «EMA Ribbon»: só COMPRA. Fita 8×55 por defeito (parametrizável); tendência com subida forte da EMA lenta; consolidação + rompimento SB ou pullback à fita + SB; TP por R. Binance Futures. Universo Top movers 1h (limite parametrizável).',
      params: JSON.stringify({
        ribbonFastPeriod: 8,
        ribbonSlowPeriod: 55,
        atrPeriod: 14,
        slopeLookback: 5,
        minSlowEmaSlopePct: 0.85,
        consolidationLookback: 14,
        consolidationMaxRangePct: 1.35,
        pullbackMaxBars: 10,
        strongBodyOfRangeMin: 0.58,
        strongBodyMinAtrMult: 0.42,
        symbolLimit: 80,
        rewardRisk1: 1.65,
        rewardRisk2: 3.2,
        tp1PositionPct: 55,
        tp2PositionPct: 35,
        allowBuy: true,
        allowSell: false,
        exchange: 'binance',
      }),
    },
    create: {
      name: 'EMA_SCALPING',
      displayName: 'EMA Ribbon Scalping (15m)',
      description:
        'Scalping 15m tipo «EMA Ribbon»: só COMPRA. Fita 8×55 por defeito (parametrizável); tendência com subida forte da EMA lenta; consolidação + rompimento SB ou pullback à fita + SB; TP por R. Binance Futures. Universo Top movers 1h (limite parametrizável).',
      isActive: true,
      params: JSON.stringify({
        ribbonFastPeriod: 8,
        ribbonSlowPeriod: 55,
        atrPeriod: 14,
        slopeLookback: 5,
        minSlowEmaSlopePct: 0.85,
        consolidationLookback: 14,
        consolidationMaxRangePct: 1.35,
        pullbackMaxBars: 10,
        strongBodyOfRangeMin: 0.58,
        strongBodyMinAtrMult: 0.42,
        symbolLimit: 80,
        rewardRisk1: 1.65,
        rewardRisk2: 3.2,
        tp1PositionPct: 55,
        tp2PositionPct: 35,
        allowBuy: true,
        allowSell: false,
        exchange: 'binance',
      }),
    },
  });

  await prisma.strategy.upsert({
    where: { name: 'EMA_SCALPING_SELL' },
    update: {
      displayName: 'EMA Ribbon Scalping SELL (15m)',
      description:
        'Scalping 15m «EMA Ribbon» só VENDA: fita descendente; pullback/consolidação à fita; vela bear forte abaixo da EMA rápida; SL acima do swing ou EMA lenta + folga; TP por R. Binance. Top movers 1h.',
      params: JSON.stringify({
        ribbonFastPeriod: 8,
        ribbonSlowPeriod: 55,
        atrPeriod: 14,
        slopeLookback: 5,
        minSlowEmaSlopePct: 0.85,
        consolidationLookback: 14,
        consolidationMaxRangePct: 1.35,
        pullbackMaxBars: 10,
        strongBodyOfRangeMin: 0.58,
        strongBodyMinAtrMult: 0.42,
        symbolLimit: 80,
        rewardRisk1: 1.65,
        rewardRisk2: 3.2,
        tp1PositionPct: 55,
        tp2PositionPct: 35,
        allowBuy: false,
        allowSell: true,
        exchange: 'binance',
      }),
    },
    create: {
      name: 'EMA_SCALPING_SELL',
      displayName: 'EMA Ribbon Scalping SELL (15m)',
      description:
        'Scalping 15m «EMA Ribbon» só VENDA: fita descendente; pullback/consolidação à fita; vela bear forte abaixo da EMA rápida; SL acima do swing ou EMA lenta + folga; TP por R. Binance. Top movers 1h.',
      isActive: false,
      params: JSON.stringify({
        ribbonFastPeriod: 8,
        ribbonSlowPeriod: 55,
        atrPeriod: 14,
        slopeLookback: 5,
        minSlowEmaSlopePct: 0.85,
        consolidationLookback: 14,
        consolidationMaxRangePct: 1.35,
        pullbackMaxBars: 10,
        strongBodyOfRangeMin: 0.58,
        strongBodyMinAtrMult: 0.42,
        symbolLimit: 80,
        rewardRisk1: 1.65,
        rewardRisk2: 3.2,
        tp1PositionPct: 55,
        tp2PositionPct: 35,
        allowBuy: false,
        allowSell: true,
        exchange: 'binance',
      }),
    },
  });

  // Remover estratégias legadas (caso existam de import anterior)
  const removed = await prisma.strategy.deleteMany({
    where: {
      name: {
        in: [
          'MACD_HISTOGRAM',
          'MACD_HISTOGRAM_PMO',
          'MA60_CROSSOVER',
          'SCANNER_APLUS',
          'MULTI_TIMEFRAME',
          'PMO',
          'MA_CROSSOVER',
          'MACD',
          ...deprecated.removed,
        ],
      },
    },
  });

  if (removed.count > 0) {
    console.log(`Removidas ${removed.count} estratégias antigas`);
  }

  // Configuração: trades na Binance desativados por defeito
  await prisma.appSetting.upsert({
    where: { key: 'trading_enabled' },
    update: {},
    create: { key: 'trading_enabled', value: 'false' },
  });

  console.log('Seed concluído!');
  console.log('Estratégias (ids):', {
    maCross5m: maCross5mStrategy.id,
    maCross1h: maCross1hStrategy.id,
    maVolatile: maVolatileStrategy.id,
    ma200Volatile: ma200VolatileStrategy.id,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
