# Cron Jobs — Bot Scanner

**Timezone no cron-job.org:** `Europe/Lisbon` (Portugal).

## Endpoints

| Endpoint | Estratégias | Frequência |
|----------|-------------|------------|
| `/api/cron/run-5m` | **stch15long** (Stoch 15m Top 2 LONG) | `*/5 * * * *` (24h) |
| `/api/cron/run-15m` | **MA Cross 12×30** (S1) + **MA Cross 12×21** (S2) + **engolfo** (S2) + **Rompimento 20** (S1) | `*/15 * * * *` (24h) |
| `/api/cron/run-universe-scans` | Scanner 1 + **Scanner 2** + Scanner 6 + **rsi_vendido** + **RSI>80 Top 3 LONG** + **rsi_vendido LONG** | `0 */4 * * *` (24h) |
| `/api/cron/run-lateral-volatile` | **Lateral EMA21/70** (só 00h e 12h Lisboa; ignora outras horas) | `0 0,12 * * *` |
| `/api/cron/run-scanner2-rsi80-top3-long` | Scanner 2 RSI>80 Top 3 LONG 4h (backup manual) | opcional, 10–15 min após scan |
| `/api/cron/run-stch15long` | stch15long Top 2 Stoch 15m LONG (backup manual) | opcional |
| `/api/cron/run-rsi-vendido` | rsi_vendido LONG 4h (backup manual) | opcional, após scan |

**Obsoleto** (remover do cron-job.org): `run-1h`, `run-30m`, `run-afastamento-30m`, `run-rsi-15m`, `run-scans-ma`, `run-signals`, `run-scanner-s6-short-leader-12h`, `run-scanner1-top8`, `run-scanner1-top5`, `run-scanner2-short-leader-24h`, `run-scanner3-rsi-1h`.

**Descontinuadas (Ago 2026):** Pivot Boss, Rompimento, Quebra EMA80, Short Leader, Scanner 3 Flip, Stoch RSI Top 4, Top 4 rotação.

## Configuração mínima (cron-job.org)

3 jobs com header `Authorization: Bearer SEU_CRON_SECRET`:

1. **stch15long** — `run-5m` — `*/5 * * * *`
2. **MA Cross + engolfo + Rompimento 20 (15m)** — `run-15m` — `*/15 * * * *`
3. **Scanners + RSI>80 + rsi_vendido** — `run-universe-scans` — `0 */4 * * *`
4. **Lateral EMA21/70** — `run-lateral-volatile` — `0 0,12 * * *` (00h e 12h Lisboa)

Opcional backup: **RSI>80 Top 3 LONG** — `run-scanner2-rsi80-top3-long` — `30 */4 * * *` | **rsi_vendido LONG** — `run-rsi-vendido` — `35 */4 * * *`

## Segurança

Todos os endpoints exigem `Authorization: Bearer CRON_SECRET`.
