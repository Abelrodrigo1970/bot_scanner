# Cron Jobs — Bot Scanner

**Timezone no cron-job.org:** `Europe/Lisbon` (Portugal).

## Endpoints

| Endpoint | Estratégias | Frequência |
|----------|-------------|------------|
| `/api/cron/run-15m` | **Liquidity Pools** + **Swing VWAP** (S2) + **MA Cross 12×30** (S1) + **MA Cross 12×21** (S7) + **engolfo** (S2) + **Rompimento 20** (S1) | `*/15 * * * *` (24h) |
| `/api/cron/run-universe-scans` | Scanner 1 + **Scanner 2** + Scanner 6 + Scanner 7 (RSI 1d) + YTD mcap60 | `0 */4 * * *` (24h) |
| `/api/cron/run-lateral-volatile` | **Lateral EMA21/70** (só 00h e 12h Lisboa; ignora outras horas) | `0 0,12 * * *` |
| `/api/cron/run-liquidity-pools` | Liquidity Pools 15m (backup manual) | opcional |
| `/api/cron/run-swing-anchored-vwap` | Swing Anchored VWAP 15m (backup manual) | opcional |

**Obsoleto** (remover do cron-job.org): `run-5m`, `run-stch15long`, `run-rsi-vendido`, `run-scanner2-rsi80-top3-long`, `run-1h`, `run-30m`, `run-afastamento-30m`, `run-rsi-15m`, `run-scans-ma`, `run-signals`, `run-scanner-s6-short-leader-12h`, `run-scanner1-top8`, `run-scanner1-top5`, `run-scanner2-short-leader-24h`, `run-scanner3-rsi-1h`.

**Descontinuadas (Set 2026):** stch15long, Scanner 2 RSI>80 Top 3 LONG (4h), rsi_vendido LONG (4h).

**Descontinuadas (Ago 2026):** Pivot Boss, Quebra EMA80, Short Leader, Scanner 3 Flip, Stoch RSI Top 4, Top 4 rotação.

## Configuração mínima (cron-job.org)

2 jobs com header `Authorization: Bearer SEU_CRON_SECRET`:

1. **Liquidity Pools + Swing VWAP + MA Cross + engolfo + Rompimento 20 (15m)** — `run-15m` — `*/15 * * * *`
2. **Scanners** — `run-universe-scans` — `0 */4 * * *`
3. **Lateral EMA21/70** — `run-lateral-volatile` — `0 0,12 * * *` (00h e 12h Lisboa)

## Segurança

Todos os endpoints exigem `Authorization: Bearer CRON_SECRET`.
