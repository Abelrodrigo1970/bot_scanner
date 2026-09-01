/**
 * Compara trades reais (Binance) vs sinais botscanner.
 */
import { readFileSync } from 'fs';

const API = 'https://botscanner-production.up.railway.app';

// Trades reais colados pelo utilizador (fecho = exit)
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

function parseAt(s) {
  return new Date(s.replace(' ', 'T') + '+01:00').getTime();
}

function botDir(d) {
  return d === 'BUY' ? 'LONG' : 'SHORT';
}

function pctDiff(a, b) {
  return Math.abs(a - b);
}

async function fetchSignals(from, to) {
  const url = `${API}/api/signals?limit=5000&minStrength=0&dateFrom=${from}&dateTo=${to}`;
  const res = await fetch(url);
  const json = await res.json();
  return json.signals ?? [];
}

function matchSignal(trade, signals) {
  const exitMs = parseAt(trade.at);
  const dir = trade.dir === 'LONG' ? 'BUY' : 'SELL';
  const candidates = signals.filter(
    (s) =>
      s.symbol === trade.symbol &&
      s.direction === dir &&
      Math.abs(s.entryPrice - trade.entry) / trade.entry < 0.02
  );
  if (!candidates.length) {
    // relax entry match — symbol + direction within 48h before exit
    const relaxed = signals.filter((s) => {
      if (s.symbol !== trade.symbol || s.direction !== dir) return false;
      const gen = new Date(s.generatedAt).getTime();
      const diff = exitMs - gen;
      return diff >= 0 && diff <= 72 * 3600 * 1000;
    });
    relaxed.sort((a, b) => {
      const da = Math.abs(parseAt(trade.at) - new Date(a.generatedAt).getTime());
      const db = Math.abs(parseAt(trade.at) - new Date(b.generatedAt).getTime());
      return da - db;
    });
    return relaxed[0] ?? null;
  }
  candidates.sort((a, b) => {
    const da = Math.abs(exitMs - new Date(a.generatedAt).getTime());
    const db = Math.abs(exitMs - new Date(b.generatedAt).getTime());
    return da - db;
  });
  return candidates[0];
}

function simNet(signal) {
  if (!signal?.result24h || !signal.entryPrice) return null;
  return (signal.result24h / signal.entryPrice) * 100 - 0.1;
}

const from = '2026-08-27';
const to = '2026-08-31';
const signals = await fetchSignals(from, to);
console.log(`Sinais bot ${from}→${to}: ${signals.length}\n`);

const rows = [];
for (const t of REAL_TRADES) {
  const sig = matchSignal(t, signals);
  const sim = sig ? simNet(sig) : null;
  rows.push({
    ...t,
    matched: !!sig,
    strategy: sig?.strategyName ?? '—',
    strength: sig?.strength ?? null,
    signalAt: sig?.generatedAt?.slice(0, 19) ?? '—',
    simPct: sim,
    delta: sim != null ? t.pct - sim : null,
  });
}

const matched = rows.filter((r) => r.matched);
const unmatched = rows.filter((r) => !r.matched);

const realTotal = REAL_TRADES.reduce((a, t) => a + t.pct, 0);
const realWins = REAL_TRADES.filter((t) => t.pct >= 0).length;
const simTotal = matched.reduce((a, r) => a + (r.simPct ?? 0), 0);

console.log('=== RESUMO ===');
console.log(`Trades reais: ${REAL_TRADES.length}`);
console.log(`Net real: ${realTotal.toFixed(2)}% | WR: ${((realWins / REAL_TRADES.length) * 100).toFixed(1)}% (${realWins}W/${REAL_TRADES.length - realWins}L)`);
console.log(`Match bot: ${matched.length}/${REAL_TRADES.length}`);
console.log(`Net simulado (matched): ${simTotal.toFixed(2)}%`);
console.log('');

console.log('=== POR ESTRATÉGIA (trades matched) ===');
const byStrat = new Map();
for (const r of matched) {
  if (!byStrat.has(r.strategy)) byStrat.set(r.strategy, { real: 0, sim: 0, n: 0 });
  const b = byStrat.get(r.strategy);
  b.n++;
  b.real += r.pct;
  b.sim += r.simPct ?? 0;
}
for (const [name, b] of [...byStrat.entries()].sort((a, b) => b[1].real - a[1].real)) {
  console.log(`${name.padEnd(35)} n=${b.n} real=${b.real.toFixed(1)}% sim=${b.sim.toFixed(1)}%`);
}

console.log('\n=== DETALHE (real vs sim) ===');
console.log('Symbol       | Dir   | Real%   | Sim%    | Δ      | Estratégia');
for (const r of rows.sort((a, b) => a.at.localeCompare(b.at))) {
  const sim = r.simPct != null ? r.simPct.toFixed(2).padStart(7) : '     —';
  const delta = r.delta != null ? r.delta.toFixed(2).padStart(6) : '     —';
  console.log(
    `${r.symbol.padEnd(12)} | ${r.dir.padEnd(5)} | ${r.pct.toFixed(2).padStart(7)} | ${sim} | ${delta} | ${r.matched ? r.strategy : 'SEM MATCH'}`
  );
}

if (unmatched.length) {
  console.log('\n=== SEM MATCH NO BOT ===');
  for (const r of unmatched) {
    console.log(`${r.symbol} ${r.dir} ${r.pct.toFixed(2)}% @ ${r.at}`);
  }
}

// Real vs sim alignment
const aligned = matched.filter((r) => (r.pct >= 0) === (r.simPct >= 0));
console.log(`\nDirecção igual (ganho/perda): ${aligned.length}/${matched.length} (${((aligned.length / matched.length) * 100).toFixed(0)}%)`);
