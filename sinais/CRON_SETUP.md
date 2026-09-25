# Cron Jobs — Bot Scanner

**Timezone no cron-job.org:** `Europe/Lisbon` (Portugal).

## Endpoints

| Endpoint | Estratégias | Frequência |
|----------|-------------|------------|
| `/api/cron/run-15m` | **Liquidity Pools** + **MA Cross** + **engolfo** + **Rompimento 20** + **rsi_vendido** (só de **2em2h** Lisboa) + **sync SL Bybit** | `*/15 * * * *` (24h) |
| `/api/cron/scan-open-positions-sl` | **Scan SL**: todas as posições Bybit abertas sem SL → coloca Full SL | `*/10 * * * *` (**obrigatório**) |
| `/api/cron/cleanup-bybit-orphan-orders` | Órfãs TP/SL + **mesmo scan SL** (alternativa / backup) | `*/10 * * * *` |
| `/api/cron/sync-bybit-sl` | Reaplica SL (alias do scan; batch `?maxFix=`) | `0 */4 * * *` (backup) |
| `/api/cron/run-universe-scans` | Scanner 1 + **Scanner 2** + Scanner 6 + Scanner 7 (RSI 1d) + YTD mcap60 + **sync SL Bybit** | `0 */4 * * *` (24h) |
| `/api/cron/run-rsi-vendido` | **rsi_vendido** + **sync SL Bybit** | opcional / manual; no `run-15m` de 2em2h |
| `/api/cron/run-lateral-volatile` | **Lateral EMA21/70** (só 00h e 12h Lisboa; ignora outras horas) | `0 0,12 * * *` |
| `/api/cron/run-liquidity-pools` | Liquidity Pools 15m (backup manual) | opcional |

### Scan SL (posições abertas)

Não é um scanner de universo. Percorre **todas** as posições USDT linear abertas na Bybit
(paginação completa) e, se não tiverem SL Full, aplica o SL do sinal ou fallback
LONG −15% / SHORT +8%.

- Endpoint principal: **`/api/cron/scan-open-positions-sl`**
- Também corre dentro de: `cleanup-bybit-orphan-orders`, `run-15m`, `run-universe-scans`

**Obsoleto** (remover do cron-job.org): `run-5m`, `run-stch15long`, `run-rsi-vendido`, `run-scanner2-rsi80-top3-long`, `run-1h`, `run-30m`, `run-afastamento-30m`, `run-rsi-15m`, `run-scans-ma`, `run-signals`, `run-scanner-s6-short-leader-12h`, `run-scanner1-top8`, `run-scanner1-top5`, `run-scanner2-short-leader-24h`, `run-scanner3-rsi-1h`, `run-swing-anchored-vwap`.

**Descontinuadas (Set 2026):** stch15long, Scanner 2 RSI>80 Top 3 LONG (4h), Swing Anchored VWAP (15m).

**Descontinuadas (Ago 2026):** Pivot Boss, Quebra EMA80, Short Leader, Scanner 3 Flip, Stoch RSI Top 4, Top 4 rotação.

## Configuração mínima (cron-job.org)

Jobs com header `Authorization: Bearer SEU_CRON_SECRET`:

1. **LP + MA Cross + engolfo + Rompimento 20 + rsi_vendido (2em2h)** — `run-15m` — `*/15 * * * *`
2. **Scanners** — `run-universe-scans` — `0 */4 * * *`
3. **Lateral EMA21/70** — `run-lateral-volatile` — `0 0,12 * * *` (00h e 12h Lisboa)
4. **Scan SL posições abertas** — `scan-open-positions-sl` — `*/10 * * * *` (**obrigatório**)
5. **Bybit cleanup + SL** — `cleanup-bybit-orphan-orders` — `*/10 * * * *` (opcional se 4 já estiver activo)

## Segurança

Todos os endpoints exigem `Authorization: Bearer CRON_SECRET`.
