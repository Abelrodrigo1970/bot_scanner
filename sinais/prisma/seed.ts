import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando seed do banco de dados (RSI + Volume)...');

  // Estratégia RSI (invertida / momentum) com filtro MA200
  const rsiStrategy = await prisma.strategy.upsert({
    where: { name: 'RSI' },
    update: {
      description:
        'COMPRA quando RSI sobe acima de 69 E preço > MA200. VENDA quando RSI desce abaixo de 29 E preço < MA200. Stop 10%, TP1 35% @ 9%, TP2 35% @ 24%, 30% às 24h.',
      params: JSON.stringify({
        period: 14,
        buyThreshold: 69,
        sellThreshold: 29,
        maPeriod: 200,
      }),
    },
    create: {
      name: 'RSI',
      displayName: 'RSI Momentum (cruzamento 69/29)',
      description:
        'COMPRA quando RSI sobe acima de 69 E preço > MA200. VENDA quando RSI desce abaixo de 29 E preço < MA200. Stop 10%, TP1 35% @ 9%, TP2 35% @ 24%, 30% às 24h.',
      isActive: true,
      params: JSON.stringify({
        period: 14,
        buyThreshold: 69,
        sellThreshold: 29,
        maPeriod: 200,
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
      }),
    },
  });

  // Estratégia MA Cross Voláteis (apenas nos 20 top voláteis)
  const maVolatileStrategy = await prisma.strategy.upsert({
    where: { name: 'MA_VOLATILE' },
    update: {
      description:
        'Analisa apenas as 20 Top Voláteis em 15m. COMPRA: preço cruza MA60 para cima. VENDA: cruza para baixo e abaixo da MA200. Stop 10%, TP1/TP2 iguais e TP3 no sinal contrário.',
      params: JSON.stringify({
        ma60Period: 60,
        ma200Period: 200,
        buyStopPercent: 10,
        buyTp1Percent: 20,
        buyTp1PositionPercent: 30,
        buyTp2Percent: 40,
        buyTp2PositionPercent: 40,
        sellStopPercent: 10,
        sellTp1Percent: 10,
        sellTp2Percent: 20,
      }),
    },
    create: {
      name: 'MA_VOLATILE',
      displayName: 'MA Cross Top Voláteis',
      description:
        'Analisa apenas as 20 Top Voláteis em 15m. COMPRA: preço cruza MA60 para cima. VENDA: cruza para baixo e abaixo da MA200. Stop 10%, TP1/TP2 iguais e TP3 no sinal contrário.',
      isActive: true,
      params: JSON.stringify({
        ma60Period: 60,
        ma200Period: 200,
        buyStopPercent: 10,
        buyTp1Percent: 20,
        buyTp1PositionPercent: 30,
        buyTp2Percent: 40,
        buyTp2PositionPercent: 40,
        sellStopPercent: 10,
        sellTp1Percent: 10,
        sellTp2Percent: 20,
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
