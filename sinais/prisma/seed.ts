import { PrismaClient } from '@prisma/client';
import {
  MA_CROSS_5M_DESC,
  MA_CROSS_5M_DISPLAY,
  MA_CROSS_5M_PARAMS,
  migrateVolumeSpike15mToMaCross5m,
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

  // Estratégia RSI (invertida / momentum) com filtro MA200
  const rsiStrategy = await prisma.strategy.upsert({
    where: { name: 'RSI' },
    update: {
      displayName: 'RSI Top Volatilidade (60/40)',
      description:
        'Só Top Voláteis 1h. BUY quando RSI cruza acima de 60 E preço > MA200 → SL -3% | sem TP intermédio | 100% às 24h. SELL quando RSI cruza abaixo de 40 E preço < MA200 → SL +3% | sem TP intermédio | 100% às 24h.',
      params: JSON.stringify({
        period: 14,
        buyThreshold: 60,
        sellThreshold: 40,
        maPeriod: 200,
        buyStopPercent: 3,
        sellStopPercent: 3,
        closeAfterHours: 24,
        allowBuy: true,
        allowSell: true,
        exchange: 'binance',
      }),
    },
    create: {
      name: 'RSI',
      displayName: 'RSI Top Volatilidade (60/40)',
      description:
        'Só Top Voláteis 1h. BUY quando RSI cruza acima de 60 E preço > MA200 → SL -3% | sem TP intermédio | 100% às 24h. SELL quando RSI cruza abaixo de 40 E preço < MA200 → SL +3% | sem TP intermédio | 100% às 24h.',
      isActive: true,
      params: JSON.stringify({
        period: 14,
        buyThreshold: 60,
        sellThreshold: 40,
        maPeriod: 200,
        buyStopPercent: 3,
        sellStopPercent: 3,
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

  // Estratégia MA Cross Voláteis (apenas nos 20 top voláteis)
  const maVolatileStrategy = await prisma.strategy.upsert({
    where: { name: 'MA_VOLATILE' },
    update: {
      description:
        'Top Voláteis 1h. COMPRA: fecha 2%+ acima MA60 → SL -15% | TP1 +30% (40%) | TP2 +60% (30%) | 30% na reversão. VENDA: fecha 2%+ abaixo MA60 → SL +15% | TP1 -30% (40%) | TP2 -60% (30%) | 30% na reversão.',
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
      description:
        'Top Voláteis 1h. COMPRA: fecha 2%+ acima MA60 → SL -15% | TP1 +30% (40%) | TP2 +60% (30%) | 30% na reversão. VENDA: fecha 2%+ abaixo MA60 → SL +15% | TP1 -30% (40%) | TP2 -60% (30%) | 30% na reversão.',
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

  // MA Cross 5m (MA30/MA60) — velas 5m; cron típico a cada 15 min
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
        'RSI 15m reversal. Compra apenas quando o RSI da vela anterior está abaixo de 28 e o RSI actual fecha acima de 32. Apenas BUY, SL -3%, universo alargado de símbolos líquidos.',
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
        'RSI 15m reversal. Compra apenas quando o RSI da vela anterior está abaixo de 28 e o RSI actual fecha acima de 32. Apenas BUY, SL -3%, universo alargado de símbolos líquidos.',
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
