import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando seed do banco de dados (RSI + Volume)...');

  // Estratégia RSI (invertida / momentum) com filtro MA200
  const rsiStrategy = await prisma.strategy.upsert({
    where: { name: 'RSI' },
    update: {
      displayName: 'RSI Top Volatilidade (60/40)',
      description:
        'Só Top Voláteis 1h. BUY quando RSI cruza acima de 60 E preço > MA200 → SL -9% | TP1 +8% (25%) | TP2 +21% (35%) | 40% às 24h. SELL quando RSI cruza abaixo de 40 E preço < MA200 → SL +5% | TP1 -9% (25%) | TP2 -15% (35%) | 40% às 24h.',
      params: JSON.stringify({
        period: 14,
        buyThreshold: 60,
        sellThreshold: 40,
        maPeriod: 200,
        allowBuy: true,
        allowSell: true,
        exchange: 'binance',
      }),
    },
    create: {
      name: 'RSI',
      displayName: 'RSI Top Volatilidade (60/40)',
      description:
        'Só Top Voláteis 1h. BUY quando RSI cruza acima de 60 E preço > MA200 → SL -9% | TP1 +8% (25%) | TP2 +21% (35%) | 40% às 24h. SELL quando RSI cruza abaixo de 40 E preço < MA200 → SL +5% | TP1 -9% (25%) | TP2 -15% (35%) | 40% às 24h.',
      isActive: true,
      params: JSON.stringify({
        period: 14,
        buyThreshold: 60,
        sellThreshold: 40,
        maPeriod: 200,
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
        'Top Voláteis 15m. COMPRA: fecha 2%+ acima MA60 → SL -8% | TP1 +8% (40%) | TP2 +15% (30%) | 30% na reversão. VENDA: fecha 2%+ abaixo MA60 → SL +8% | TP1 -9% (40%) | TP2 -17% (30%) | 30% na reversão.',
      params: JSON.stringify({
        ma60Period: 60,
        ma200Period: 200,
        confirmationPct: 2,
        buyStopPercent: 8,
        buyTp1Percent: 8,
        buyTp1Position: 40,
        buyTp2Percent: 15,
        buyTp2Position: 30,
        sellStopPercent: 8,
        sellTp1Percent: 9,
        sellTp1Position: 40,
        sellTp2Percent: 17,
        sellTp2Position: 30,
        allowBuy: false,
        allowSell: true,
        exchange: 'binance',
      }),
    },
    create: {
      name: 'MA_VOLATILE',
      displayName: 'MA Cross Top Voláteis',
      description:
        'Top Voláteis 15m. COMPRA: fecha 2%+ acima MA60 → SL -8% | TP1 +8% (40%) | TP2 +15% (30%) | 30% na reversão. VENDA: fecha 2%+ abaixo MA60 → SL +8% | TP1 -9% (40%) | TP2 -17% (30%) | 30% na reversão.',
      isActive: true,
      params: JSON.stringify({
        ma60Period: 60,
        ma200Period: 200,
        confirmationPct: 2,
        buyStopPercent: 8,
        buyTp1Percent: 8,
        buyTp1Position: 40,
        buyTp2Percent: 15,
        buyTp2Position: 30,
        sellStopPercent: 8,
        sellTp1Percent: 9,
        sellTp1Position: 40,
        sellTp2Percent: 17,
        sellTp2Position: 30,
        allowBuy: false,
        allowSell: true,
        exchange: 'binance',
      }),
    },
  });

  // Estratégia Volume Spike 15m (15 períodos)
  const volumeSpike15mStrategy = await prisma.strategy.upsert({
    where: { name: 'VOLUME_SPIKE_15M' },
    update: {
      description:
        'Igual ao Volume Spike 1h mas em timeframe 15m com 15 períodos. Volume do último candle 15m fechado > 20x a média dos últimos 15 candles. COMPRA: preço a subir. VENDA: preço a descer.',
      params: JSON.stringify({
        volumeMultiplier: 20,
        lookbackPeriods: 15,
        allowBuy: false,
        allowSell: true,
        exchange: 'binance',
      }),
    },
    create: {
      name: 'VOLUME_SPIKE_15M',
      displayName: 'Volume Spike 15m',
      description:
        'Igual ao Volume Spike 1h mas em timeframe 15m com 15 períodos. Volume do último candle 15m fechado > 20x a média dos últimos 15 candles. COMPRA: preço a subir. VENDA: preço a descer.',
      isActive: true,
      params: JSON.stringify({
        volumeMultiplier: 20,
        lookbackPeriods: 15,
        allowBuy: false,
        allowSell: true,
        exchange: 'binance',
      }),
    },
  });

  // Estratégia MA (somente MA200) nos 20 Top Voláteis
  const ma200VolatileStrategy = await prisma.strategy.upsert({
    where: { name: 'MA200_VOLATILE' },
    update: {
      description:
        'Top Voláteis 1h. COMPRA: fecha 2%+ acima MA200 → SL -8% | TP1 +8% (40%) | TP2 +15% (30%) | 30% na reversão. VENDA: fecha 2%+ abaixo MA200 → SL +8% | TP1 -9% (40%) | TP2 -17% (30%) | 30% na reversão.',
      params: JSON.stringify({
        ma200Period: 200,
        confirmationPct: 2,
        buyStopPercent: 8,
        buyTp1Percent: 8,
        buyTp1Position: 40,
        buyTp2Percent: 15,
        buyTp2Position: 30,
        sellStopPercent: 8,
        sellTp1Percent: 9,
        sellTp1Position: 40,
        sellTp2Percent: 17,
        sellTp2Position: 30,
        allowBuy: true,
        allowSell: true,
        exchange: 'binance',
      }),
    },
    create: {
      name: 'MA200_VOLATILE',
      displayName: 'MA200 Top Voláteis',
      description:
        'Top Voláteis 1h. COMPRA: fecha 2%+ acima MA200 → SL -8% | TP1 +8% (40%) | TP2 +15% (30%) | 30% na reversão. VENDA: fecha 2%+ abaixo MA200 → SL +8% | TP1 -9% (40%) | TP2 -17% (30%) | 30% na reversão.',
      isActive: true,
      params: JSON.stringify({
        ma200Period: 200,
        confirmationPct: 2,
        buyStopPercent: 8,
        buyTp1Percent: 8,
        buyTp1Position: 40,
        buyTp2Percent: 15,
        buyTp2Position: 30,
        sellStopPercent: 8,
        sellTp1Percent: 9,
        sellTp1Position: 40,
        sellTp2Percent: 17,
        sellTp2Position: 30,
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
      displayName: 'RSI 15m Top Volatilidade (62/38)',
      description:
        'Só Top Voláteis 15m. BUY quando RSI cruza acima de 62 E preço > MA200 → SL -5% | TP1 +5% (35%) | TP2 +11% (35%) | 30% às 24h. SELL quando RSI cruza abaixo de 38 E preço < MA200 → SL +5% | TP1 -5% (30%) | TP2 -11% (35%) | 35% às 24h.',
      params: JSON.stringify({
        period: 14,
        buyThreshold: 62,
        sellThreshold: 38,
        maPeriod: 200,
        allowBuy: true,
        allowSell: true,
        exchange: 'bybit',
      }),
    },
    create: {
      name: 'RSI_15M',
      displayName: 'RSI 15m Top Volatilidade (62/38)',
      description:
        'Só Top Voláteis 15m. BUY quando RSI cruza acima de 62 E preço > MA200 → SL -5% | TP1 +5% (35%) | TP2 +11% (35%) | 30% às 24h. SELL quando RSI cruza abaixo de 38 E preço < MA200 → SL +5% | TP1 -5% (30%) | TP2 -11% (35%) | 35% às 24h.',
      isActive: true,
      params: JSON.stringify({
        period: 14,
        buyThreshold: 62,
        sellThreshold: 38,
        maPeriod: 200,
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
  console.log('Estratégias ativas:', {
    rsi: rsiStrategy.id,
    volumeSpike: volumeSpikeStrategy.id,
    volumeSpike15m: volumeSpike15mStrategy.id,
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
