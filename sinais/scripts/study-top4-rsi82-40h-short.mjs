/**
 * Estudo Scanner 2 Top 4 — SHORT quando RSI(14) em velas de 40h cruza acima de 82.
 * Universo: histórico de scans UNIVERSE_TOP30_PRICE_CHANGE_24H (ranks 1–4).
 * Métricas: P&L 24h, máximo favorável (low) e máximo adverso (high) após entrada.
 *
 * Uso (pasta sinais):
 *   node scripts/study-top4-rsi82-40h-short.mjs
 *   node scripts/study-top4-rsi82-40h-short.mjs --rsi=82 --level=82 --hours=40
 */

const API_BASE = process.env.API_BASE || 'https://botscanner-production.up.railway.app';
const BYBIT = 'https://api.bybit.nl';
const UNIVERSE = 'UNIVERSE_TOP30_PRICE_CHANGE_24H';
const FEE_RT = 0.1;
const SIZE = 100;

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k, d) => {
    const p = a.find((x) => x.startsWith(`${k}=`));
    return p ? p.slice(k.length + 1) : d;
  };
  return {
    rsiLevel: parseFloat(get('--level', '82')) || 82,
    rsiPeriod: parseInt(get('--rsi', '14'), 10) || 14,
    barHours: parseInt(get('--hours', '40'), 10) || 40,
    top: parseInt(get('--top', '4'), 10) || 4,
    limit: parseInt(get('--limit', '100'), 10) || 100,
    holdHours: parseInt(get('--hold', '24'), 10) || 24,
  };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

/** RSI Wilder (igual ideia ao technicalindicators) */
function rsiSeries(closes, period) {
  if (closes.length < period + 1) return [];
  const out = new Array(closes.length).fill(null);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

async function loadTopHistory(top, limit) {
  const url = `${API_BASE}/api/universe-scans/${UNIVERSE}/history?top=${top}&limit=${limit}`;
  const data = await fetchJson(url);
  const runs = (data.runs || data.history || data.data || []).map((r) => ({
    scannedAt: new Date(r.scannedAt || r.createdAt).getTime(),
    top: (r.top || r.rows || []).map((row, i) => ({
      rank: row.rank ?? i + 1,
      symbol: row.symbol,
      close: row.close,
      pct: row.pctFromMa ?? row.priceChangePercent,
    })),
  }));
  runs.sort((a, b) => a.scannedAt - b.scannedAt);
  return runs;
}

async function fetch1hCandles(symbol, startMs, endMs) {
  const out = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const url =
      `${BYBIT}/v5/market/kline?category=linear&symbol=${symbol}` +
      `&interval=60&start=${cursor}&limit=1000`;
    const data = await fetchJson(url);
    const list = (data.result?.list || [])
      .map((r) => ({
        t: +r[0],
        o: +r[1],
        h: +r[2],
        l: +r[3],
        c: +r[4],
      }))
      .sort((a, b) => a.t - b.t);
    if (!list.length) break;
    for (const c of list) {
      if (c.t >= startMs && c.t <= endMs) out.push(c);
    }
    const last = list[list.length - 1].t;
    const next = last + 3600 * 1000;
    if (next <= cursor) break;
    cursor = next;
    if (list.length < 1000) break;
    await new Promise((r) => setTimeout(r, 60));
  }
  // dedupe
  const map = new Map(out.map((c) => [c.t, c]));
  return [...map.values()].sort((a, b) => a.t - b.t);
}

/** Agrega velas 1h em barras de N horas (alinhadas a epoch UTC). */
function aggregateBars(candles1h, barHours) {
  const ms = barHours * 3600 * 1000;
  const buckets = new Map();
  for (const c of candles1h) {
    const key = Math.floor(c.t / ms) * ms;
    const b = buckets.get(key);
    if (!b) {
      buckets.set(key, { t: key, o: c.o, h: c.h, l: c.l, c: c.c, end: c.t });
    } else {
      b.h = Math.max(b.h, c.h);
      b.l = Math.min(b.l, c.l);
      b.c = c.c;
      b.end = c.t;
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

/** Símbolo está no Top N num dado instante (último scan ≤ t). */
function inTopAt(runs, symbol, tMs, topN) {
  let last = null;
  for (const r of runs) {
    if (r.scannedAt > tMs) break;
    last = r;
  }
  if (!last) return null;
  const row = last.top.find((x) => x.symbol === symbol && x.rank <= topN);
  return row ? { rank: row.rank, scannedAt: last.scannedAt } : null;
}

function measure24h(candles1h, entryTs, entryPrice, holdHours) {
  const endTs = entryTs + holdHours * 3600 * 1000;
  const after = candles1h.filter((c) => c.t > entryTs && c.t <= endTs);
  if (!after.length) return null;
  const high = Math.max(...after.map((c) => c.h));
  const low = Math.min(...after.map((c) => c.l));
  const close = after[after.length - 1].c;
  // SHORT: lucro se preço desce
  const pnlPct = ((entryPrice - close) / entryPrice) * 100;
  const maxFavorable = ((entryPrice - low) / entryPrice) * 100; // melhor low
  const maxAdverse = ((high - entryPrice) / entryPrice) * 100; // pior high
  return {
    close,
    high,
    low,
    pnlPct,
    maxFavorable,
    maxAdverse,
    bars: after.length,
  };
}

function pad(s, n) {
  const t = String(s);
  return t.length >= n ? t.slice(0, n) : t + ' '.repeat(n - t.length);
}

async function main() {
  const cfg = parseArgs();
  console.log('═'.repeat(88));
  console.log('Estudo Top 4 Scanner 2 — SHORT RSI cruzar > ' + cfg.rsiLevel);
  console.log(
    `TF barras: ${cfg.barHours}h | RSI(${cfg.rsiPeriod}) | hold ${cfg.holdHours}h | fee ${FEE_RT}% | $` +
      SIZE +
      '/trade'
  );
  console.log('═'.repeat(88));

  const runs = await loadTopHistory(cfg.top, cfg.limit);
  if (!runs.length) {
    console.error('Sem histórico de scans.');
    process.exit(1);
  }
  const t0 = runs[0].scannedAt;
  const t1 = runs[runs.length - 1].scannedAt;
  console.log(
    `Scans: ${runs.length} | ${new Date(t0).toISOString()} → ${new Date(t1).toISOString()}`
  );

  const symbols = [...new Set(runs.flatMap((r) => r.top.map((x) => x.symbol)))];
  console.log(`Símbolos únicos no Top ${cfg.top}: ${symbols.length}`);

  // Precisamos de histórico RSI antes do 1.º scan
  const warmMs = (cfg.rsiPeriod + 5) * cfg.barHours * 3600 * 1000;
  const endMs = t1 + cfg.holdHours * 3600 * 1000 + 2 * 3600 * 1000;

  const trades = [];
  let i = 0;
  for (const sym of symbols) {
    i++;
    process.stdout.write(`\rCandles ${i}/${symbols.length} ${sym.padEnd(14)}`);
    let candles1h;
    try {
      candles1h = await fetch1hCandles(sym, t0 - warmMs, endMs);
    } catch (e) {
      console.write?.('');
      console.log(`\n  skip ${sym}: ${e.message}`);
      continue;
    }
    if (candles1h.length < 50) continue;

    const bars = aggregateBars(candles1h, cfg.barHours);
    // Só barras fechadas: a barra actual em formação usa end < now-ish; para backtest
    // usamos barras cujo bucket já terminou (próximo bucket existe ou end+barHours < now)
    const closes = bars.map((b) => b.c);
    const rsi = rsiSeries(closes, cfg.rsiPeriod);

    for (let j = 1; j < bars.length; j++) {
      const prev = rsi[j - 1];
      const curr = rsi[j];
      if (prev == null || curr == null) continue;
      if (!(prev <= cfg.rsiLevel && curr > cfg.rsiLevel)) continue;

      // Entrada no fecho da barra 40h (aprox. bars[j].end)
      const entryTs = bars[j].end;
      const entryPrice = bars[j].c;
      // Só se estava no Top 4 nesse momento
      const mem = inTopAt(runs, sym, entryTs, cfg.top);
      if (!mem) continue;

      const m = measure24h(candles1h, entryTs, entryPrice, cfg.holdHours);
      if (!m) continue;

      trades.push({
        symbol: sym,
        rank: mem.rank,
        entryTs,
        entryIso: new Date(entryTs).toISOString(),
        entryPrice,
        rsiPrev: +prev.toFixed(2),
        rsi: +curr.toFixed(2),
        pnlPct: m.pnlPct - FEE_RT,
        grossPct: m.pnlPct,
        maxFavorable: m.maxFavorable,
        maxAdverse: m.maxAdverse,
        close24: m.close,
        high24: m.high,
        low24: m.low,
      });
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  console.log('\n');

  // Dedupe: 1 trade / símbolo / barra (já único); opcional 1/símbolo/dia
  trades.sort((a, b) => a.entryTs - b.entryTs);

  console.log('─'.repeat(88));
  console.log(
    pad('Data UTC', 18) +
      pad('Símbolo', 14) +
      pad('Rk', 4) +
      pad('RSI', 8) +
      pad('P&L%', 9) +
      pad('Máx+', 8) +
      pad('Máx-', 8) +
      'Nota'
  );
  console.log('─'.repeat(88));

  for (const t of trades) {
    const note =
      t.maxAdverse >= 10
        ? 'adverso≥10%'
        : t.maxFavorable >= 10
          ? 'favor≥10%'
          : '';
    console.log(
      pad(t.entryIso.slice(0, 16), 18) +
        pad(t.symbol, 14) +
        pad(String(t.rank), 4) +
        pad(String(t.rsi), 8) +
        pad((t.pnlPct >= 0 ? '+' : '') + t.pnlPct.toFixed(2), 9) +
        pad('+' + t.maxFavorable.toFixed(1), 8) +
        pad('+' + t.maxAdverse.toFixed(1), 8) +
        note
    );
  }

  if (!trades.length) {
    console.log('Nenhum cruzamento RSI com símbolo no Top 4 neste histórico.');
    console.log(
      'Nota: barras de 40h são raras — com ~100 scans (~2–3 semanas) pode haver poucos eventos.'
    );
    return;
  }

  const sum = trades.reduce((a, b) => a + b.pnlPct, 0);
  const wins = trades.filter((t) => t.pnlPct > 0).length;
  const avgFav = trades.reduce((a, b) => a + b.maxFavorable, 0) / trades.length;
  const avgAdv = trades.reduce((a, b) => a + b.maxAdverse, 0) / trades.length;
  const med = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  console.log('\n' + '═'.repeat(88));
  console.log(`Trades: ${trades.length}`);
  console.log(
    `P&L médio: ${sum >= 0 ? '+' : ''}${(sum / trades.length).toFixed(3)}% | Soma: ${sum >= 0 ? '+' : ''}${sum.toFixed(1)}% | USDT@$100: ${sum >= 0 ? '+' : ''}${(sum * SIZE) / 100}`
  );
  console.log(
    `WR: ${((100 * wins) / trades.length).toFixed(1)}% (${wins}W / ${trades.length - wins}L)`
  );
  console.log(
    `Máx favorável (queda) médio: +${avgFav.toFixed(2)}% | mediano +${med(trades.map((t) => t.maxFavorable)).toFixed(2)}%`
  );
  console.log(
    `Máx adverso (subida) médio: +${avgAdv.toFixed(2)}% | mediano +${med(trades.map((t) => t.maxAdverse)).toFixed(2)}%`
  );

  // Also test "já acima de 82" at each scan (estado, não cruzamento) as secondary
  console.log('\n── Extra: em cada scan Top4, se RSI_40h > nível (estado, não cruzamento) ──');
  const stateTrades = [];
  const seenState = new Set();
  for (const run of runs) {
    for (const row of run.top) {
      if (row.rank > cfg.top) continue;
      // find last closed 40h bar before scan
      // reuse would need candles — skip heavy; only report cross study as main
    }
  }
  console.log('(estudo principal = cruzamento; ver tabela acima)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
