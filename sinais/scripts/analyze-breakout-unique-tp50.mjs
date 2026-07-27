/**
 * Rompimento 15m — 1.º sinal único por símbolo/dia, P&L com TP1 50% + resto ao preço actual.
 */
const API_BASE = process.env.API_BASE || 'https://botscanner-production.up.railway.app';
const DATE = process.argv[2] || '2026-06-15';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function fetchBybitPrice(symbol) {
  const data = await fetchJson(
    `https://api.bybit.nl/v5/market/tickers?category=linear&symbol=${symbol}`
  );
  const px = parseFloat(data?.result?.list?.[0]?.lastPrice || '0');
  if (!px) throw new Error(`Preço inválido ${symbol}`);
  return px;
}

/** P&L % ponderado: 50% TP1 + 50% preço actual, ou SL -7% integral, ou 100% actual. */
function blendedPnlPct(entry, sl, tp1, current, tp1PositionPct = 50) {
  const slPct = ((sl - entry) / entry) * 100; // negativo (~-7)
  const tp1Pct = tp1 ? ((tp1 - entry) / entry) * 100 : null;
  const nowPct = ((current - entry) / entry) * 100;

  if (current <= sl) return { pnl: slPct, mode: 'SL -7% (100%)' };

  const tpFrac = Math.min(100, Math.max(0, tp1PositionPct)) / 100;
  const restFrac = 1 - tpFrac;

  if (tp1 && current >= tp1) {
    const pnl = tpFrac * tp1Pct + restFrac * nowPct;
    return { pnl, mode: `TP1 ${tp1PositionPct}% + resto actual` };
  }

  return { pnl: nowPct, mode: '100% preço actual' };
}

const url = `${API_BASE}/api/signals?minStrength=0&activeOnly=false&dateFrom=${DATE}&dateTo=${DATE}&limit=5000`;
const { signals } = await fetchJson(url);

const all = signals
  .filter((s) => s.strategyName?.includes('Rompimento'))
  .sort((a, b) => new Date(a.generatedAt) - new Date(b.generatedAt));

const uniq = [];
const seen = new Set();
for (const s of all) {
  if (seen.has(s.symbol)) continue;
  seen.add(s.symbol);
  uniq.push(s);
}

console.log(`\n📅 ${DATE} (PT) — Rompimento Acumulação 15m`);
console.log(`📊 ${all.length} sinais → ${uniq.length} trades únicos (1.º sinal/símbolo)\n`);

const rows = [];
for (const s of uniq) {
  await new Promise((r) => setTimeout(r, 100));
  const current = await fetchBybitPrice(s.symbol);
  let tp1Pos = 50;
  try {
    const extra = s.extraInfo ? JSON.parse(s.extraInfo) : {};
    if (extra.tp1Position != null) tp1Pos = Number(extra.tp1Position);
  } catch {
    /* default 50 */
  }
  const { pnl, mode } = blendedPnlPct(s.entryPrice, s.stopLoss, s.target1, current, tp1Pos);
  rows.push({
    symbol: s.symbol,
    time: new Date(s.generatedAt).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' }),
    entry: s.entryPrice,
    sl: s.stopLoss,
    tp1: s.target1,
    current,
    pnl,
    mode,
  });
}

rows.sort((a, b) => b.pnl - a.pnl);

let sum = 0;
let wins = 0;
let losses = 0;
let tp1Partial = 0;
let slHit = 0;

for (const r of rows) {
  sum += r.pnl;
  if (r.pnl > 0) wins++;
  else if (r.pnl < 0) losses++;
  if (r.mode.includes('TP1')) tp1Partial++;
  if (r.mode.includes('SL')) slHit++;
  const sign = r.pnl >= 0 ? '+' : '';
  console.log(
    `${r.symbol.padEnd(14)} | ${r.time.slice(11, 16)} | ${sign}${r.pnl.toFixed(2)}% | ${r.mode}`
  );
}

console.log('\n' + '═'.repeat(72));
console.log(`Trades únicos: ${rows.length}`);
console.log(`Verdes: ${wins} | Vermelhos: ${losses} | Neutros: ${rows.length - wins - losses}`);
console.log(`Com TP1 parcial (50%): ${tp1Partial} | SL -7% integral: ${slHit}`);
console.log(`P&L médio ponderado: ${sum >= 0 ? '+' : ''}${(sum / rows.length).toFixed(2)}%`);
console.log(`P&L total (soma dos ${rows.length} trades): ${sum >= 0 ? '+' : ''}${sum.toFixed(2)}%`);
console.log('\nPremissas: 1 trade/símbolo (1.º sinal); TP1 = +10,5% (R×1,5); 50% pos. no TP1;');
console.log('restante ao preço Bybit actual; SL = -7% se preço ≤ stop.\n');
