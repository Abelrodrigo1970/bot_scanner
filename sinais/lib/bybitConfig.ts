/**
 * Configuração da Bybit para o bot de trading.
 * Só ambientes sem dinheiro real: Demo Trading ou Testnet.
 * Docs Demo: https://bybit-exchange.github.io/docs/v5/demo
 */

/** Demo Trading (fundos fictícios, API keys criadas no modo Demo da conta). */
const BYBIT_DEMO_DEFAULT = 'https://api-demo.bybit.com';

export function getBybitBaseUrl(): string {
  const url = process.env.BYBIT_BASE_URL;
  if (url) return url.replace(/\/$/, '');
  return BYBIT_DEMO_DEFAULT;
}

export function isBybitTestnet(): boolean {
  return getBybitBaseUrl().toLowerCase().includes('testnet');
}

/** Demo Trading (api-demo.bybit.com) — não é Mainnet real. */
export function isBybitDemo(): boolean {
  return getBybitBaseUrl().toLowerCase().includes('api-demo');
}

/** Ambiente permitido pelo bot: Testnet ou Demo (nunca Mainnet real). */
export function isBybitPaperTrading(): boolean {
  return isBybitTestnet() || isBybitDemo();
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
