/**
 * Testa o executor (Fase 3) - simula execução com sinal mock.
 * Uso: npx tsx scripts/test-trading-executor.ts
 * (Não requer BD para evitar conflitos de schema)
 */

import { executeSignal, getExecutorStatus } from '../lib/tradingExecutor';

async function main() {
  console.log('=== Teste Trading Executor (dry run) ===\n');

  const status = getExecutorStatus();
  console.log('Status:', status);
  console.log('');

  const mockSignal = {
    id: 'mock-1',
    symbol: 'BTCUSDT',
    direction: 'BUY' as const,
    entryPrice: 50000,
    stopLoss: 48000,
    target1: 60000,
    target2: 60000,
    target3: 60000,
    strength: 75,
    strategyName: 'Volume Spike 1h',
    status: 'NEW',
  };

  console.log('Sinal mock:', mockSignal.symbol, mockSignal.direction, 'força', mockSignal.strength);
  console.log('');

  const result = executeSignal(mockSignal);

  console.log('\nResultado:', result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
