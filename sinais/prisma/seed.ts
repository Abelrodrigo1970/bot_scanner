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
        'Gera sinais quando o volume do último candle fechado é maior que 12 vezes a média das últimas 20 horas. COMPRA: volume spike com preço a subir. VENDA: volume spike com preço a descer. Timeframe 1h.',
      params: JSON.stringify({
        volumeMultiplier: 12,
        lookbackHours: 20,
      }),
    },
    create: {
      name: 'VOLUME_SPIKE',
      displayName: 'Volume Spike 1h',
      description:
        'Gera sinais quando o volume do último candle fechado é maior que 12 vezes a média das últimas 20 horas. COMPRA: volume spike com preço a subir. VENDA: volume spike com preço a descer. Timeframe 1h.',
      isActive: true,
      params: JSON.stringify({
        volumeMultiplier: 12,
        lookbackHours: 20,
      }),
    },
  });

  // Estratégia Volume Spike 15m (15 períodos)
  const volumeSpike15mStrategy = await prisma.strategy.upsert({
    where: { name: 'VOLUME_SPIKE_15M' },
    update: {
      description:
        'Igual ao Volume Spike 1h mas em timeframe 15m com 15 períodos. Volume do último candle 15m fechado > 12x a média dos últimos 15 candles. COMPRA: preço a subir. VENDA: preço a descer.',
      params: JSON.stringify({
        volumeMultiplier: 12,
        lookbackPeriods: 15,
      }),
    },
    create: {
      name: 'VOLUME_SPIKE_15M',
      displayName: 'Volume Spike 15m',
      description:
        'Igual ao Volume Spike 1h mas em timeframe 15m com 15 períodos. Volume do último candle 15m fechado > 12x a média dos últimos 15 candles. COMPRA: preço a subir. VENDA: preço a descer.',
      isActive: true,
      params: JSON.stringify({
        volumeMultiplier: 12,
        lookbackPeriods: 15,
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
