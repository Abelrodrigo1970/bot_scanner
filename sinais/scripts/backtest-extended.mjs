import { readFileSync, writeFileSync } from 'fs';

const stripBom = s => s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
const s1data = JSON.parse(stripBom(readFileSync('./scripts/s1_hist_full.json', 'utf8')));
const s4data = JSON.parse(stripBom(readFileSync('./scripts/s4_hist_full.json', 'utf8')));

const STOP_LOSS_PCT = 5;
const CAPITAL_PER_SYMBOL = 100;
const FEE_PCT_PER_SIDE = 0.055; // ~0.055% taker Bybit (estimativa)

function calcExit(buyPrice, marketExit, stopLossPct) {
  if (marketExit === null) {
    if (stopLossPct !== null) {
      return {
        pnlPct: -stopLossPct,
        soldPrice: buyPrice * (1 - stopLossPct / 100),
        stoppedOut: true,
        note: 'saiu scanner SL',
      };
    }
    return null;
  }
  const rawPnlPct = ((marketExit - buyPrice) / buyPrice) * 100;
  if (stopLossPct !== null && rawPnlPct < -stopLossPct) {
    return {
      pnlPct: -stopLossPct,
      soldPrice: buyPrice * (1 - stopLossPct / 100),
      stoppedOut: true,
      note: `SL (mercado ${rawPnlPct.toFixed(2)}%)`,
    };
  }
  return {
    pnlPct: rawPnlPct,
    soldPrice: marketExit,
    stoppedOut: false,
    note: '',
  };
}

function summarizeTrades(trades, topN, capitalPerSymbol, label, extra = {}) {
  let totalPnl = 0;
  let wins = 0;
  let losses = 0;
  let stopLossHits = 0;
  for (const t of trades) {
    totalPnl += t.pnlUsdt;
    if (t.pnlPct > 0) wins++;
    else losses++;
    if (t.stoppedOut) stopLossHits++;
  }
  const initialCapital = topN * capitalPerSymbol;
  return {
    label,
    topN,
    initialCapital,
    finalCapital: parseFloat((initialCapital + totalPnl).toFixed(2)),
    totalPnlUsdt: parseFloat(totalPnl.toFixed(2)),
    totalPnlPct: parseFloat(((totalPnl / initialCapital) * 100).toFixed(2)),
    totalTrades: trades.length,
    wins,
    losses,
    winRate: trades.length > 0 ? parseFloat((wins / trades.length * 100).toFixed(1)) : 0,
    stopLossHits,
    trades,
    ...extra,
  };
}

/** Rotação total: compra top N no ciclo i, vende tudo no ciclo i+1 */
function backtestFull(data, topN, capitalPerSymbol, stopLossPct) {
  const runs = [...data.runs].reverse();
  const trades = [];

  for (let i = 0; i < runs.length - 1; i++) {
    const buyRun = runs[i];
    const sellRun = runs[i + 1];
    const sellPrices = new Map();
    for (const row of sellRun.top) sellPrices.set(row.symbol, row.close);

    for (const bought of buyRun.top.slice(0, topN)) {
      const buyPrice = bought.close;
      const exit = calcExit(buyPrice, sellPrices.get(bought.symbol) ?? null, stopLossPct);
      if (!exit) continue;

      const pnlUsdt = capitalPerSymbol * (exit.pnlPct / 100);
      trades.push({
        mode: 'full',
        scanner: data.code,
        cycle: i + 1,
        buyAt: buyRun.scannedAt,
        sellAt: sellRun.scannedAt,
        symbol: bought.symbol,
        rank: bought.rank,
        buyPrice,
        soldPrice: exit.soldPrice,
        pnlPct: parseFloat(exit.pnlPct.toFixed(3)),
        pnlUsdt: parseFloat(pnlUsdt.toFixed(3)),
        stoppedOut: exit.stoppedOut,
        note: exit.note,
        holdCycles: 1,
      });
    }
  }

  const rotationEvents = trades.length * 2;
  return summarizeTrades(trades, topN, capitalPerSymbol, data.code.includes('1H') ? 'S1' : 'S4', {
    mode: 'full',
    rotationEvents,
    estFeesUsdt: parseFloat((rotationEvents * capitalPerSymbol * FEE_PCT_PER_SIDE / 100).toFixed(2)),
  });
}

/**
 * Rotação de portefólio configurável (incremental + híbridos).
 * @param {object} [hybrid] - rankDrop, maxRank, profitReopenPct
 */
function backtestPortfolioRotation(data, topN, capitalPerSymbol, stopLossPct, hybrid = null) {
  const runs = [...data.runs].reverse();
  const trades = [];
  const holdings = new Map();
  let rotationEvents = 0;
  const mode = hybrid?.name ?? 'incremental';

  const rankAt = (run, symbol) => {
    const idx = run.top.findIndex(r => r.symbol === symbol);
    return idx >= 0 && idx < topN ? idx + 1 : null;
  };

  const priceAt = (run, symbol) => {
    const row = run.top.find(r => r.symbol === symbol);
    return row ? row.close : null;
  };

  function openPosition(symbol, price, scannedAt, rank, entryCycle) {
    holdings.set(symbol, { buyPrice: price, buyAt: scannedAt, rank, entryCycle });
    rotationEvents++;
  }

  function closePosition(symbol, pos, sellAt, sellRunIdx, marketExit, noteOverride) {
    const exit = calcExit(pos.buyPrice, marketExit, stopLossPct);
    if (!exit) return false;
    const pnlUsdt = capitalPerSymbol * (exit.pnlPct / 100);
    trades.push({
      mode,
      scanner: data.code,
      cycle: sellRunIdx,
      buyAt: pos.buyAt,
      sellAt,
      symbol,
      rank: pos.rank,
      buyPrice: pos.buyPrice,
      soldPrice: exit.soldPrice,
      pnlPct: parseFloat(exit.pnlPct.toFixed(3)),
      pnlUsdt: parseFloat(pnlUsdt.toFixed(3)),
      stoppedOut: exit.stoppedOut,
      note: noteOverride || exit.note || 'saiu do top',
      holdCycles: sellRunIdx - pos.entryCycle,
    });
    holdings.delete(symbol);
    rotationEvents++;
    return true;
  }

  function shouldReopen(pos, currentRank, rawPnlPct) {
    if (!hybrid) return false;
    if (hybrid.rankDrop != null && currentRank != null && currentRank - pos.rank >= hybrid.rankDrop) {
      return `rank caiu ${currentRank - pos.rank} (→ #${currentRank})`;
    }
    if (hybrid.maxRank != null && currentRank != null && currentRank > hybrid.maxRank) {
      return `rank #${currentRank} > max #${hybrid.maxRank}`;
    }
    if (hybrid.profitReopenPct != null && rawPnlPct >= hybrid.profitReopenPct) {
      return `P&L +${rawPnlPct.toFixed(1)}% ≥ ${hybrid.profitReopenPct}%`;
    }
    return false;
  }

  const firstRun = runs[0];
  for (const row of firstRun.top.slice(0, topN)) {
    openPosition(row.symbol, row.close, firstRun.scannedAt, row.rank, 0);
  }

  for (let i = 0; i < runs.length - 1; i++) {
    const nextRun = runs[i + 1];
    const newTop = new Set(nextRun.top.slice(0, topN).map(r => r.symbol));

    for (const [symbol, pos] of [...holdings.entries()]) {
      const marketExit = priceAt(nextRun, symbol);
      const currentRank = rankAt(nextRun, symbol);
      const leavesTop = !newTop.has(symbol);

      if (marketExit !== null) {
        const rawPnlPct = ((marketExit - pos.buyPrice) / pos.buyPrice) * 100;
        const slHit = stopLossPct !== null && rawPnlPct < -stopLossPct;
        if (slHit) {
          closePosition(symbol, pos, nextRun.scannedAt, i + 1, marketExit, `SL (mercado ${rawPnlPct.toFixed(2)}%)`);
          continue;
        }
        if (leavesTop) {
          closePosition(symbol, pos, nextRun.scannedAt, i + 1, marketExit, 'saiu do top');
          continue;
        }
        const reopenReason = shouldReopen(pos, currentRank, rawPnlPct);
        if (reopenReason) {
          closePosition(symbol, pos, nextRun.scannedAt, i + 1, marketExit, `reopen: ${reopenReason}`);
          openPosition(symbol, marketExit, nextRun.scannedAt, currentRank, i + 1);
        }
      } else if (leavesTop) {
        closePosition(symbol, pos, nextRun.scannedAt, i + 1, null, 'saiu scanner SL');
      }
    }

    for (const row of nextRun.top.slice(0, topN)) {
      if (!holdings.has(row.symbol)) {
        openPosition(row.symbol, row.close, nextRun.scannedAt, row.rank, i + 1);
      }
    }
  }

  const lastRun = runs[runs.length - 1];
  for (const [symbol, pos] of [...holdings.entries()]) {
    closePosition(symbol, pos, lastRun.scannedAt, runs.length - 1, priceAt(lastRun, symbol), 'fecho final');
  }

  return summarizeTrades(trades, topN, capitalPerSymbol, data.code.includes('1H') ? 'S1' : 'S4', {
    mode,
    hybrid,
    rotationEvents,
    estFeesUsdt: parseFloat((rotationEvents * capitalPerSymbol * FEE_PCT_PER_SIDE / 100).toFixed(2)),
    avgHoldCycles: trades.length
      ? parseFloat((trades.reduce((s, t) => s + t.holdCycles, 0) / trades.length).toFixed(2))
      : 0,
  });
}

function backtestIncremental(data, topN, capitalPerSymbol, stopLossPct) {
  return backtestPortfolioRotation(data, topN, capitalPerSymbol, stopLossPct, null);
}

const backtest = backtestFull;

/** Portefólio combinado: top-N de S1 + top-N de S4 no mesmo ciclo (símbolos duplicados contam 1x) */
function backtestCombined(s1, s4, topN, capitalPerSymbol, stopLossPct) {
  const runs1 = [...s1.runs].reverse();
  const runs4 = [...s4.runs].reverse();
  const trades = [];
  let totalPnl = 0;
  let wins = 0;
  let losses = 0;
  let stopLossHits = 0;

  const cycleCount = Math.min(runs1.length, runs4.length) - 1;

  for (let i = 0; i < cycleCount; i++) {
    const buyRun1 = runs1[i];
    const buyRun4 = runs4[i];
    const sellRun1 = runs1[i + 1];
    const sellRun4 = runs4[i + 1];

    const sellPrices = new Map();
    for (const row of sellRun1.top) sellPrices.set(row.symbol, row.close);
    for (const row of sellRun4.top) {
      if (!sellPrices.has(row.symbol)) sellPrices.set(row.symbol, row.close);
    }

    const picks = [];
    for (const b of buyRun1.top.slice(0, topN)) {
      picks.push({ ...b, from: 'S1' });
    }
    for (const b of buyRun4.top.slice(0, topN)) {
      if (!picks.some(p => p.symbol === b.symbol)) {
        picks.push({ ...b, from: 'S4' });
      }
    }

    for (const bought of picks) {
      const buyPrice = bought.close;
      const marketExit = sellPrices.get(bought.symbol) ?? null;
      let soldPrice, pnlPct, stoppedOut = false, note = '';

      if (marketExit === null) {
        pnlPct = -stopLossPct;
        soldPrice = buyPrice * (1 - stopLossPct / 100);
        stoppedOut = true;
        note = 'saiu scanner SL';
      } else {
        const rawPnlPct = ((marketExit - buyPrice) / buyPrice) * 100;
        if (rawPnlPct < -stopLossPct) {
          pnlPct = -stopLossPct;
          soldPrice = buyPrice * (1 - stopLossPct / 100);
          stoppedOut = true;
          note = `SL (mercado ${rawPnlPct.toFixed(2)}%)`;
        } else {
          pnlPct = rawPnlPct;
          soldPrice = marketExit;
        }
      }

      const pnlUsdt = capitalPerSymbol * (pnlPct / 100);
      totalPnl += pnlUsdt;
      if (pnlPct > 0) wins++;
      else losses++;
      if (stoppedOut) stopLossHits++;

      trades.push({
        scanner: bought.from,
        cycle: i + 1,
        buyAt: bought.from === 'S1' ? buyRun1.scannedAt : buyRun4.scannedAt,
        symbol: bought.symbol,
        rank: bought.rank,
        pnlPct: parseFloat(pnlPct.toFixed(3)),
        pnlUsdt: parseFloat(pnlUsdt.toFixed(3)),
        stoppedOut,
        note,
      });
    }
  }

  const byCycle = {};
  for (const t of trades) {
    if (!byCycle[t.cycle]) {
      byCycle[t.cycle] = { cycle: t.cycle, buyAt: t.buyAt, totalPnl: 0, stops: 0, count: 0 };
    }
    byCycle[t.cycle].totalPnl += t.pnlUsdt;
    byCycle[t.cycle].count++;
    if (t.stoppedOut) byCycle[t.cycle].stops++;
  }

  const avgPositions = trades.length / cycleCount;
  const initialCapital = topN * 2 * capitalPerSymbol; // referência: 2×topN se sem overlap

  return {
    label: `S1+S4 top${topN}`,
    topN,
    initialCapitalRef: initialCapital,
    avgPositionsPerCycle: parseFloat(avgPositions.toFixed(1)),
    finalCapital: parseFloat((initialCapital + totalPnl).toFixed(2)),
    totalPnlUsdt: parseFloat(totalPnl.toFixed(2)),
    totalPnlPctOnRef: parseFloat(((totalPnl / initialCapital) * 100).toFixed(2)),
    totalTrades: trades.length,
    wins,
    losses,
    winRate: parseFloat((wins / trades.length * 100).toFixed(1)),
    stopLossHits,
    cycles: Object.values(byCycle).sort((a, b) => a.cycle - b.cycle),
    trades,
  };
}

// --- Run all scenarios ---
const TOP_RANGE = [5, 6, 7, 8, 9, 10];
const scenarios = [];
for (const topN of TOP_RANGE) {
  scenarios.push(backtest(s1data, topN, CAPITAL_PER_SYMBOL, STOP_LOSS_PCT));
  scenarios.push(backtest(s4data, topN, CAPITAL_PER_SYMBOL, STOP_LOSS_PCT));
}
const combined = TOP_RANGE.map(n => backtestCombined(s1data, s4data, n, CAPITAL_PER_SYMBOL, STOP_LOSS_PCT));

console.log('='.repeat(80));
console.log('BACKTEST — SL -5% · 100 USDT/trade · 2026-06-03 a 2026-06-09');
console.log('='.repeat(80));

console.log('\n--- TABELA COMPARATIVA (Top 5 a 10) ---');
console.log('Scanner | Top | Capital | Final    | P&L USDT  | P&L %   | WR    | Stops | Trades');
console.log('--------|-----|---------|----------|-----------|---------|-------|-------|-------');
for (const s of scenarios) {
  console.log(
    `${s.label.padEnd(7)} | ${String(s.topN).padStart(3)} | ${String(s.initialCapital).padStart(7)} | ${String(s.finalCapital).padStart(8)} | ${(s.totalPnlUsdt >= 0 ? '+' : '') + s.totalPnlUsdt.toString().padStart(8)} | ${(s.totalPnlPct >= 0 ? '+' : '') + s.totalPnlPct + '%'.padStart(4)} | ${String(s.winRate + '%').padStart(5)} | ${String(s.stopLossHits).padStart(5)} | ${String(s.totalTrades).padStart(5)}`
  );
}

const bestS1 = scenarios.filter(s => s.label === 'S1').sort((a, b) => b.totalPnlPct - a.totalPnlPct)[0];
const bestS4 = scenarios.filter(s => s.label === 'S4').sort((a, b) => b.totalPnlPct - a.totalPnlPct)[0];
const bestS1abs = scenarios.filter(s => s.label === 'S1').sort((a, b) => b.totalPnlUsdt - a.totalPnlUsdt)[0];
const bestS4abs = scenarios.filter(s => s.label === 'S4').sort((a, b) => b.totalPnlUsdt - a.totalPnlUsdt)[0];

console.log('\n--- MELHOR CONFIG POR SCANNER ---');
console.log(`  S1 melhor %:  top ${bestS1.topN} → +${bestS1.totalPnlPct}% (${bestS1.totalPnlUsdt} USDT)`);
console.log(`  S1 melhor USDT: top ${bestS1abs.topN} → +${bestS1abs.totalPnlUsdt} USDT (+${bestS1abs.totalPnlPct}%)`);
console.log(`  S4 melhor %:  top ${bestS4.topN} → +${bestS4.totalPnlPct}% (${bestS4.totalPnlUsdt} USDT)`);
console.log(`  S4 melhor USDT: top ${bestS4abs.topN} → +${bestS4abs.totalPnlUsdt} USDT (+${bestS4abs.totalPnlPct}%)`);

console.log('\n--- PORTEFÓLIO COMBINADO S1 + S4 (sem duplicar símbolos) ---');
console.log('Config          | Pos/ciclo | Capital ref | P&L USDT  | P&L % ref | WR    | Stops | Trades');
console.log('----------------|-----------|-------------|-----------|-----------|-------|-------|-------');
for (const c of combined) {
  console.log(
    `${c.label.padEnd(15)} | ${String(c.avgPositionsPerCycle).padStart(9)} | ${String(c.initialCapitalRef).padStart(11)} | ${(c.totalPnlUsdt >= 0 ? '+' : '') + c.totalPnlUsdt.toString().padStart(8)} | ${(c.totalPnlPctOnRef >= 0 ? '+' : '') + c.totalPnlPctOnRef + '%'.padStart(6)} | ${String(c.winRate + '%').padStart(5)} | ${String(c.stopLossHits).padStart(5)} | ${String(c.totalTrades).padStart(5)}`
  );
}

// P&L por rank (S1 top 10) — qual rank contribui mais
const rankPnl = {};
const s1_10 = scenarios.find(s => s.label === 'S1' && s.topN === 10);
for (const t of s1_10.trades) {
  if (!rankPnl[t.rank]) rankPnl[t.rank] = { n: 0, p: 0, st: 0 };
  rankPnl[t.rank].n++;
  rankPnl[t.rank].p += t.pnlUsdt;
  if (t.stoppedOut) rankPnl[t.rank].st++;
}
console.log('\n--- S1 TOP 10 — P&L por rank ---');
for (let r = 1; r <= 10; r++) {
  const x = rankPnl[r];
  if (!x) continue;
  const avg = (x.p / x.n).toFixed(2);
  console.log(`  Rank ${String(r).padStart(2)}: ${x.n} trades, ${x.st} SL, total ${x.p >= 0 ? '+' : ''}${x.p.toFixed(2)} USDT, média ${avg}/trade`);
}

const rankPnl4 = {};
const s4_10 = scenarios.find(s => s.label === 'S4' && s.topN === 10);
for (const t of s4_10.trades) {
  if (!rankPnl4[t.rank]) rankPnl4[t.rank] = { n: 0, p: 0, st: 0 };
  rankPnl4[t.rank].n++;
  rankPnl4[t.rank].p += t.pnlUsdt;
  if (t.stoppedOut) rankPnl4[t.rank].st++;
}
console.log('\n--- S4 TOP 10 — P&L por rank ---');
for (let r = 1; r <= 10; r++) {
  const x = rankPnl4[r];
  if (!x) continue;
  const avg = (x.p / x.n).toFixed(2);
  console.log(`  Rank ${String(r).padStart(2)}: ${x.n} trades, ${x.st} SL, total ${x.p >= 0 ? '+' : ''}${x.p.toFixed(2)} USDT, média ${avg}/trade`);
}

// --- COMPARATIVO: rotação total vs incremental (S1) ---
console.log('\n' + '='.repeat(80));
console.log('S1 — ROTAÇÃO TOTAL vs INCREMENTAL (SL -5%, 100 USDT/trade)');
console.log('='.repeat(80));
console.log('Top | Modo        | P&L USDT  | P&L %   | Trades | Rotações | Fees est. | P&L líq. est.');
console.log('----|-------------|-----------|---------|--------|----------|-----------|-------------');

const incrCompare = [];
for (const topN of TOP_RANGE) {
  const full = backtestFull(s1data, topN, CAPITAL_PER_SYMBOL, STOP_LOSS_PCT);
  const incr = backtestIncremental(s1data, topN, CAPITAL_PER_SYMBOL, STOP_LOSS_PCT);
  incrCompare.push({ topN, full, incr });

  const fullNet = full.totalPnlUsdt - full.estFeesUsdt;
  const incrNet = incr.totalPnlUsdt - incr.estFeesUsdt;
  const savedFees = full.estFeesUsdt - incr.estFeesUsdt;
  const savedRot = full.rotationEvents - incr.rotationEvents;

  console.log(
    `${String(topN).padStart(3)} | total       | ${(full.totalPnlUsdt >= 0 ? '+' : '') + full.totalPnlUsdt.toString().padStart(8)} | ${(full.totalPnlPct >= 0 ? '+' : '') + full.totalPnlPct + '%'.padStart(5)} | ${String(full.totalTrades).padStart(6)} | ${String(full.rotationEvents).padStart(8)} | ${String(full.estFeesUsdt).padStart(9)} | ${(fullNet >= 0 ? '+' : '') + fullNet.toFixed(2).padStart(10)}`
  );
  console.log(
    `${String(topN).padStart(3)} | incremental | ${(incr.totalPnlUsdt >= 0 ? '+' : '') + incr.totalPnlUsdt.toString().padStart(8)} | ${(incr.totalPnlPct >= 0 ? '+' : '') + incr.totalPnlPct + '%'.padStart(5)} | ${String(incr.totalTrades).padStart(6)} | ${String(incr.rotationEvents).padStart(8)} | ${String(incr.estFeesUsdt).padStart(9)} | ${(incrNet >= 0 ? '+' : '') + incrNet.toFixed(2).padStart(10)}`
  );
  console.log(
    `    | Δ incr vs total | ${(incr.totalPnlUsdt - full.totalPnlUsdt >= 0 ? '+' : '') + (incr.totalPnlUsdt - full.totalPnlUsdt).toFixed(2).padStart(7)} USDT | fees -${savedFees.toFixed(2)} | rotações -${savedRot} | hold médio ${incr.avgHoldCycles}c`
  );
  console.log('----|-------------|-----------|---------|--------|----------|-----------|-------------');
}

const s1_8_full = incrCompare.find(x => x.topN === 8).full;
const s1_8_incr = incrCompare.find(x => x.topN === 8).incr;
console.log('\n--- S1 TOP 8 — RESUMO (estratégia live) ---');
console.log(`  Total:       +${s1_8_full.totalPnlUsdt} USDT (+${s1_8_full.totalPnlPct}%) | ${s1_8_full.rotationEvents} rotações | fees ~${s1_8_full.estFeesUsdt} USDT`);
console.log(`  Incremental: +${s1_8_incr.totalPnlUsdt} USDT (+${s1_8_incr.totalPnlPct}%) | ${s1_8_incr.rotationEvents} rotações | fees ~${s1_8_incr.estFeesUsdt} USDT`);
console.log(`  P&L líquido est.: total ${(s1_8_full.totalPnlUsdt - s1_8_full.estFeesUsdt).toFixed(2)} vs incr ${(s1_8_incr.totalPnlUsdt - s1_8_incr.estFeesUsdt).toFixed(2)} USDT`);
console.log(`  Hold médio incremental: ${s1_8_incr.avgHoldCycles} ciclos (~${(s1_8_incr.avgHoldCycles * 4).toFixed(0)}h)`);

// --- HÍBRIDOS S1 TOP 8 ---
const TOP8 = 8;
const HYBRID_CONFIGS = [
  { name: 'rank↓3', rankDrop: 3 },
  { name: 'rank↓2', rankDrop: 2 },
  { name: 'max rank 4', maxRank: 4 },
  { name: 'max rank 5', maxRank: 5 },
  { name: 'P&L +10%', profitReopenPct: 10 },
  { name: 'P&L +15%', profitReopenPct: 15 },
  { name: 'P&L +20%', profitReopenPct: 20 },
  { name: 'P&L +25%', profitReopenPct: 25 },
  { name: 'P&L +30%', profitReopenPct: 30 },
  { name: 'rank↓3 + P&L+15%', rankDrop: 3, profitReopenPct: 15 },
  { name: 'rank↓3 + P&L+20%', rankDrop: 3, profitReopenPct: 20 },
  { name: 'max4 + P&L+15%', maxRank: 4, profitReopenPct: 15 },
  { name: 'max4 + P&L+20%', maxRank: 4, profitReopenPct: 20 },
  { name: 'rank↓2 + P&L+15%', rankDrop: 2, profitReopenPct: 15 },
];

console.log('\n' + '='.repeat(95));
console.log('S1 TOP 8 — HÍBRIDOS (incremental + reopen por rank ou P&L)');
console.log('='.repeat(95));

const hybridResults = HYBRID_CONFIGS.map(cfg => ({
  cfg,
  result: backtestPortfolioRotation(s1data, TOP8, CAPITAL_PER_SYMBOL, STOP_LOSS_PCT, cfg),
}));

hybridResults.sort((a, b) =>
  (b.result.totalPnlUsdt - b.result.estFeesUsdt) - (a.result.totalPnlUsdt - a.result.estFeesUsdt)
);

console.log('Config              | P&L USDT  | P&L %   | Trades | Rotações | Fees est. | P&L líq. | Hold médio');
console.log('--------------------|-----------|---------|--------|----------|-----------|----------|----------');
console.log(
  `${'TOTAL (full)'.padEnd(19)} | ${('+' + s1_8_full.totalPnlUsdt).padStart(8)} | ${('+' + s1_8_full.totalPnlPct + '%').padStart(7)} | ${String(s1_8_full.totalTrades).padStart(6)} | ${String(s1_8_full.rotationEvents).padStart(8)} | ${String(s1_8_full.estFeesUsdt).padStart(9)} | ${(s1_8_full.totalPnlUsdt - s1_8_full.estFeesUsdt).toFixed(2).padStart(8)} | ${'1.0'.padStart(8)}`
);
console.log(
  `${'INCREMENTAL'.padEnd(19)} | ${('+' + s1_8_incr.totalPnlUsdt).padStart(8)} | ${('+' + s1_8_incr.totalPnlPct + '%').padStart(7)} | ${String(s1_8_incr.totalTrades).padStart(6)} | ${String(s1_8_incr.rotationEvents).padStart(8)} | ${String(s1_8_incr.estFeesUsdt).padStart(9)} | ${(s1_8_incr.totalPnlUsdt - s1_8_incr.estFeesUsdt).toFixed(2).padStart(8)} | ${String(s1_8_incr.avgHoldCycles).padStart(8)}`
);
for (const { cfg, result: r } of hybridResults) {
  const net = r.totalPnlUsdt - r.estFeesUsdt;
  const fullNet = s1_8_full.totalPnlUsdt - s1_8_full.estFeesUsdt;
  const incrNet = s1_8_incr.totalPnlUsdt - s1_8_incr.estFeesUsdt;
  const marker = net >= fullNet ? ' ★' : net >= incrNet ? ' ◆' : '';
  console.log(
    `${cfg.name.padEnd(19)} | ${(r.totalPnlUsdt >= 0 ? '+' : '') + r.totalPnlUsdt.toString().padStart(8)} | ${(r.totalPnlPct >= 0 ? '+' : '') + r.totalPnlPct + '%'.padStart(6)} | ${String(r.totalTrades).padStart(6)} | ${String(r.rotationEvents).padStart(8)} | ${String(r.estFeesUsdt).padStart(9)} | ${net.toFixed(2).padStart(8)} | ${String(r.avgHoldCycles).padStart(8)}${marker}`
  );
}

const bestHybrid = hybridResults[0];
const bestNet = bestHybrid.result.totalPnlUsdt - bestHybrid.result.estFeesUsdt;
const fullNet8 = s1_8_full.totalPnlUsdt - s1_8_full.estFeesUsdt;
const incrNet8 = s1_8_incr.totalPnlUsdt - s1_8_incr.estFeesUsdt;

console.log('\n--- MELHOR HÍBRIDO TOP 8 ---');
console.log(`  Config: ${bestHybrid.cfg.name}`);
console.log(`  P&L bruto: +${bestHybrid.result.totalPnlUsdt} USDT (+${bestHybrid.result.totalPnlPct}%)`);
console.log(`  P&L líquido est.: ${bestNet.toFixed(2)} USDT (vs full ${fullNet8.toFixed(2)}, vs incr ${incrNet8.toFixed(2)})`);
console.log(`  Rotações: ${bestHybrid.result.rotationEvents} (full ${s1_8_full.rotationEvents}, incr ${s1_8_incr.rotationEvents})`);
console.log(`  ★ = bate full | ◆ = bate incremental (líquido)`);

// CSV summary
const summaryRows = ['scanner,topN,capital,final,pnlUsdt,pnlPct,winRate,stops,trades'];
for (const s of scenarios) {
  summaryRows.push([s.label, s.topN, s.initialCapital, s.finalCapital, s.totalPnlUsdt, s.totalPnlPct, s.winRate, s.stopLossHits, s.totalTrades].join(','));
}
writeFileSync('./scripts/backtest_sl5_summary_top5-10.csv', summaryRows.join('\n'), 'utf8');

const csvHeader = 'scanner,cycle,buyAt,symbol,rank,pnlPct,pnlUsdt,stoppedOut,note';
writeFileSync('./scripts/backtest_sl5_top10_s1.csv', [csvHeader, ...s1_10.trades.map(t =>
  ['S1', t.cycle, t.buyAt, t.symbol, t.rank, t.pnlPct, t.pnlUsdt, t.stoppedOut, `"${t.note}"`].join(',')
)].join('\n'), 'utf8');
writeFileSync('./scripts/backtest_sl5_top10_s4.csv', [csvHeader, ...s4_10.trades.map(t =>
  ['S4', t.cycle, t.buyAt, t.symbol, t.rank, t.pnlPct, t.pnlUsdt, t.stoppedOut, `"${t.note}"`].join(',')
)].join('\n'), 'utf8');

const incrSummaryRows = ['topN,mode,pnlUsdt,pnlPct,trades,rotationEvents,estFeesUsdt,pnlNetEst,avgHoldCycles'];
for (const { topN, full, incr } of incrCompare) {
  incrSummaryRows.push([topN, 'full', full.totalPnlUsdt, full.totalPnlPct, full.totalTrades, full.rotationEvents, full.estFeesUsdt, (full.totalPnlUsdt - full.estFeesUsdt).toFixed(2), 1].join(','));
  incrSummaryRows.push([topN, 'incremental', incr.totalPnlUsdt, incr.totalPnlPct, incr.totalTrades, incr.rotationEvents, incr.estFeesUsdt, (incr.totalPnlUsdt - incr.estFeesUsdt).toFixed(2), incr.avgHoldCycles].join(','));
}
writeFileSync('./scripts/backtest_s1_rotation_compare.csv', incrSummaryRows.join('\n'), 'utf8');

writeFileSync('./scripts/backtest_s1_top8_incremental.csv', [csvHeader + ',holdCycles,mode', ...s1_8_incr.trades.map(t =>
  ['S1', t.cycle, t.buyAt, t.symbol, t.rank, t.pnlPct, t.pnlUsdt, t.stoppedOut, `"${t.note}"`, t.holdCycles, t.mode].join(',')
)].join('\n'), 'utf8');

const hybridCsvRows = ['config,pnlUsdt,pnlPct,trades,rotationEvents,estFeesUsdt,pnlNetEst,avgHoldCycles'];
hybridCsvRows.push(['full', s1_8_full.totalPnlUsdt, s1_8_full.totalPnlPct, s1_8_full.totalTrades, s1_8_full.rotationEvents, s1_8_full.estFeesUsdt, fullNet8.toFixed(2), 1].join(','));
hybridCsvRows.push(['incremental', s1_8_incr.totalPnlUsdt, s1_8_incr.totalPnlPct, s1_8_incr.totalTrades, s1_8_incr.rotationEvents, s1_8_incr.estFeesUsdt, incrNet8.toFixed(2), s1_8_incr.avgHoldCycles].join(','));
for (const { cfg, result: r } of hybridResults) {
  hybridCsvRows.push([cfg.name, r.totalPnlUsdt, r.totalPnlPct, r.totalTrades, r.rotationEvents, r.estFeesUsdt, (r.totalPnlUsdt - r.estFeesUsdt).toFixed(2), r.avgHoldCycles].join(','));
}
writeFileSync('./scripts/backtest_s1_top8_hybrid.csv', hybridCsvRows.join('\n'), 'utf8');

console.log('\nCSV: backtest_s1_top8_hybrid.csv, backtest_s1_rotation_compare.csv, backtest_s1_top8_incremental.csv');
