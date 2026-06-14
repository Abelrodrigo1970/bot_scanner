# Cron Jobs — Bot Scanner

**Timezone no cron-job.org:** `Europe/Lisbon` (Portugal).

## Endpoints

| Endpoint | Estratégias | Frequência |
|----------|-------------|------------|
| `/api/cron/run-15m` | MA Cross 12×30 (15m) + Pivot Boss Bear 15m | `*/15 * * * *` (24h) |
| `/api/cron/run-universe-scans` | Scanner 1 (universo) + **Scanner 1 Top 6** (rotação) | `0 */4 * * *` (24h) |
| `/api/cron/run-scanner1-top8` | Scanner 1 Top 6 (rotação manual/backup) | opcional, 10–15 min após scan |

**Obsoleto** (remover do cron-job.org): `run-1h`, `run-30m`, `run-afastamento-30m`, `run-rsi-15m`, `run-scans-ma`, `run-signals`.

**Nota:** Rotações Scanner 5/6 estão no projeto **bot_cripto**.

## Configuração mínima (cron-job.org)

2 jobs com header `Authorization: Bearer SEU_CRON_SECRET`:

1. **Sinais 15m** — `run-15m` — `*/15 * * * *`
2. **Scanner 1 + Top 6** — `run-universe-scans` — `0 */4 * * *` (scan + rotação automática)

Opcional: **Top 6 backup** — `run-scanner1-top8` — `15 */4 * * *` (minuto 15 de cada 4 h, se quiser redundância)

## Segurança

Definir `CRON_SECRET` no Railway.
