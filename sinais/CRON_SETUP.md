# Cron Jobs — Bot Scanner

**Timezone no cron-job.org:** `Europe/Lisbon` (Portugal).

## Endpoints

| Endpoint | Estratégias | Frequência |
|----------|-------------|------------|
| `/api/cron/run-15m` | MA Cross 12×30 (15m) + Pivot Boss Bear 15m | `*/15 * * * *` (24h) |
| `/api/cron/run-universe-scans` | Scanner 1 (universo) | `0 */4 * * *` (24h) |

**Obsoleto** (remover do cron-job.org): `run-1h`, `run-30m`, `run-afastamento-30m`, `run-rsi-15m`, `run-scans-ma`, `run-signals`.

**Nota:** Rotações Top e outras estratégias estão no projeto **bot_cripto**.

## Configuração mínima (cron-job.org)

2 jobs com header `Authorization: Bearer SEU_CRON_SECRET`:

1. **Sinais 15m** — `run-15m` — `*/15 * * * *` (MA Cross + Pivot Boss 15m)
2. **Scanner 1** — `run-universe-scans` — `0 */4 * * *`

## Segurança

Definir `CRON_SECRET` no Railway.
