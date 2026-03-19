/**
 * Testa o cliente Binance Futures (Fase 1).
 * Requer BINANCE_API_KEY, BINANCE_API_SECRET e opcionalmente BINANCE_FUTURES_BASE_URL.
 * Uso: npx tsx scripts/test-binance-client.ts
 */

import { getPositionRisk, getTickerPrice } from '../lib/binanceFuturesClient';
import {
  getBinanceFuturesBaseUrl,
  isTestnet,
  hasTradingCredentials,
} from '../lib/binanceConfig';

async function main() {
  console.log('=== Teste Cliente Binance Futures ===\n');

  console.log('Config:');
  console.log('  Base URL:', getBinanceFuturesBaseUrl());
  console.log('  Testnet:', isTestnet());
  console.log('  Credenciais:', hasTradingCredentials() ? 'OK' : 'FALTA (API_KEY/SECRET)');
  console.log('');

  if (!hasTradingCredentials()) {
    console.log('Configure BINANCE_API_KEY e BINANCE_API_SECRET no .env');
    console.log('Para Testnet: BINANCE_FUTURES_BASE_URL=https://testnet.binancefuture.com');
    process.exit(1);
  }

  try {
    const positions = await getPositionRisk();
    const active = positions.filter((p) => parseFloat(p.positionAmt) !== 0);
    console.log('Posições abertas:', active.length);
    if (active.length > 0) {
      active.slice(0, 5).forEach((p) => {
        console.log(`  - ${p.symbol}: ${p.positionAmt} @ ${p.entryPrice}`);
      });
    }
    console.log('');

    const btcPrice = await getTickerPrice('BTCUSDT');
    console.log('Preço BTCUSDT:', btcPrice);
    console.log('\n✅ Cliente OK');
  } catch (error: unknown) {
    console.error('❌ Erro:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
