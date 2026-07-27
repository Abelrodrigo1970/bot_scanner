/**
 * Rompimento 15m — P&L por força e ranking Scanner 1 no momento do sinal.
 * node scripts/analyze-breakout-strength-rank.mjs [YYYY-MM-DD]
 */
const API = process.env.API_BASE || 'https://botscanner-production.up.railway.app';
const SCANNER_CODE = 'UNIVERSE_ABOVE_MA200_1H';
const DATE = process.argv[2] || '2026-06-15';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function fetchPrice(symbol) {
  const d = await fetchJson(
    `https://api.bybit.nl/v5/market/tickers?category=linear&symbol=${symbol}`
  );
  return parseFloat(d.result.list[0].lastPrice);
}

function blendedPnl(entry, sl, tp1, current, tp1Pos = 50) {
  const slPct = ((sl - entry) / entry) * 100;
  const nowPct = ((current - entry) / entry) * 100;
  if (current <= sl) return slPct;
  if (tp1 && current >= tp1) {
    const tp1Pct = ((tp1 - entry) / entry) * 100;
    const f = tp1Pos / 100;
    return f * tp1Pct + (1 - f) * nowPct;
  }
  return nowPct;
}

function rankMapFromRun(run) {
  const sorted = [...run.rows].sort(
    (a, b) => Math.abs(b.pctFromMa) - Math.abs(a.pctFromMa)
  );
  const map = new Map();
  sorted.forEach((r, i) => {
    map.set(r.symbol, {
      rank: i + 1,
      pctFromMa: r.pctFromMa,
      absPct: Math.abs(r.pctFromMa),
    });
  });
  return map;
}

function findScanAtTime(runs, at) {
  const t = at.getTime();
  for (const run of runs) {
    if (new Date(run.scannedAt).getTime() <= t) return run;
  }
  return runs[runs.length - 1] ?? null;
}

function bucketStrength(s) {
  if (s <= 65) return '60–65';
  if (s <= 70) return '66–70';
  if (s <= 75) return '71–75';
  if (s <= 80) return '76–80';
  if (s <= 85) return '81–85';
  return '86–95';
}

function bucketRank(r) {
  if (r == null) return 'Fora do scan';
  if (r <= 5) return 'Top 1–5';
  if (r <= 10) return 'Top 6–10';
  if (r <= 20) return 'Top 11–20';
  if (r <= 30) return 'Top 21–30';
  if (r <= 40) return 'Top 31–40';
  if (r <= 50) return 'Top 41–50';
  return 'Rank >50';
}

function summarize(label, items) {
  if (items.length === 0) {
    console.log(`  ${label.padEnd(14)} — sem sinais`);
    return;
  }
  const pnls = items.map((x) => x.pnl);
  const avg = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const wins = pnls.filter((p) => p > 0).length;
  const tp1 = items.filter((x) => x.hitTp1).length;
  const sl = items.filter((x) => x.hitSl).length;
  console.log(
    `  ${label.padEnd(14)} | n=${String(items.length).padStart(3)} | verdes ${String(wins).padStart(3)} (${((wins / items.length) * 100).toFixed(0)}%) | média ${avg >= 0 ? '+' : ''}${avg.toFixed(2)}% | TP1:${tp1} SL:${sl}`
  );
}

console.log(`\n📅 Rompimento Acumulação — ${DATE} (PT)`);
console.log(`🔗 ${API}\n`);

const [{ signals }, hist] = await Promise.all([
  fetchJson(
    `${API}/api/signals?minStrength=0&activeOnly=false&dateFrom=${DATE}&dateTo=${DATE}&limit=5000`
  ),
  fetchJson(
    `${API}/api/universe-scans/${SCANNER_CODE}/history?top=400&limit=80`
  ),
]);

if (!hist.success) throw new Error('Histórico Scanner 1 indisponível');

const breakout = signals
  .filter((s) => s.strategyName?.includes('Rompimento'))
  .sort((a, b) => new Date(a.generatedAt) - new Date(b.generatedAt));

console.log(`Sinais Rompimento: ${breakout.length}`);
console.log(`Runs Scanner 1 em histórico: ${hist.totalRuns}\n`);

// Pre-process runs with full row ranking (API history only has `top` — refetch rows via runs)
// hist.runs[].top has limited fields; need full rows — check response structure
const runsFull = await fetchJson(
  `${API}/api/universe-scans/${SCANNER_CODE}/history?top=400&limit=80`
);

// Build rank maps per run — use `top` array which has up to 400 symbols
const runRankMaps = runsFull.runs.map((run) => ({
  scannedAt: new Date(run.scannedAt),
  rankMap: (() => {
    const sorted = [...run.top].sort((a, b) => Math.abs(b.pctFromMa) - Math.abs(a.pctFromMa));
    const m = new Map();
    sorted.forEach((r, i) => m.set(r.symbol, { rank: i + 1, pctFromMa: r.pctFromMa }));
    return m;
  })(),
}));

const enriched = [];
const priceCache = new Map();

for (const s of breakout) {
  const at = new Date(s.generatedAt);
  let scan = runRankMaps.find((r) => r.scannedAt.getTime() <= at.getTime());
  if (!scan) scan = runRankMaps[runRankMaps.length - 1];

  const rankInfo = scan?.rankMap.get(s.symbol) ?? null;
  const rank = rankInfo?.rank ?? null;

  if (!priceCache.has(s.symbol)) {
    await new Promise((r) => setTimeout(r, 80));
    priceCache.set(s.symbol, await fetchPrice(s.symbol));
  }
  const current = priceCache.get(s.symbol);
  const pnl = blendedPnl(s.entryPrice, s.stopLoss, s.target1, current);
  const hitSl = current <= s.stopLoss;
  const hitTp1 = s.target1 != null && current >= s.target1;

  enriched.push({
    symbol: s.symbol,
    time: at.toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' }),
    strength: s.strength,
    rank,
    pctFromMa: rankInfo?.pctFromMa ?? null,
    pnl,
    hitSl,
    hitTp1,
    strengthBucket: bucketStrength(s.strength),
    rankBucket: bucketRank(rank),
  });
}

// --- Todos os sinais ---
console.log('═'.repeat(72));
console.log('POR FORÇA (todos os sinais, TP1 50% + resto actual)');
console.log('─'.repeat(72));
for (const b of ['60–65', '66–70', '71–75', '76–80', '81–85', '86–95']) {
  summarize(b, enriched.filter((e) => e.strengthBucket === b));
}

console.log('\nPOR RANKING SCANNER 1 (|afastamento| vs SMA200 no scan ≤ hora do sinal)');
console.log('─'.repeat(72));
for (const b of [
  'Top 1–5',
  'Top 6–10',
  'Top 11–20',
  'Top 21–30',
  'Top 31–40',
  'Top 41–50',
  'Rank >50',
  'Fora do scan',
]) {
  summarize(b, enriched.filter((e) => e.rankBucket === b));
}

// --- Únicos por símbolo ---
const seen = new Set();
const uniq = enriched.filter((e) => {
  if (seen.has(e.symbol)) return false;
  seen.add(e.symbol);
  return true;
});

console.log('\n' + '═'.repeat(72));
console.log(`POR FORÇA — 1.º sinal/símbolo (${uniq.length} trades)`);
console.log('─'.repeat(72));
for (const b of ['60–65', '66–70', '71–75', '76–80', '81–85', '86–95']) {
  summarize(b, uniq.filter((e) => e.strengthBucket === b));
}

console.log('\nPOR RANKING — 1.º sinal/símbolo');
console.log('─'.repeat(72));
for (const b of [
  'Top 1–5',
  'Top 6–10',
  'Top 11–20',
  'Top 21–30',
  'Top 31–40',
  'Top 41–50',
  'Rank >50',
  'Fora do scan',
]) {
  summarize(b, uniq.filter((e) => e.rankBucket === b));
}

// Top examples
console.log('\n' + '═'.repeat(72));
console.log('DETALHE (1.º sinal/símbolo — rank, força, P&L)');
console.log('─'.repeat(72));
uniq
  .sort((a, b) => a.rank - b.rank || b.pnl - a.pnl)
  .forEach((e) => {
    const sign = e.pnl >= 0 ? '+' : '';
    const rk = e.rank != null ? `#${e.rank}` : '—';
    const af = e.pctFromMa != null ? `${e.pctFromMa >= 0 ? '+' : ''}${e.pctFromMa.toFixed(1)}%` : '—';
    console.log(
      `${e.symbol.padEnd(14)} | rank ${String(rk).padStart(4)} (${af.padStart(7)}) | força ${e.strength} | ${sign}${e.pnl.toFixed(2)}%`
    );
  });

console.log('\nNota: ranking = posição no Scanner 1 (|pct vs SMA200|) no último scan ≤ hora do sinal.\n');
