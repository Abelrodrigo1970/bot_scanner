/**
 * Configuração da Bybit para o bot de trading.
 * Por defeito: Demo Trading ou Testnet (sem dinheiro real).
 * Mainnet (dinheiro real): `BYBIT_BASE_URL=https://api.bybit.com` + `BYBIT_ALLOW_MAINNET=true`.
 * Docs Demo: https://bybit-exchange.github.io/docs/v5/demo
 */

/** Demo Trading (fundos fictícios, API keys criadas no modo Demo da conta). */
const BYBIT_DEMO_DEFAULT = 'https://api-demo.bybit.com';

/** Mainnet regional (Holanda, EEA, etc.) — docs Bybit V5. */
const BYBIT_MAINNET_HOSTS = new Set([
  'api.bybit.com',
  'api.bytick.com',
  'api.bybit.nl',
  'api.bybit.eu',
  'api.bybit.tr',
  'api.bybit.kz',
  'api.bybitgeorgia.ge',
  'api.bybit.ae',
  'api.bybit.id',
]);

function isRailwayHosted(): boolean {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_PROJECT_ID ||
      process.env.RAILWAY_SERVICE_ID
  );
}

export function getBybitBaseUrl(): string {
  const raw = (process.env.BYBIT_BASE_URL || '').replace(/\/$/, '');
  if (raw) {
    // Railway EU: api.bybit.com devolve 403 CloudFront — mirror NL obrigatório
    if (
      isRailwayHosted() &&
      (raw === 'https://api.bybit.com' || raw.endsWith('api.bybit.com'))
    ) {
      return (process.env.BYBIT_BASE_URL_NL || 'https://api.bybit.nl').replace(/\/$/, '');
    }
    return raw;
  }
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

/** Mainnet global ou regional V5 (dinheiro real). */
export function isBybitMainnet(): boolean {
  const host = bybitBaseHostname();
  if (!host) return false;
  if (host.includes('testnet') || host.includes('demo')) return false;
  return BYBIT_MAINNET_HOSTS.has(host);
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
