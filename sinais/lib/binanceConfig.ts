/**
 * Configuração do Binance Futures para o bot de trading.
 * Fase 1: apenas define URL e valida variáveis.
 */

const BINANCE_MAINNET = 'https://fapi.binance.com';
const BINANCE_TESTNET = 'https://testnet.binancefuture.com';

export function getBinanceFuturesBaseUrl(): string {
  const url = process.env.BINANCE_FUTURES_BASE_URL;
  if (url) return url.replace(/\/$/, ''); // remove trailing slash
  return BINANCE_MAINNET;
}

export function isTestnet(): boolean {
  const url = getBinanceFuturesBaseUrl();
  return url.includes('testnet');
}

export function hasTradingCredentials(): boolean {
  const key = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_API_SECRET;
  return Boolean(key && secret && key.length > 0 && secret.length > 0);
}

export function isTradingEnabled(): boolean {
  return process.env.TRADING_ENABLED === 'true';
}

/**
 * Notional USDT por trade (posição).
 * Produção: 80 USDT. `POSITION_SIZE_USDT` no Railway/env sobrescreve (excepto legado 60 → 80).
 */
export function getPositionSizeUsdt(): number {
  const raw = process.env.POSITION_SIZE_USDT;
  if (raw != null && String(raw).trim() !== '') {
    const val = parseFloat(raw);
    if (Number.isFinite(val) && val > 0) {
      // Migração: produção tinha 60; pedido para passar a 80
      if (val === 60) return 80;
      return val;
    }
  }
  return 80;
}

/** Força mínima para execução automática (sem confirmação). Default 80 para haver ordens automáticas. */
export function getAutoExecuteMinStrength(): number {
  const val = parseInt(process.env.AUTO_EXECUTE_MIN_STRENGTH || '80', 10);
  return Number.isFinite(val) && val >= 70 && val <= 100 ? val : 80;
}
