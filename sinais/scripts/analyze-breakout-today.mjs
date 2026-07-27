/**
 * P&L hipotético — Rompimento de Acumulação 15m (sinais de hoje, fecho agora).
 * Uso: node scripts/analyze-breakout-today.mjs [YYYY-MM-DD]
 */

const API_BASE = process.env.API_BASE || 'https://botscanner-production.up.railway.app';
const DATE = process.argv[2] || new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Lisbon' });

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function fetchBybitPrice(symbol) {
  const url = `https://api.bybit.nl/v5/market/tickers?category=linear&symbol=${symbol}`;
  const data = await fetchJson(url);
  const row = data?.result?.list?.[0];
  const px = parseFloat(row?.lastPrice || '0');
  if (!px) throw new Error(`Preço inválido ${symbol}`);
  return px;
}

function pct(entry, exit, direction) {
  if (direction === 'BUY') return ((exit - entry) / entry) * 100;
  return ((entry - exit) / entry) * 100;
}

function statusLabel(pnlPct, sl, tp1, current, direction) {
  if (direction === 'BUY') {
    if (current <= sl) return 'SL atingido';
    if (tp1 && current >= tp1) return 'TP1 atingido';
  } else {
    if (current >= sl) return 'SL atingido';
    if (tp1 && current <= tp1) return 'TP1 atingido';
  }
  return 'Aberto';
}

const url =
  `${API_BASE}/api/signals?minStrength=0&activeOnly=false&dateFrom=${DATE}&dateTo=${DATE}&limit=5000`;
const { signals } = await fetchJson(url);

const breakout = signals.filter(
  (s) =>
    s.strategyName?.includes('Rompimento') ||
    s.strategy?.name === 'ACCUMULATION_BREAKOUT_15M'
);

console.log(`\n📅 Data (PT): ${DATE}`);
console.log(`🔗 API: ${API_BASE}`);
console.log(`📊 Sinais Rompimento Acumulação: ${breakout.length}\n`);

if (breakout.length === 0) {
  console.log('Nenhum sinal hoje para esta estratégia.');
  process.exit(0);
}

const rows = [];
for (const s of breakout) {
  await new Promise((r) => setTimeout(r, 120));
  let current;
  try {
    current = await fetchBybitPrice(s.symbol);
  } catch (e) {
    current = null;
  }
  const pnl = current != null ? pct(s.entryPrice, current, s.direction) : null;
  rows.push({
    symbol: s.symbol,
    time: new Date(s.generatedAt).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' }),
    entry: s.entryPrice,
    sl: s.stopLoss,
    tp1: s.target1,
    current,
    pnlPct: pnl,
    status: s.status,
    live: current != null ? statusLabel(pnl, s.stopLoss, s.target1, current, s.direction) : 'erro preço',
  });
}

rows.sort((a, b) => (b.pnlPct ?? -999) - (a.pnlPct ?? -999));

let sum = 0;
let wins = 0;
let losses = 0;
for (const r of rows) {
  if (r.pnlPct == null) continue;
  sum += r.pnlPct;
  if (r.pnlPct > 0) wins++;
  else if (r.pnlPct < 0) losses++;
  const sign = r.pnlPct >= 0 ? '+' : '';
  console.log(
    `${r.symbol.padEnd(14)} | ${r.time} | entrada ${r.entry.toFixed(6)} → agora ${r.current?.toFixed(6) ?? '?'} | ${sign}${r.pnlPct.toFixed(2)}% | ${r.live} | BD: ${r.status}`
  );
}

const n = rows.filter((r) => r.pnlPct != null).length;
console.log('\n' + '─'.repeat(72));
console.log(`Trades: ${n} | Verdes: ${wins} | Vermelhos: ${losses} | Flat: ${n - wins - losses}`);
if (n > 0) {
  console.log(`P&L médio (fecho agora, 100% posição): ${sum >= 0 ? '+' : ''}${(sum / n).toFixed(2)}%`);
  console.log(`P&L total simples (soma %): ${sum >= 0 ? '+' : ''}${sum.toFixed(2)}%`);
}
console.log('(Não inclui TP parcial 50% — assume fecho total ao preço actual Bybit)\n');
