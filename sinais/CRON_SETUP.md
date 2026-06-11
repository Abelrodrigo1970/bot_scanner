# Cron Jobs — Bot Scanner (estratégias de sinal)

**Timezone no cron-job.org:** `Europe/Lisbon` (Portugal).

## Endpoints

| Endpoint | Estratégias | Frequência |
|----------|-------------|------------|
| `/api/cron/run-15m` | MA Cross 15m + EMA Ribbon BUY 15m | `*/15 * * * *` (24h) |
| `/api/cron/run-30m` | Afastamento médio 30m | `*/30 8-23 * * *` |
| `/api/cron/run-1h` | Pivot Boss 15m/1h, RSI 1h | `0 * * * *` (24h) |
| `/api/cron/run-universe-scans` | Scanners 1, 2, 4 (universo) | `0 */4 * * *` (24h) |

**Nota:** Rotações Top (scanners 5 e 6) estão no projeto **bot_cripto**.

## Configuração mínima (cron-job.org)

4 jobs com header `Authorization: Bearer SEU_CRON_SECRET`:

1. **Sinais 15m** — `run-15m` — `*/15 * * * *`
2. **Sinais 30m** — `run-30m` — `*/30 8-23 * * *`
3. **Sinais 1h** — `run-1h` — `0 * * * *`
4. **Scanners** — `run-universe-scans` — `0 */4 * * *`

## Segurança

Definir `CRON_SECRET` no Railway.
