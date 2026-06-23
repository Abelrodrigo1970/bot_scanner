# Cron Jobs — Bot Scanner

**Timezone no cron-job.org:** `Europe/Lisbon` (Portugal).

## Endpoints

| Endpoint | Estratégias | Frequência |
|----------|-------------|------------|
| `/api/cron/run-15m` | MA Cross + Pivot Boss + Rompimentos + **Quebra EMA80** | `*/15 * * * *` (24h) |
| `/api/cron/run-universe-scans` | Scanner 1 + **Scanner 2** + Scanner 6 (SMA80 4h) + rotação Top 8 + **SHORT ranks #1–#2** | `0 */4 * * *` (24h) |
| `/api/cron/run-scanner1-top5` | Scanner 2 Top 8 (rotação manual/backup) | opcional, 10–15 min após scan |
| `/api/cron/run-scanner2-short-leader-24h` | Scanner 2 Short ranks #1–#2 (backup manual) | opcional, 10–15 min após scan |

**Obsoleto** (remover do cron-job.org): `run-1h`, `run-30m`, `run-afastamento-30m`, `run-rsi-15m`, `run-scans-ma`, `run-signals`, `run-scanner-s6-short-leader-12h`, `run-scanner1-top8`.

**Nota:** Rotação long Scanner 6 (Top 6) e Scanner 1 Top 6 estão no **bot_cripto** / descontinuados. O **bot_scanner** corre Scanner 2 Top 8 (long) e Short ranks #1–#2.

## Configuração mínima (cron-job.org)

2 jobs com header `Authorization: Bearer SEU_CRON_SECRET`:

1. **Sinais 15m** — `run-15m` — `*/15 * * * *`
2. **Scanners 1+2 + rotações** — `run-universe-scans` — `0 */4 * * *` (ou `0 */2 * * *` se configuraste 2 h)

Opcional backup: **Scanner 2 Top 8** — `run-scanner1-top5` — `20 */4 * * *` | **Scanner 2 Short** — `run-scanner2-short-leader-24h` — `25 */4 * * *`

## Segurança

Definir `CRON_SECRET` no Railway.
