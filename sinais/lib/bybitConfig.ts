/**
 * Configuração da Bybit para o bot de trading.
 * Suporta Linear Futures (USDT perpetual) em Mainnet e Testnet.
 */

const BYBIT_MAINNET = 'https://api.bybit.com';
const BYBIT_TESTNET = 'https://api-testnet.bybit.com';

export function getBybitBaseUrl(): string {
  const url = process.env.BYBIT_BASE_URL;
  if (url) return url.replace(/\/$/, '');
  return BYBIT_MAINNET;
}

export function isBybitTestnet(): boolean {
  return getBybitBaseUrl().includes('testnet');
}

export function hasBybitCredentials(): boolean {
  const key    = process.env.BYBIT_API_KEY;
  const secret = process.env.BYBIT_API_SECRET;
  return Boolean(key && secret && key.length > 0 && secret.length > 0);
}

/** Define EXCHANGE=bybit para activar a execução na Bybit em vez da Binance. */
export function isBybitEnabled(): boolean {
  return (process.env.EXCHANGE || '').toLowerCase() === 'bybit';
}
