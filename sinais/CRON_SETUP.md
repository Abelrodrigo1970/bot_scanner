# Cron Jobs — Bot Scanner

**Timezone no cron-job.org:** `Europe/Lisbon` (Portugal).

## Endpoints

| Endpoint | Estratégias | Frequência |
|----------|-------------|------------|
| `/api/cron/run-15m` | MA Cross 15m | `*/15 * * * *` (24h) |
| `/api/cron/run-1h` | Pivot Boss Bear 15m | `0 * * * *` (24h) |
| `/api/cron/run-universe-scans` | Scanner 1 (universo) | `0 */4 * * *` (24h) |

**Desactivados** (remover do cron-job.org se existirem): `run-30m`, `run-afastamento-30m`, `run-rsi-15m`.

**Nota:** Rotações Top e outras estratégias estão no projeto **bot_cripto**.

## Configuração mínima (cron-job.org)

3 jobs com header `Authorization: Bearer SEU_CRON_SECRET`:

1. **Sinais 15m** — `run-15m` — `*/15 * * * *`
2. **Sinais 1h** — `run-1h` — `0 * * * *`
3. **Scanner 1** — `run-universe-scans` — `0 */4 * * *`

## Segurança

Definir `CRON_SECRET` no Railway.
