/**
 * Configurações da aplicação (guardadas na BD).
 * Usado para ativar/desativar trades na Binance sem afetar a geração de sinais.
 */

import { prisma } from './db';

const TRADING_ENABLED_KEY = 'trading_enabled';

/**
 * Verifica se os trades na Binance estão ativados.
 * Prioridade: 1) BD, 2) env TRADING_ENABLED.
 * Se não existir na BD, usa a variável de ambiente.
 */
export async function getTradingEnabled(): Promise<boolean> {
  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: TRADING_ENABLED_KEY },
    });
    if (row) {
      return row.value === 'true';
    }
    // Fallback: variável de ambiente
    return process.env.TRADING_ENABLED === 'true';
  } catch {
    return process.env.TRADING_ENABLED === 'true';
  }
}

/**
 * Ativa ou desativa os trades na Binance.
 * Os sinais continuam a ser gerados; apenas a execução de ordens é afetada.
 */
export async function setTradingEnabled(enabled: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: TRADING_ENABLED_KEY },
    update: { value: enabled ? 'true' : 'false' },
    create: { key: TRADING_ENABLED_KEY, value: enabled ? 'true' : 'false' },
  });
}
