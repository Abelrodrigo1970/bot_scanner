/** Normaliza variáveis de ambiente (Railway por vezes injecta espaços à frente). */
const KEYS = ['DATABASE_URL', 'ACCESS_CODE', 'CRON_SECRET'] as const;

for (const key of KEYS) {
  const value = process.env[key];
  if (typeof value === 'string') {
    process.env[key] = value.trim();
  }
}
