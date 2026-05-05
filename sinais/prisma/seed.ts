import { PrismaClient } from '@prisma/client';
import {
  MA_CROSS_5M_DESC,
  MA_CROSS_5M_DISPLAY,
  MA_CROSS_5M_PARAMS,
  MA_VOLATILE_MA30_SCAN_UNIVERSE_DESCRIPTION,
  migrateVolumeSpike15mToMaCross5m,
  RSI_MA30_SCAN_UNIVERSE_DESCRIPTION,
} from '../lib/strategyMigrations';

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando seed do banco de dados (RSI + Volume)...');

  const mig = await migrateVolumeSpike15mToMaCross5m(prisma);
  console.log(`[migração VOLUME_SPIKE_15M] ${mig.action}: ${mig.message}`);
  if (mig.signalsReassigned != null) {
    console.log(`  sinais reatribuídos: ${mig.signalsReassigned}`);
  }
  if (mig.signalsRelabeled != null && mig.signalsRelabeled > 0) {
    console.log(`  strategyName em sinais (estatísticas): ${mig.signalsRelabeled} actualizados para "${MA_CROSS_5M_DISPLAY}"`);
  }

  // Estratégia RSI 1h: SMA(RSI) vs nível 47 + universo Ma30Near6PriceBetween
  const rsiStrategy = await prisma.strategy.upsert({
    where: { name: 'RSI' },
    update: {
      displayName: 'RSI Top Volatilidade (SMA21×47)',
      description: RSI_MA30_SCAN_UNIVERSE_DESCRIPTION,
      params: JSON.stringify({
        period: 14,
        rsiSmoothLength: 21,
        rsiRefLevel: 47,
        buyStopPercent: 5,
        sellStopPercent: 5,
        rsiBuyGainTpPct: 43,
        rsiBuyGainTpPositionPct: 50,
        rsiSellGainTpPct: 43,
        rsiSellGainTpPositionPct: 50,
        closeAfterHours: 24,
        allowBuy: true,
        allowSell: true,
        exchange: 'binance',
      }),
    },
    create: {
      name: 'RSI',
      displayName: 'RSI Top Volatilidade (SMA21×47)',
      description: RSI_MA30_SCAN_UNIVERSE_DESCRIPTION,
      isActive: true,
      params: JSON.stringify({
        period: 14,
        rsiSmoothLength: 21,
        rsiRefLevel: 47,
        buyStopPercent: 5,
        sellStopPercent: 5,
        rsiBuyGainTpPct: 43,
        rsiBuyGainTpPositionPct: 50,
        rsiSellGainTpPct: 43,
        rsiSellGainTpPositionPct: 50,
        closeAfterHours: 24,
        allowBuy: true,
        allowSell: true,
        exchange: 'binance',
      }),
    },
  });

  // Estratégia Volume Spike (1h)
  const volumeSpikeStrategy = await prisma.strategy.upsert({
    where: { name: 'VOLUME_SPIKE' },
    update: {
      description:
        'Gera sinais quando o volume do último candle fechado é maior que 20 vezes a média das últimas 20 horas. COMPRA: volume spike com preço a subir. VENDA: volume spike com preço a descer. Timeframe 1h.',
      params: JSON.stringify({
        volumeMultiplier: 20,
        lookbackHours: 20,
        allowBuy: true,
        allowSell: true,
        exchange: 'bybit',
      }),
    },
    create: {
      name: 'VOLUME_SPIKE',
      displayName: 'Volume Spike 1h',
      description:
        'Gera sinais quando o volume do último candle fechado é maior que 20 vezes a média das últimas 20 horas. COMPRA: volume spike com preço a subir. VENDA: volume spike com preço a descer. Timeframe 1h.',
      isActive: true,
      params: JSON.stringify({
        volumeMultiplier: 20,
        lookbackHours: 20,
        allowBuy: true,
        allowSell: true,
        exchange: 'bybit',
      }),
    },
  });

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
        'MA12/MA30 em 1h: entrada por spread (>1,8%). TP parcial: 60% da posição quando o preço valoriza ≥44% vs entrada. Restante: fecho se spread <0,8%. SL 7%. Filtro SELL se |preço−MA30|/MA30>6%. Universo = scan Bybit Volume 1h >500k e MA200 (1h).',
      params: JSON.stringify({
        ma30Period: 12,
        ma200Period: 30,
        maType: 'EMA',
        useDiffMode: true,
        entryDiffPct: 1.8,
        exitDiffPct: 0.8,
        stopPercent: 7,
        sellBlockAbsCloseDistanceFromMa200Pct: 6,
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
        'MA12/MA30 em 1h: entrada por spread (>1,8%). TP parcial: 60% da posição quando o preço valoriza ≥44% vs entrada. Restante: fecho se spread <0,8%. SL 7%. Filtro SELL se |preço−MA30|/MA30>6%. Universo = scan Bybit Volume 1h >500k e MA200 (1h).',
      isActive: true,
      params: JSON.stringify({
        ma30Period: 12,
        ma200Period: 30,
        maType: 'EMA',
        useDiffMode: true,
        entryDiffPct: 1.8,
        exitDiffPct: 0.8,
        stopPercent: 7,
        sellBlockAbsCloseDistanceFromMa200Pct: 6,
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

  // Nova estratégia RSI 15m Top Volatilidade
  const rsi15mStrategy = await prisma.strategy.upsert({
    where: { name: 'RSI_15M' },
    update: {
      displayName: 'RSI 15m Reversal (28->32)',
      description:
        'RSI 15m reversal. Compra apenas quando o RSI da vela anterior está abaixo de 28 e o RSI actual fecha acima de 32. Apenas BUY, SL -3%, universo = scan MA30 entre −9% e −3% vs MA200 (1h).',
      params: JSON.stringify({
        period: 14,
        previousBelowThreshold: 28,
        buyThreshold: 32,
        stopPercent: 3,
        symbolLimit: 400,
        minQuoteVolume: 500000,
        allowBuy: true,
        allowSell: false,
        exchange: 'bybit',
      }),
    },
    create: {
      name: 'RSI_15M',
      displayName: 'RSI 15m Reversal (28->32)',
      description:
        'RSI 15m reversal. Compra apenas quando o RSI da vela anterior está abaixo de 28 e o RSI actual fecha acima de 32. Apenas BUY, SL -3%, universo = scan MA30 entre −9% e −3% vs MA200 (1h).',
      isActive: true,
      params: JSON.stringify({
        period: 14,
        previousBelowThreshold: 28,
        buyThreshold: 32,
        stopPercent: 3,
        symbolLimit: 400,
        minQuoteVolume: 500000,
        allowBuy: true,
        allowSell: false,
        exchange: 'bybit',
      }),
    },
  });

  const RSI_BYBIT_15M_UNIVERSE_DESCRIPTION =
    'Mesma lógica que o RSI 1h (SMA sobre RSI vs nível, TradingView): velas 15m. Universo = Ma30Above6Pct (MA30 > 9% da MA200 em 1h); actualiza o scan «MA30 > 9% MA200».';

  await prisma.strategy.upsert({
    where: { name: 'RSI_BYBIT_15M' },
    update: {
      displayName: 'RSI Bybit 15m (SMA21×47)',
      description: RSI_BYBIT_15M_UNIVERSE_DESCRIPTION,
      params: JSON.stringify({
        period: 14,
        rsiSmoothLength: 21,
        rsiRefLevel: 47,
        buyStopPercent: 5,
        sellStopPercent: 5,
        rsiBuyGainTpPct: 43,
        rsiBuyGainTpPositionPct: 50,
        rsiSellGainTpPct: 43,
        rsiSellGainTpPositionPct: 50,
        closeAfterHours: 24,
        allowBuy: true,
        allowSell: true,
        exchange: 'bybit',
      }),
    },
    create: {
      name: 'RSI_BYBIT_15M',
      displayName: 'RSI Bybit 15m (SMA21×47)',
      description: RSI_BYBIT_15M_UNIVERSE_DESCRIPTION,
      isActive: true,
      params: JSON.stringify({
        period: 14,
        rsiSmoothLength: 21,
        rsiRefLevel: 47,
        buyStopPercent: 5,
        sellStopPercent: 5,
        rsiBuyGainTpPct: 43,
        rsiBuyGainTpPositionPct: 50,
        rsiSellGainTpPct: 43,
        rsiSellGainTpPositionPct: 50,
        closeAfterHours: 24,
        allowBuy: true,
        allowSell: true,
        exchange: 'bybit',
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

  // Estratégia MA Cross 15m (Golden Cross / Death Cross MA30/MA200)
  await prisma.strategy.upsert({
    where: { name: 'MA_CROSS_15M' },
    update: {
      displayName: 'MA Cross 15m (MA30/MA200)',
      description:
        'Golden Cross / Death Cross 15m. BUY quando MA30 cruza MA200 para cima. SELL quando MA30 cruza MA200 para baixo. SL 8%. TP1 +85% (60% posição). Top Voláteis.',
      params: JSON.stringify({
        ma30Period: 30,
        ma200Period: 200,
        maType: 'EMA',
        confirmationPct: 0,
        stopPercent: 8,
        sellBlockAbsCloseDistanceFromMa200Pct: 6,
        tp1Percent: 85,
        tp1Position: 60,
        symbolLimit: 500,
        minQuoteVolume: 100000,
        allowBuy: true,
        allowSell: true,
        exchange: 'bybit',
      }),
    },
    create: {
      name: 'MA_CROSS_15M',
      displayName: 'MA Cross 15m (MA30/MA200)',
      description:
        'Golden Cross / Death Cross 15m. BUY quando MA30 cruza MA200 para cima. SELL quando MA30 cruza MA200 para baixo. SL 8%. TP1 +85% (60% posição). Top Voláteis.',
      isActive: false,
      params: JSON.stringify({
        ma30Period: 30,
        ma200Period: 200,
        maType: 'EMA',
        confirmationPct: 0,
        stopPercent: 8,
        sellBlockAbsCloseDistanceFromMa200Pct: 6,
        tp1Percent: 85,
        tp1Position: 60,
        symbolLimit: 500,
        minQuoteVolume: 100000,
        allowBuy: true,
        allowSell: true,
        exchange: 'bybit',
      }),
    },
  });

  // Remover estratégias que não usamos (caso existam de import anterior)
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
    rsi: rsiStrategy.id,
    volumeSpike: volumeSpikeStrategy.id,
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
