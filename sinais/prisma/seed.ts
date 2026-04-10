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
        'Top Voláteis 1h. COMPRA: fecha 2%+ acima MA60 → SL -8% | TP1 +8% (40%) | TP2 +15% (30%) | 30% na reversão. VENDA: fecha 2%+ abaixo MA60 → SL +8% | TP1 -9% (40%) | TP2 -17% (30%) | 30% na reversão.',
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
        'Top Voláteis 1h. COMPRA: fecha 2%+ acima MA60 → SL -8% | TP1 +8% (40%) | TP2 +15% (30%) | 30% na reversão. VENDA: fecha 2%+ abaixo MA60 → SL +8% | TP1 -9% (40%) | TP2 -17% (30%) | 30% na reversão.',
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
        'MA200 4h. Universo alargado de símbolos líquidos. COMPRA: fecha 2%+ acima MA200, só se a distância à média for inferior a 10% → SL -11% | sem TP intermédio | saída na reversão. VENDA: fecha 2%+ abaixo MA200, só se a distância à média for inferior a 10% → SL +11% | sem TP intermédio | saída na reversão.',
      params: JSON.stringify({
        ma200Period: 200,
        confirmationPct: 2,
        maxDistancePct: 10,
        buyStopPercent: 11,
        sellStopPercent: 11,
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
        'MA200 4h. Universo alargado de símbolos líquidos. COMPRA: fecha 2%+ acima MA200, só se a distância à média for inferior a 10% → SL -11% | sem TP intermédio | saída na reversão. VENDA: fecha 2%+ abaixo MA200, só se a distância à média for inferior a 10% → SL +11% | sem TP intermédio | saída na reversão.',
      isActive: true,
      params: JSON.stringify({
        ma200Period: 200,
        confirmationPct: 2,
        maxDistancePct: 10,
        buyStopPercent: 11,
        sellStopPercent: 11,
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
