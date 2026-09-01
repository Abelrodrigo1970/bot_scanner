/**
 * Compara trades reais (Binance) vs sinais botscanner com SL/TP canónicos.
 */
import { getSimulationSideForSignal } from '../lib/strategySimulationProfiles';
import { simulateSignalNetResultPercent } from '../lib/simulateSignalSlTp';

const API = 'https://botscanner-production.up.railway.app';
const FEE = 0.1;
const LEGACY_MA21_SELL = {
  stopLossPct: 15,
  tp1Pct: 44,
  tp2Pct: 0,
  tp1PositionPct: 60,
  tp2PositionPct: 0,
  finalCloseHours: 24,
};

const REAL_TRADES = [
  { symbol: 'STXUSDT', dir: 'LONG', entry: 0.24945, exit: 0.25020, pct: 0.6710, at: '2026-08-28 17:24:07' },
  { symbol: 'APTUSDT', dir: 'LONG', entry: 0.5681, exit: 0.5468, pct: -2.5169, at: '2026-08-28 15:02:19' },
  { symbol: 'BEAMUSDT', dir: 'SHORT', entry: 0.0018218, exit: 0.0016830, pct: 5.0300, at: '2026-08-28 14:31:45' },
  { symbol: 'HEMIUSDT', dir: 'SHORT', entry: 0.010156, exit: 0.011286, pct: -11.0515, at: '2026-08-28 07:29:39' },
  { symbol: 'MOVRUSDT', dir: 'SHORT', entry: 0.9850, exit: 1.0610, pct: -7.8490, at: '2026-08-28 03:39:33' },
  { symbol: 'FARTCOINUSDT', dir: 'LONG', entry: 0.20948, exit: 0.20601, pct: -1.8243, at: '2026-08-28 03:30:41' },
  { symbol: 'CASHCATUSDT', dir: 'LONG', entry: 0.25552, exit: 0.21539, pct: -15.8638, at: '2026-08-28 01:15:11' },
  { symbol: 'MAGMAUSDT', dir: 'SHORT', entry: 0.35670, exit: 0.38066, pct: -6.9865, at: '2026-08-28 00:42:03' },
  { symbol: 'BICOUSDT', dir: 'SHORT', entry: 0.027719, exit: 0.026222, pct: 2.0886, at: '2026-08-27 23:40:49' },
  { symbol: 'BEAMUSDT', dir: 'SHORT', entry: 0.0018218, exit: 0.0017699, pct: 0.8979, at: '2026-08-27 23:40:37' },
  { symbol: 'LIGHTUSDT', dir: 'SHORT', entry: 0.21774, exit: 0.21369, pct: 1.3873, at: '2026-08-29 17:31:44' },
  { symbol: 'MAGMAUSDT', dir: 'SHORT', entry: 0.52650, exit: 0.41560, pct: 10.5666, at: '2026-08-29 14:58:14' },
  { symbol: 'BMTUSDT', dir: 'SHORT', entry: 0.024935, exit: 0.021586, pct: 13.2197, at: '2026-08-29 07:30:48' },
  { symbol: 'SKRUSDT', dir: 'SHORT', entry: 0.010433, exit: 0.010131, pct: 1.2890, at: '2026-08-29 07:00:31' },
  { symbol: 'HEMIUSDT', dir: 'LONG', entry: 0.011854, exit: 0.011805, pct: -0.6405, at: '2026-08-29 03:45:44' },
  { symbol: 'LIGHTUSDT', dir: 'SHORT', entry: 0.21774, exit: 0.21997, pct: -0.2459, at: '2026-08-28 21:44:33' },
  { symbol: 'POPCATUSDT', dir: 'SHORT', entry: 0.05918, exit: 0.05426, pct: 2.1576, at: '2026-08-28 21:43:47' },
  { symbol: 'SKRUSDT', dir: 'SHORT', entry: 0.010433, exit: 0.009065, pct: 2.6506, at: '2026-08-28 21:42:59' },
  { symbol: 'SKRUSDT', dir: 'SHORT', entry: 0.010433, exit: 0.009062, pct: 3.3241, at: '2026-08-28 21:42:25' },
  { symbol: 'CLOUSDT', dir: 'SHORT', entry: 0.10609, exit: 0.09599, pct: 9.4794, at: '2026-08-28 17:46:56' },
  { symbol: 'ONGUSDT', dir: 'LONG', entry: 0.12836, exit: 0.10915, pct: -12.2429, at: '2026-08-30 21:46:38' },
  { symbol: 'NILUSDT', dir: 'SHORT', entry: 0.05618, exit: 0.05229, pct: 6.8962, at: '2026-08-30 21:46:34' },
  { symbol: 'BTRUSDT', dir: 'LONG', entry: 0.18197, exit: 0.16365, pct: -10.3259, at: '2026-08-30 15:46:28' },
  { symbol: 'CLOUSDT', dir: 'SHORT', entry: 0.11990, exit: 0.12203, pct: -1.6515, at: '2026-08-30 10:15:40' },
  { symbol: 'AKEUSDT', dir: 'SHORT', entry: 0.0101758, exit: 0.0080500, pct: 10.5284, at: '2026-08-30 06:01:16' },
  { symbol: 'MAGMAUSDT', dir: 'SHORT', entry: 0.52650, exit: 0.50920, pct: 1.6251, at: '2026-08-30 02:30:44' },
  { symbol: 'HNTUSDT', dir: 'SHORT', entry: 0.3602, exit: 0.3896, pct: -8.9857, at: '2026-08-29 20:16:31' },
  { symbol: 'BTRUSDT', dir: 'SHORT', entry: 0.16391, exit: 0.17627, pct: -7.7954, at: '2026-08-29 19:34:55' },
  { symbol: 'AKEUSDT', dir: 'SHORT', entry: 0.0101758, exit: 0.0080570, pct: 10.2775, at: '2026-08-29 19:17:22' },
  { symbol: '4USDT', dir: 'SHORT', entry: 0.016338, exit: 0.017638, pct: -8.1969, at: '2026-08-29 18:51:50' },
  { symbol: 'POPCATUSDT', dir: 'SHORT', entry: 0.05918, exit: 0.05274, pct: 5.2584, at: '2026-08-31 23:28:48' },
  { symbol: 'HEMIUSDT', dir: 'SHORT', entry: 0.015237, exit: 0.016426, pct: -8.0822, at: '2026-08-31 19:15:09' },
  { symbol: 'ZORAUSDT', dir: 'SHORT', entry: 0.009077, exit: 0.010046, pct: -10.8014, at: '2026-08-31 15:28:54' },
  { symbol: 'SKRUSDT', dir: 'SHORT', entry: 0.027654, exit: 0.028742, pct: -3.3166, at: '2026-08-31 14:47:28' },
  { symbol: 'SKRUSDT', dir: 'SHORT', entry: 0.027654, exit: 0.022025, pct: 9.7001, at: '2026-08-31 11:15:47' },
  { symbol: 'HNTUSDT', dir: 'SHORT', entry: 0.7755, exit: 0.8462, pct: -4.7742, at: '2026-08-31 07:33:28' },
  { symbol: 'HNTUSDT', dir: 'SHORT', entry: 0.7755, exit: 0.6259, pct: 9.2826, at: '2026-08-31 05:47:16' },
  { symbol: 'VIRTUALUSDT', dir: 'LONG', entry: 0.7673, exit: 0.6582, pct: -14.2996, at: '2026-08-31 00:41:36' },
  { symbol: 'ZROUSDT', dir: 'LONG', entry: 1.2227, exit: 1.0292, pct: -16.2633, at: '2026-08-31 12:00:00' },
];

function isMa21(name: string) {
  return /12.?21/i.test(name);
}

function parseAt(s: string) {
  return new Date(s.replace(' ', 'T') + '+01:00').getTime();
}

function simNet(signal: {
  strategyName: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  result24h: number;
  stopLoss: number | null;
  target1: number | null;
  high24h: number | null;
  low24h: number | null;
  extraInfo: string | null;
}): number | null {
  if (signal.result24h == null) return null;
  let side = getSimulationSideForSignal(signal.strategyName, signal.direction);
  if (!side && signal.direction === 'SELL' && isMa21(signal.strategyName)) side = LEGACY_MA21_SELL;
  if (!side) return (signal.result24h / signal.entryPrice) * 100 - FEE;
  return simulateSignalNetResultPercent(signal, side, FEE);
}

type Signal = {
  symbol: string;
  direction: 'BUY' | 'SELL';
  strategyName: string;
  entryPrice: number;
  result24h: number;
  stopLoss: number | null;
  target1: number | null;
  high24h: number | null;
  low24h: number | null;
  extraInfo: string | null;
  strength: number;
  generatedAt: string;
};

function matchSignal(trade: (typeof REAL_TRADES)[0], signals: Signal[]): Signal | null {
  const exitMs = parseAt(trade.at);
  const dir = trade.dir === 'LONG' ? 'BUY' : 'SELL';
  const candidates = signals.filter((s) => {
    if (s.symbol !== trade.symbol || s.direction !== dir) return false;
    const entryDiff = Math.abs(s.entryPrice - trade.entry) / trade.entry;
    if (entryDiff > 0.03) return false;
    const gen = new Date(s.generatedAt).getTime();
    const diff = exitMs - gen;
    return diff >= -3600000 && diff <= 96 * 3600000;
  });
  candidates.sort((a, b) => {
    const ea = Math.abs(a.entryPrice - trade.entry);
    const eb = Math.abs(b.entryPrice - trade.entry);
    if (Math.abs(ea - eb) > 0.0001) return ea - eb;
    return Math.abs(exitMs - new Date(a.generatedAt).getTime()) - Math.abs(exitMs - new Date(b.generatedAt).getTime());
  });
  return candidates[0] ?? null;
}

function holdHours(trade: (typeof REAL_TRADES)[0], signal: Signal): number {
  return (parseAt(trade.at) - new Date(signal.generatedAt).getTime()) / 3600000;
}

async function main() {
  const from = '2026-08-27';
  const to = '2026-08-31';
  const res = await fetch(
    `${API}/api/signals?limit=5000&minStrength=0&onlyClosed=true&dateFrom=${from}&dateTo=${to}`
  );
  const json = (await res.json()) as { signals?: Signal[] };
  const signals = json.signals ?? [];

  const rows = REAL_TRADES.map((t) => {
    const sig = matchSignal(t, signals);
    const sim = sig ? simNet(sig) : null;
    const hours = sig ? holdHours(t, sig) : null;
    return { ...t, sig, sim, hours, strategy: sig?.strategyName ?? null };
  });

  const matched = rows.filter((r) => r.sig);
  const realTotal = REAL_TRADES.reduce((a, t) => a + t.pct, 0);
  const realWins = REAL_TRADES.filter((t) => t.pct >= 0).length;
  const simTotal = matched.reduce((a, r) => a + (r.sim ?? 0), 0);
  const simWins = matched.filter((r) => (r.sim ?? 0) >= 0).length;

  console.log('=== REAL vs BOT (27–31 Ago) ===\n');
  console.log(`Trades reais: ${REAL_TRADES.length} | Match bot: ${matched.length}`);
  console.log(`REAL:  net ${realTotal.toFixed(1)}% | WR ${((realWins / REAL_TRADES.length) * 100).toFixed(0)}% (${realWins}W/${REAL_TRADES.length - realWins}L)`);
  console.log(`BOT:   net ${simTotal.toFixed(1)}% | WR ${matched.length ? ((simWins / matched.length) * 100).toFixed(0) : 0}% (${simWins}W/${matched.length - simWins}L) [sim SL/TP 24h]`);
  console.log(`Δ execução: ${(realTotal - simTotal).toFixed(1)}% a favor do fecho manual\n`);

  const byStrat = new Map<string, { n: number; real: number; sim: number }>();
  for (const r of matched) {
    const k = r.strategy!;
    if (!byStrat.has(k)) byStrat.set(k, { n: 0, real: 0, sim: 0 });
    const b = byStrat.get(k)!;
    b.n++;
    b.real += r.pct;
    b.sim += r.sim ?? 0;
  }
  console.log('=== POR ESTRATÉGIA ===');
  for (const [name, b] of [...byStrat.entries()].sort((a, b) => b[1].real - a[1].real)) {
    console.log(`${name.padEnd(35)} n=${b.n}  real=${b.real.toFixed(1).padStart(7)}%  bot=${b.sim.toFixed(1).padStart(7)}%  Δ=${(b.real - b.sim).toFixed(1)}%`);
  }

  const engolfo = matched.filter((r) => r.strategy === 'engolfo');
  if (engolfo.length) {
    const avgHold = engolfo.reduce((a, r) => a + (r.hours ?? 0), 0) / engolfo.length;
    console.log(`\nengolfo: ${engolfo.length} trades, hold médio real ${avgHold.toFixed(1)}h (bot assume 24h)`);
  }

  console.log('\n=== MAIORES GANHOS vs BOT (fecho manual) ===');
  const saved = [...matched].sort((a, b) => b.pct - (b.sim ?? 0) - (a.pct - (a.sim ?? 0))).slice(0, 8);
  for (const r of saved) {
    console.log(`${r.symbol.padEnd(12)} real ${r.pct.toFixed(1).padStart(6)}% bot ${(r.sim ?? 0).toFixed(1).padStart(6)}%  hold ${r.hours?.toFixed(0)}h  ${r.strategy}`);
  }

  console.log('\n=== MAIORES PERDAS REAIS ===');
  for (const r of [...rows].sort((a, b) => a.pct - b.pct).slice(0, 8)) {
    const tag = r.sig ? r.strategy : 'manual?';
    console.log(`${r.symbol.padEnd(12)} ${r.dir.padEnd(5)} ${r.pct.toFixed(1).padStart(7)}%  bot ${r.sim != null ? r.sim.toFixed(1).padStart(6) + '%' : '  —   '}  ${tag}`);
  }

  const unmatched = rows.filter((r) => !r.sig);
  if (unmatched.length) {
    console.log('\n=== SEM SINAL BOT (provável manual) ===');
    for (const r of unmatched) {
      console.log(`${r.symbol} ${r.dir} ${r.pct.toFixed(1)}% @ ${r.at}`);
    }
    console.log(`Net destes: ${unmatched.reduce((a, r) => a + r.pct, 0).toFixed(1)}%`);
  }

  const aligned = matched.filter((r) => (r.pct >= 0) === ((r.sim ?? 0) >= 0));
  console.log(`\nMesmo sentido ganho/perda: ${aligned.length}/${matched.length} (${((aligned.length / matched.length) * 100).toFixed(0)}%)`);
}

main().catch(console.error);
