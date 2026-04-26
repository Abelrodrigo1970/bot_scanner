/**
 * Configuração da Bybit para o bot de trading.
 * Por defeito: Demo Trading ou Testnet (sem dinheiro real).
 * Mainnet (dinheiro real): `BYBIT_BASE_URL=https://api.bybit.com` + `BYBIT_ALLOW_MAINNET=true`.
 * Docs Demo: https://bybit-exchange.github.io/docs/v5/demo
 */

/** Demo Trading (fundos fictícios, API keys criadas no modo Demo da conta). */
const BYBIT_DEMO_DEFAULT = 'https://api-demo.bybit.com';

export function getBybitBaseUrl(): string {
  const url = process.env.BYBIT_BASE_URL;
  if (url) return url.replace(/\/$/, '');
  return BYBIT_DEMO_DEFAULT;
}

function bybitBaseHostname(): string {
  try {
    return new URL(getBybitBaseUrl()).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isBybitTestnet(): boolean {
  return getBybitBaseUrl().toLowerCase().includes('testnet');
}

/** Demo Trading (api-demo.bybit.com) — não é Mainnet real. */
export function isBybitDemo(): boolean {
  return getBybitBaseUrl().toLowerCase().includes('api-demo');
}

/** Mainnet global V5 (dinheiro real). Só usar com chaves de conta real e opt-in explícito. */
export function isBybitMainnet(): boolean {
  const host = bybitBaseHostname();
  if (!host) return false;
  if (host.includes('testnet') || host.includes('demo')) return false;
  return host === 'api.bybit.com';
}

function isBybitAllowMainnetEnv(): boolean {
  const v = (process.env.BYBIT_ALLOW_MAINNET || '').toLowerCase().trim();
  return v === 'true' || v === '1' || v === 'yes';
}

/** Demo ou Testnet (sem conta real). */
export function isBybitPaperTrading(): boolean {
  return isBybitTestnet() || isBybitDemo();
}

/**
 * O executor pode enviar ordens nesta configuração de URL?
 * Paper (demo/testnet) sempre; mainnet só com `BYBIT_ALLOW_MAINNET=true`.
 */
export function canExecuteOnBybit(): boolean {
  if (isBybitPaperTrading()) return true;
  return isBybitMainnet() && isBybitAllowMainnetEnv();
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
