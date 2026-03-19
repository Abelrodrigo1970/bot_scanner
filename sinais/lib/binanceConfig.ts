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

export function getPositionSizeUsdt(): number {
  const val = parseFloat(process.env.POSITION_SIZE_USDT || '100');
  return Number.isFinite(val) && val > 0 ? val : 100;
}

/** Força mínima para execução automática (sem confirmação). Default 80 para haver ordens automáticas. */
export function getAutoExecuteMinStrength(): number {
  const val = parseInt(process.env.AUTO_EXECUTE_MIN_STRENGTH || '80', 10);
  return Number.isFinite(val) && val >= 70 && val <= 100 ? val : 80;
}
