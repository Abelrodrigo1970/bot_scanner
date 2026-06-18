# Cron Jobs — Bot Scanner

**Timezone no cron-job.org:** `Europe/Lisbon` (Portugal).

## Endpoints

| Endpoint | Estratégias | Frequência |
|----------|-------------|------------|
| `/api/cron/run-15m` | Scanner 3 + MA Cross + Pivot Boss + Rompimentos + **Quebra EMA80** | `*/15 * * * *` (24h) |
| `/api/cron/run-universe-scans` | Scanner 1 + **Scanner 2** + **Scanner 6** (SMA80 4h) + rotações Top 6/Top 8 + **SHORT rank #1** | `0 */4 * * *` (24h) |
| `/api/cron/run-scanner1-top8` | Scanner 1 Top 6 (rotação manual/backup) | opcional, 10–15 min após scan |
| `/api/cron/run-scanner1-top5` | Scanner 2 Top 8 (rotação manual/backup) | opcional, 10–15 min após scan |
| `/api/cron/run-scanner-s6-short-leader-12h` | Scanner 6 Short rank #1 (backup manual) | opcional, 10–15 min após scan |

**Obsoleto** (remover do cron-job.org): `run-1h`, `run-30m`, `run-afastamento-30m`, `run-rsi-15m`, `run-scans-ma`, `run-signals`.

**Nota:** Rotação long Scanner 6 (Top 6) está no projeto **bot_cripto**. O **bot_scanner** corre só o SHORT rank #1.

## Configuração mínima (cron-job.org)

2 jobs com header `Authorization: Bearer SEU_CRON_SECRET`:

1. **Sinais 15m + Scanner 3** — `run-15m` — `*/15 * * * *`
2. **Scanners 1+2 + rotações** — `run-universe-scans` — `0 */4 * * *` (ou `0 */2 * * *` se configuraste 2 h)

Opcional backup: **Top 6** — `run-scanner1-top8` — `15 */4 * * *` | **Scanner 2 Top 8** — `run-scanner1-top5` — `20 */4 * * *` | **Scanner 6 Short** — `run-scanner-s6-short-leader-12h` — `25 */4 * * *`

## Segurança

Definir `CRON_SECRET` no Railway.
