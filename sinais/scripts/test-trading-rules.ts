/**
 * Testa as regras de trading (Fase 2).
 * Uso: npx tsx scripts/test-trading-rules.ts
 */

import {
  canExecuteSignal,
  getExecutionParams,
  type SignalForTrading,
} from '../lib/tradingRules';

const mockSignalOk: SignalForTrading = {
  id: 'test-1',
  symbol: 'BTCUSDT',
  direction: 'BUY',
  entryPrice: 50000,
  stopLoss: 48000,
  target1: 60000,
  target2: 60000,
  target3: 60000,
  strength: 75,
  strategyName: 'Volume Spike 1h',
  status: 'NEW',
};

const mockSignalWeak: SignalForTrading = {
  ...mockSignalOk,
  strength: 65,
  id: 'test-2',
};

const mockSignalWrongStrategy: SignalForTrading = {
  ...mockSignalOk,
  strategyName: 'RSI',
  id: 'test-3',
};

const mockSignalNotNew: SignalForTrading = {
  ...mockSignalOk,
  status: 'IN_PROGRESS',
  id: 'test-4',
};

async function main() {
  console.log('=== Teste Regras de Trading ===\n');

  console.log('1. Sinal OK (Volume Spike, força 75, NEW):');
  const c1 = canExecuteSignal(mockSignalOk);
  console.log('   canExecute:', c1);
  const p1 = getExecutionParams(mockSignalOk);
  console.log('   params:', JSON.stringify(p1, null, 2));
  console.log('');

  console.log('2. Sinal com força 65 (< 70):');
  const c2 = canExecuteSignal(mockSignalWeak);
  console.log('   canExecute:', c2);
  console.log('');

  console.log('3. Sinal RSI (estratégia não permitida):');
  const c3 = canExecuteSignal(mockSignalWrongStrategy);
  console.log('   canExecute:', c3);
  console.log('');

  console.log('4. Sinal IN_PROGRESS (não NEW):');
  const c4 = canExecuteSignal(mockSignalNotNew);
  console.log('   canExecute:', c4);
  console.log('');

  console.log('✅ Testes concluídos');
}

main().catch(console.error);
