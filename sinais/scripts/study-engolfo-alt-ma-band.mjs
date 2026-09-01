/**
 * Estudo: engolfo — lógica alternativa
 *
 * ENTRA (SELL 15m):
 *  - vela bear (fecho < abertura)
 *  - fecho ≥ minDropPct% abaixo do fecho anterior (engolfo)
 *  - fecho < EMA12 e fecho < EMA21
 *  - NÃO mais de maxDistBelowMa21Pct% abaixo da EMA21
 *    i.e. (EMA21 − close)/EMA21×100 ≤ 7
 *
 * SAI: SL +10% | TP1 −20% (50%) | resto 24h | fee 0,1%
 *
 * Universo: top volume USDT-M (aprox. líquido; filtro Scanner 2 no live).
 * Compara também com a regra actual (EMA12<EMA21 + close<EMA21, sem tecto 7%).
 *
 * Uso: node scripts/study-engolfo-alt-ma-band.mjs
 */

const BINANCE = 'https://fapi.binance.com';
const FEE = 0.1;
const SIZE = 100;
const TOP_N = 80;
const MIN_QUOTE_VOL = 5_000_000;
const LOOKBACK_DAYS = 14;
const MIN_DROP = 1;
const MAX_DIST_BELOW_21 = 7;
const SL_PCT = 10;
const TP1_PCT = 20;
const TP1_POS = 0.5;
const HOLD_H = 24;
const COOLDOWN_BARS = 4; // 1h entre trades no mesmo símbolo

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function topSymbols() {
  const data = await fetchJson(`${BINANCE}/fapi/v1/ticker/24hr`);
  return data
    .filter(
      (t) =>
        typeof t.symbol === 'string' &&
        t.symbol.endsWith('USDT') &&
        !t.symbol.includes('_') &&
        +t.quoteVolume >= MIN_QUOTE_VOL
    )
    .sort((a, b) => +b.quoteVolume - +a.quoteVolume)
    .slice(0, TOP_N)
    .map((t) => t.symbol);
}

async function fetchKlines(symbol, startMs, endMs) {
  const out = [];
  let cursor = startMs;
  const step = 15 * 60_000;
  while (cursor < endMs) {
    const url =
      `${BINANCE}/fapi/v1/klines?symbol=${symbol}&interval=15m` +
      `&startTime=${cursor}&endTime=${endMs}&limit=1500`;
    const list = await fetchJson(url);
    if (!Array.isArray(list) || !list.length) break;
    for (const r of list) {
      const t = +r[0];
      if (t >= startMs && t <= endMs) {
        out.push({ t, o: +r[1], h: +r[2], l: +r[3], c: +r[4] });
      }
    }
    const last = +list[list.length - 1][0];
    if (last + step <= cursor) break;
    cursor = last + step;
    if (list.length < 1500) break;
    await new Promise((r) => setTimeout(r, 35));
  }
  return [...new Map(out.map((c) => [c.t, c])).values()].sort((a, b) => a.t - b.t);
}

function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function walkSell(candles, entryIdx, entry) {
  const sl = entry * (1 + SL_PCT / 100);
  const t1 = entry * (1 - TP1_PCT / 100);
  const endT = candles[entryIdx].t + HOLD_H * 3600_000;
  let hitT1 = false;

  for (let i = entryIdx + 1; i < candles.length; i++) {
    const b = candles[i];
    if (b.t > endT) break;
    const hitSl = b.h >= sl;
    const hit1 = b.l <= t1;
    if (!hitT1) {
      if (hitSl && hit1) {
        return { pnl: ((entry - sl) / entry) * 100 - FEE, path: 'SL' };
      }
      if (hitSl) return { pnl: ((entry - sl) / entry) * 100 - FEE, path: 'SL' };
      if (hit1) {
        hitT1 = true;
        continue;
      }
    } else if (hitSl) {
      const p1 = ((entry - t1) / entry) * 100;
      const p2 = ((entry - sl) / entry) * 100;
      return { pnl: TP1_POS * p1 + (1 - TP1_POS) * p2 - FEE, path: 'T1+SL' };
    }
  }

  let last = null;
  for (let i = entryIdx; i < candles.length; i++) {
    if (candles[i].t <= endT) last = candles[i];
  }
  if (!last) last = candles[candles.length - 1];
  const closeP = ((entry - last.c) / entry) * 100;
  if (hitT1) {
    const p1 = ((entry - t1) / entry) * 100;
    return { pnl: TP1_POS * p1 + (1 - TP1_POS) * closeP - FEE, path: 'T1+24h' };
  }
  return { pnl: closeP - FEE, path: '24h' };
}

function summarize(label, trades) {
  if (!trades.length) {
    console.log(`\n${label}: 0 trades`);
    return { label, n: 0, avg: 0, usdt: 0, wr: 0, byPath: {} };
  }
  const sum = trades.reduce((a, b) => a + b.pnl, 0);
  const wins = trades.filter((t) => t.pnl >= 0).length;
  const byPath = {};
  for (const t of trades) byPath[t.path] = (byPath[t.path] || 0) + 1;
  const s = {
    label,
    n: trades.length,
    avg: sum / trades.length,
    usdt: (sum * SIZE) / 100,
    wr: (100 * wins) / trades.length,
    byPath,
  };
  console.log('\n' + '─'.repeat(88));
  console.log(label);
  console.log(
    `n=${s.n} avg=${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}% USDT=${s.usdt >= 0 ? '+' : ''}${s.usdt.toFixed(0)} WR=${s.wr.toFixed(1)}%`,
    s.byPath
  );
  return s;
}

async function main() {
  const now = Date.now();
  const endMs = now;
  const startMs = now - LOOKBACK_DAYS * 24 * 3600 * 1000;
  const warmMs = 40 * 15 * 60_000;

  console.log('═'.repeat(88));
  console.log(
    `ENGOLFO alt (fecho < MA12 & MA21, ≤${MAX_DIST_BELOW_21}% abaixo MA21) | ${new Date(startMs).toISOString().slice(0, 10)} → ${new Date(endMs).toISOString().slice(0, 10)}`
  );
  console.log(
    `Top ${TOP_N} vol≥${(MIN_QUOTE_VOL / 1e6).toFixed(0)}M | drop≥${MIN_DROP}% | SL ${SL_PCT}% | TP1 ${TP1_PCT}%@${TP1_POS * 100}% | ${HOLD_H}h | fee ${FEE}%`
  );
  console.log('═'.repeat(88));

  const symbols = await topSymbols();
  console.log(`Símbolos: ${symbols.length}`);

  const tradesAlt = [];
  const tradesOld = [];
  let scanned = 0;

  for (let si = 0; si < symbols.length; si++) {
    const sym = symbols[si];
    process.stdout.write(`\r${si + 1}/${symbols.length} ${sym.padEnd(16)}`);
    let c15;
    try {
      c15 = await fetchKlines(sym, startMs - warmMs, endMs + HOLD_H * 3600_000);
    } catch {
      continue;
    }
    if (c15.length < 40) continue;
    scanned++;

    const closes = c15.map((c) => c.c);
    const e12 = emaSeries(closes, 12);
    const e21 = emaSeries(closes, 21);

    let lastAlt = -COOLDOWN_BARS;
    let lastOld = -COOLDOWN_BARS;

    for (let i = 25; i < c15.length - 1; i++) {
      // só velas fechadas no período de estudo
      const t = c15[i].t;
      if (t < startMs || t > endMs) continue;

      const prev = c15[i - 1];
      const curr = c15[i];
      if (!(prev.c > 0) || !(curr.c > 0)) continue;
      if (!(curr.c < curr.o)) continue; // bear
      const dropPct = ((prev.c - curr.c) / prev.c) * 100;
      if (dropPct < MIN_DROP) continue;
      if (e12[i] == null || e21[i] == null || !(e21[i] > 0)) continue;

      const belowBoth = curr.c < e12[i] && curr.c < e21[i];
      const distBelow21 = ((e21[i] - curr.c) / e21[i]) * 100;
      const notTooDeep = distBelow21 <= MAX_DIST_BELOW_21;

      // --- regra ALT ---
      if (belowBoth && notTooDeep && i - lastAlt >= COOLDOWN_BARS) {
        const ex = walkSell(c15, i, curr.c);
        tradesAlt.push({
          sym,
          day: new Date(t).toISOString().slice(0, 10),
          drop: +dropPct.toFixed(2),
          dist21: +distBelow21.toFixed(2),
          e12: +e12[i].toFixed(6),
          e21: +e21[i].toFixed(6),
          stack12lt21: e12[i] < e21[i],
          ...ex,
        });
        lastAlt = i;
      }

      // --- regra OLD (actual engolfo) ---
      const oldOk = e12[i] < e21[i] && curr.c < e21[i];
      if (oldOk && i - lastOld >= COOLDOWN_BARS) {
        const ex = walkSell(c15, i, curr.c);
        tradesOld.push({
          sym,
          day: new Date(t).toISOString().slice(0, 10),
          drop: +dropPct.toFixed(2),
          dist21: +distBelow21.toFixed(2),
          ...ex,
        });
        lastOld = i;
      }
    }
  }

  process.stdout.write('\n');
  console.log(`Scanned OK: ${scanned}`);

  const sAlt = summarize(
    `ALT: fecho < MA12 & MA21 + dist≤${MAX_DIST_BELOW_21}% abaixo MA21`,
    tradesAlt
  );
  const sOld = summarize('OLD: EMA12<EMA21 + fecho<EMA21 (sem tecto 7%)', tradesOld);

  const best = [...tradesAlt].sort((a, b) => b.pnl - a.pnl).slice(0, 8);
  const worst = [...tradesAlt].sort((a, b) => a.pnl - b.pnl).slice(0, 8);
  console.log('\nTop wins ALT:');
  for (const t of best)
    console.log(
      `  ${t.day} ${t.sym} ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}% ${t.path} drop=${t.drop}% dist21=${t.dist21}% stack=${t.stack12lt21}`
    );
  console.log('Top losses ALT:');
  for (const t of worst)
    console.log(
      `  ${t.day} ${t.sym} ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}% ${t.path} drop=${t.drop}% dist21=${t.dist21}%`
    );

  const byDay = {};
  for (const t of tradesAlt) {
    if (!byDay[t.day]) byDay[t.day] = { n: 0, sum: 0 };
    byDay[t.day].n++;
    byDay[t.day].sum += t.pnl;
  }
  console.log('\nP&L diário ALT:');
  for (const d of Object.keys(byDay).sort()) {
    const x = byDay[d];
    console.log(
      `  ${d} n=${x.n} sum=${x.sum >= 0 ? '+' : ''}${x.sum.toFixed(2)}% USDT=${((x.sum * SIZE) / 100).toFixed(0)}`
    );
  }

  // buckets por distância à MA21
  const buckets = [
    { name: '0–2%', lo: 0, hi: 2 },
    { name: '2–4%', lo: 2, hi: 4 },
    { name: '4–7%', lo: 4, hi: 7.0001 },
  ];
  console.log('\nALT por dist abaixo MA21:');
  const byDist = [];
  for (const b of buckets) {
    const sub = tradesAlt.filter((t) => t.dist21 >= b.lo && t.dist21 < b.hi);
    if (!sub.length) continue;
    const sum = sub.reduce((a, t) => a + t.pnl, 0);
    const wr = (100 * sub.filter((t) => t.pnl >= 0).length) / sub.length;
    console.log(
      `  ${b.name} n=${sub.length} avg=${(sum / sub.length).toFixed(2)}% USDT=${((sum * SIZE) / 100).toFixed(0)} WR=${wr.toFixed(1)}%`
    );
    byDist.push({
      name: b.name,
      n: sub.length,
      avg: sum / sub.length,
      usdt: (sum * SIZE) / 100,
      wr,
    });
  }

  const withStack = tradesAlt.filter((t) => t.stack12lt21);
  const withoutStack = tradesAlt.filter((t) => !t.stack12lt21);
  const stackSum = (arr) =>
    arr.length
      ? {
          n: arr.length,
          avg: arr.reduce((a, t) => a + t.pnl, 0) / arr.length,
          usdt: (arr.reduce((a, t) => a + t.pnl, 0) * SIZE) / 100,
          wr: (100 * arr.filter((t) => t.pnl >= 0).length) / arr.length,
        }
      : null;

  const fs = await import('fs');
  const out = {
    period: {
      from: new Date(startMs).toISOString().slice(0, 10),
      to: new Date(endMs).toISOString().slice(0, 10),
    },
    rules: {
      alt: `bear + drop≥${MIN_DROP}% + close<EMA12 & close<EMA21 + distBelow21≤${MAX_DIST_BELOW_21}%`,
      old: 'bear + drop≥1% + EMA12<EMA21 + close<EMA21',
      exit: `SL+${SL_PCT}% TP1-${TP1_PCT}%@${TP1_POS * 100}% resto ${HOLD_H}h fee ${FEE}%`,
    },
    symbols: symbols.length,
    scanned,
    alt: sAlt,
    old: sOld,
    altWithStack12lt21: stackSum(withStack),
    altWithoutStack12lt21: stackSum(withoutStack),
    byDist,
    best: best.map((t) => ({
      day: t.day,
      sym: t.sym,
      pnl: +t.pnl.toFixed(2),
      path: t.path,
      drop: t.drop,
      dist21: t.dist21,
    })),
    worst: worst.map((t) => ({
      day: t.day,
      sym: t.sym,
      pnl: +t.pnl.toFixed(2),
      path: t.path,
      drop: t.drop,
      dist21: t.dist21,
    })),
    byDay: Object.keys(byDay)
      .sort()
      .map((d) => ({
        d,
        n: byDay[d].n,
        sum: +byDay[d].sum.toFixed(2),
        usdt: +((byDay[d].sum * SIZE) / 100).toFixed(2),
      })),
  };

  const path = new URL('./out-engolfo-alt-ma-band.json', import.meta.url);
  fs.writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path.pathname || path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
