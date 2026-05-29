/**
 * Simula Pivot Boss Bear 15m com cron horário (8h–23h PT) vs cada 15m.
 * Universo Scanner 1 (fecho > SMA200 1h), máx. 1 sinal/símbolo/dia PT.
 *
 * Uso: npx tsx scripts/simulate-pivot-boss-15m-cron-pnl.ts --days=5
 */

import {
  clearBacktestCandlePools,
  fetchCandles,
  setBacktestCandlePools,
  setBacktestCursor,
  type Candle,
} from '../lib/marketData';
import { runPivotBossBear15mStrategy, type SignalResult } from '../lib/signalEngine';
import { PIVOT_BOSS_BEAR_15M_DISPLAY, PIVOT_BOSS_BEAR_15M_PARAMS } from '../lib/strategyMigrations';
import { localDayKey, MA_CROSS_15M_TZ } from '../lib/maCross15mGuard';
import { calculateSMA } from '../lib/indicators';

const FEE_PCT = 0.1;
const NOTIONAL_USD = 100;
const TZ = MA_CROSS_15M_TZ;
const LABEL = PIVOT_BOSS_BEAR_15M_DISPLAY;
const PARAMS = { ...PIVOT_BOSS_BEAR_15M_PARAMS, allowSell: true, allowBuy: false };

type Mode = 'hourly' | '15m';

type Trade = {
  symbol: string;
  ts: number;
  entry: number;
  stopLoss: number;
  target1: number;
  strength: number;
  pnlPct: number;
  pnlUsd: number;
};

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k: string, d: string) => {
    const p = a.find((x) => x.startsWith(`${k}=`));
    return p ? p.slice(k.length + 1) : d;
  };
  return {
    days: Math.max(1, Number(get('--days', '5')) || 5),
    minStrength: Number(get('--minStrength', '60')) || 60,
  };
}

function lisbonParts(ts: number): { hour: number; minute: number; dayKey: string } {
  const d = new Date(ts);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  return {
    hour: Number(parts.find((p) => p.type === 'hour')?.value ?? 0),
    minute: Number(parts.find((p) => p.type === 'minute')?.value ?? 0),
    dayKey: localDayKey(d, TZ),
  };
}

function isCronTick(ts: number, mode: Mode): boolean {
  const { hour, minute } = lisbonParts(ts);
  if (hour < 8 || hour > 23) return false;
  return mode === 'hourly' ? minute === 0 : minute % 15 === 0;
}

async function loadCandlesRange(
  symbol: string,
  interval: string,
  fromMs: number,
  toMs: number
): Promise<Candle[]> {
  const stepMs =
    interval === '15m' ? 900_000 : interval === '1h' ? 3_600_000 : 3_600_000;
  const out: Candle[] = [];
  const seen = new Set<number>();
  let cursor = fromMs - stepMs * 320;

  while (cursor < toMs) {
    const batch = await fetchCandles(symbol, interval, 1500, cursor);
    if (!batch.length) break;
    for (const c of batch) {
      if (c.timestamp < fromMs - stepMs * 320 || c.timestamp > toMs) continue;
      if (seen.has(c.timestamp)) continue;
      seen.add(c.timestamp);
      out.push(c);
    }
    const last = batch[batch.length - 1]!.timestamp;
    if (last <= cursor) break;
    cursor = last + stepMs;
    await new Promise((r) => setTimeout(r, 120));
  }

  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

async function loadScanner1Symbols(): Promise<string[]> {
  try {
    const res = await fetch(
      'https://botcripto-production.up.railway.app/api/universe-scans/UNIVERSE_ABOVE_MA200_1H',
      { cache: 'no-store' }
    );
    if (res.ok) {
      const json = (await res.json()) as { items?: { symbol: string }[] };
      const syms = (json.items ?? []).map((r) => r.symbol).filter(Boolean);
      if (syms.length > 0) return syms;
    }
  } catch {
    /* fallback */
  }

  const tickers = (await (
    await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr', { cache: 'no-store' })
  ).json()) as { symbol: string; quoteVolume: string }[];

  return tickers
    .filter((t) => t.symbol.endsWith('USDT'))
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, 120)
    .map((t) => t.symbol);
}

function inScanner1At(closed1h: Candle[], ts: number): boolean {
  const bars = closed1h.filter((c) => c.timestamp + 3_600_000 <= ts);
  if (bars.length < 200) return false;
  const closes = bars.map((b) => b.close);
  const sma200 = calculateSMA(closes, 200);
  const close = bars[bars.length - 1]!.close;
  return sma200 != null && close > sma200;
}

function simulateSell(
  entry: number,
  stopLoss: number,
  target1: number,
  tp1Pos: number,
  forward: Candle[]
): number {
  if (!forward.length) return 0;
  const high24 = Math.max(entry, ...forward.map((c) => c.high));
  const low24 = Math.min(entry, ...forward.map((c) => c.low));
  const price24 = forward[forward.length - 1]!.close;
  const slPct = ((stopLoss - entry) / entry) * 100;
  const tp1Pct = ((entry - target1) / entry) * 100;
  const tp1W = tp1Pos / 100;
  const base24 = ((entry - price24) / entry) * 100;

  if (high24 >= stopLoss) return -slPct - FEE_PCT;
  if (low24 <= target1) {
    return tp1W * tp1Pct + (1 - tp1W) * Math.max(base24, -slPct) - FEE_PCT;
  }
  return Math.max(base24, -slPct) - FEE_PCT;
}

function stats(trades: Trade[]) {
  if (!trades.length) return null;
  const nets = trades.map((t) => t.pnlPct);
  const wins = nets.filter((n) => n >= 0);
  const losses = nets.filter((n) => n < 0);
  const grossW = wins.reduce((a, n) => a + n, 0);
  const grossL = Math.abs(losses.reduce((a, n) => a + n, 0));
  const usd = trades.reduce((a, t) => a + t.pnlUsd, 0);
  return {
    n: trades.length,
    wr: (wins.length / trades.length) * 100,
    totalPct: nets.reduce((a, n) => a + n, 0),
    avgPct: nets.reduce((a, n) => a + n, 0) / trades.length,
    pf: grossL > 0 ? grossW / grossL : grossW > 0 ? Infinity : 0,
    totalUsd: usd,
    avgUsd: usd / trades.length,
  };
}

function fmt(st: ReturnType<typeof stats>) {
  if (!st) return 'sem trades';
  return (
    `n=${st.n} | WR=${st.wr.toFixed(1)}% | liq=${st.totalPct.toFixed(2)}% (avg ${st.avgPct.toFixed(2)}%)` +
    ` | PF=${st.pf === Infinity ? '∞' : st.pf.toFixed(2)}` +
    ` | ~$${st.totalUsd.toFixed(2)} (@ $${NOTIONAL_USD}/trade)`
  );
}

async function simulateSymbol(
  symbol: string,
  mode: Mode,
  fromMs: number,
  toMs: number,
  minStrength: number
): Promise<Trade[]> {
  const warmMs = 12 * 24 * 60 * 60 * 1000;
  const c15 = await loadCandlesRange(symbol, '15m', fromMs - warmMs, toMs);
  const c1h = await loadCandlesRange(symbol, '1h', fromMs - warmMs, toMs);
  if (c15.length < 200 || c1h.length < 210) return [];

  const pools = new Map<string, Candle[]>([
    [`${symbol}:15m`, c15],
    [`${symbol}:1h`, c1h],
  ]);
  setBacktestCandlePools(pools);

  const trades: Trade[] = [];
  const dailyHit = new Set<string>();

  const startIdx = c15.findIndex((c) => c.timestamp + 900_000 >= fromMs);
  if (startIdx < 0) {
    clearBacktestCandlePools();
    return [];
  }

  for (let i = startIdx; i < c15.length - 1; i++) {
    const barEnd = c15[i]!.timestamp + 900_000;
    if (barEnd > toMs) break;
    if (barEnd + 24 * 3_600_000 > Date.now()) continue;
    if (!isCronTick(barEnd, mode)) continue;
    if (!inScanner1At(c1h, barEnd)) continue;

    const dayKey = lisbonParts(barEnd).dayKey;
    const gateKey = `${dayKey}:${symbol}`;
    if (dailyHit.has(gateKey)) continue;

    setBacktestCursor(barEnd);
    let signal: SignalResult | null = null;
    try {
      signal = await runPivotBossBear15mStrategy(symbol, '15m', PARAMS);
    } catch {
      signal = null;
    }
    if (!signal || signal.strength < minStrength) continue;

    const forward = c15.filter(
      (c) => c.timestamp + 900_000 > barEnd && c.timestamp + 900_000 <= barEnd + 24 * 3_600_000
    );
    if (!forward.length) continue;

    const tp1Pos = Number(JSON.parse(signal.extraInfo || '{}').tp1Position ?? 50);
    const pnlPct = simulateSell(
      signal.entryPrice,
      signal.stopLoss,
      signal.target1,
      tp1Pos,
      forward
    );

    trades.push({
      symbol,
      ts: barEnd,
      entry: signal.entryPrice,
      stopLoss: signal.stopLoss,
      target1: signal.target1,
      strength: signal.strength,
      pnlPct,
      pnlUsd: (pnlPct / 100) * NOTIONAL_USD,
    });
    dailyHit.add(gateKey);
  }

  clearBacktestCandlePools();
  return trades;
}

async function runMode(mode: Mode, symbols: string[], fromMs: number, toMs: number, minStrength: number) {
  const all: Trade[] = [];
  let i = 0;
  for (const symbol of symbols) {
    i++;
    if (i % 15 === 0) console.log(`  [${mode}] ${i}/${symbols.length}…`);
    const trades = await simulateSymbol(symbol, mode, fromMs, toMs, minStrength);
    all.push(...trades);
  }
  all.sort((a, b) => a.ts - b.ts);
  return all;
}

async function main() {
  const { days, minStrength } = parseArgs();
  const toMs = Date.now();
  const fromMs = toMs - days * 24 * 60 * 60 * 1000;
  const fromIso = new Date(fromMs).toISOString().slice(0, 10);
  const toIso = new Date(toMs).toISOString().slice(0, 10);

  console.log(`\n=== ${LABEL} — simulação ${days} dias ===`);
  console.log(`Período: ${fromIso} → ${toIso} | força mín. ${minStrength} | fuso ${TZ}`);
  console.log(`SL/TP: dinâmico do sinal | TP1 50% | restante 24h | fee ${FEE_PCT}%\n`);

  const symbols = await loadScanner1Symbols();
  console.log(`Universo: ${symbols.length} símbolos (Scanner 1 ou top volume)\n`);

  console.log('A simular cron horário (8h–23h PT, :00) — lógica actual…');
  const hourly = await runMode('hourly', symbols, fromMs, toMs, minStrength);
  console.log(`\n▶ Cron horário (actual): ${fmt(stats(hourly))}`);

  console.log('\nA simular cron cada 15m (8h–23h PT) — referência…');
  const every15 = await runMode('15m', symbols, fromMs, toMs, minStrength);
  console.log(`\n▶ Cron 15m (referência): ${fmt(stats(every15))}`);

  const onlyHourly = hourly.filter(
    (t) => !every15.some((e) => e.symbol === t.symbol && Math.abs(e.ts - t.ts) < 900_000)
  );
  const missedByHourly = every15.filter(
    (e) => !hourly.some((t) => t.symbol === e.symbol && Math.abs(t.ts - e.ts) < 900_000)
  );

  console.log(`\n--- Comparação ---`);
  console.log(`Trades só no horário: ${onlyHourly.length}`);
  console.log(`Trades perdidos pelo horário (existiriam em 15m): ${missedByHourly.length}`);

  if (hourly.length) {
    console.log(`\nTrades cron horário:`);
    for (const t of hourly) {
      console.log(
        `  ${new Date(t.ts).toLocaleString('pt-PT', { timeZone: TZ })} | ${t.symbol.padEnd(12)} | f=${String(t.strength).padStart(2)} | ${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}% (~$${t.pnlUsd.toFixed(2)})`
      );
    }
  }

  if (missedByHourly.length) {
    console.log(`\nTrades que o cron horário perdeu (amostra até 15):`);
    for (const t of missedByHourly.slice(0, 15)) {
      console.log(
        `  ${new Date(t.ts).toLocaleString('pt-PT', { timeZone: TZ })} | ${t.symbol.padEnd(12)} | f=${String(t.strength).padStart(2)} | ${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%`
      );
    }
    if (missedByHourly.length > 15) console.log(`  … +${missedByHourly.length - 15} mais`);
    const missedUsd = missedByHourly.reduce((a, t) => a + t.pnlUsd, 0);
    console.log(`  Lucro simulado perdido: ~$${missedUsd.toFixed(2)}`);
  }

  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
