/**
 * Script para testar a estratégia VOLUME_SPIKE
 * Testa RLSUSDT e outros símbolos por % 24h; mostra volume do último candle fechado vs média.
 */

import { fetchCandles, fetchTopSymbolsBy24hPriceChange } from '../lib/marketData';
import { getVolumes, calculateVolumeMA } from '../lib/indicators';
import { runVolumeSpikeStrategy } from '../lib/signalEngine';

const LOOKBACK_HOURS = 20;
const VOLUME_MULTIPLIER = 6;

async function getVolumeStats(symbol: string) {
  const candles = await fetchCandles(symbol, '1h', LOOKBACK_HOURS + 5);
  if (candles.length < LOOKBACK_HOURS + 2) {
    return null;
  }
  const volumes = getVolumes(candles);
  const lastClosedIndex = volumes.length - 2;
  const currentVolume = volumes[lastClosedIndex];
  const volumesForAverage = volumes.slice(-LOOKBACK_HOURS - 2, -2);
  const volumeAverage = calculateVolumeMA(volumesForAverage, LOOKBACK_HOURS);
  if (volumeAverage === null || volumeAverage === 0) return null;
  const ratio = currentVolume / volumeAverage;
  const lastClosedTime = new Date(candles[lastClosedIndex].timestamp);
  return {
    symbol,
    lastClosedTime: lastClosedTime.toISOString(),
    currentVolume,
    volumeAverage,
    ratio,
    wouldTrigger: ratio >= VOLUME_MULTIPLIER,
  };
}

async function main() {
  console.log('🔍 Testando estratégia VOLUME_SPIKE (candle FECHADO vs média 20h)\n');

  // Incluir sempre RLSUSDT e buscar top por % 24h
  const symbolsByChange = await fetchTopSymbolsBy24hPriceChange(50, 500000);
  const symbolsToTest = Array.from(
    new Set(['RLSUSDT', 'BTCUSDT', 'ETHUSDT', ...symbolsByChange])
  ).slice(0, 30);

  console.log(`📊 Símbolos a testar: ${symbolsToTest.length} (inclui RLSUSDT e top por % 24h)\n`);
  console.log('═'.repeat(100));

  let signalsFound = 0;

  for (const symbol of symbolsToTest) {
    try {
      // Estatísticas de volume (último candle fechado)
      const stats = await getVolumeStats(symbol);
      if (!stats) {
        console.log(`⚠️  ${symbol.padEnd(12)} | Dados insuficientes`);
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      // Chamar a estratégia real
      const signal = await runVolumeSpikeStrategy(symbol, '1h', {
        volumeMultiplier: VOLUME_MULTIPLIER,
        lookbackHours: LOOKBACK_HOURS,
      });

      const ratioStr = stats.ratio.toFixed(2);
      const volStr = stats.currentVolume.toLocaleString('en', { maximumFractionDigits: 0 });
      const avgStr = stats.volumeAverage.toLocaleString('en', { maximumFractionDigits: 0 });
      const candleHour = stats.lastClosedTime.slice(11, 13) + 'h-' + (parseInt(stats.lastClosedTime.slice(11, 13), 10) + 1) + 'h';

      if (signal) {
        signalsFound++;
        console.log(`✅ ${symbol.padEnd(12)} | ${candleHour} | Vol: ${volStr} | Média: ${avgStr} | ${ratioStr}x | 🎯 SINAL ${signal.direction}`);
        const extra = JSON.parse(signal.extraInfo || '{}');
        if (extra.priceChangePercent != null) {
          console.log(`   └─ Preço: ${extra.priceChangePercent}% | Entry: ${signal.entryPrice} | Força: ${signal.strength}`);
        }
      } else {
        const icon = stats.wouldTrigger ? '?' : '⚪';
        console.log(`${icon} ${symbol.padEnd(12)} | ${candleHour} | Vol: ${volStr} | Média: ${avgStr} | ${ratioStr}x ${stats.wouldTrigger ? '(≥6x mas sem sinal?)' : ''}`);
      }

      await new Promise((r) => setTimeout(r, 250));
    } catch (err: any) {
      console.log(`❌ ${symbol.padEnd(12)} | Erro: ${err.message || err}`);
    }
  }

  console.log('═'.repeat(100));
  console.log('\n📊 RESUMO:');
  console.log('   Usamos o PENÚLTIMO candle (fechado); o último da API é o candle atual incompleto.');
  console.log(`   Condição de sinal: volume do candle fechado ≥ ${VOLUME_MULTIPLIER}x a média das ${LOOKBACK_HOURS}h anteriores.`);
  console.log(`   Sinais gerados: ${signalsFound}`);
  console.log('');
}

main().catch(console.error);
