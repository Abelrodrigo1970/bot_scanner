import { readFileSync } from 'fs';

const stripBom = s => s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
const s1data = JSON.parse(stripBom(readFileSync('./scripts/s1_hist_full.json', 'utf8')));
const s4data = JSON.parse(stripBom(readFileSync('./scripts/s4_hist_full.json', 'utf8')));

const STOP_LOSS_PCT = 5; // -5%
const TOP_N = parseInt(process.argv[2] ?? '5', 10);
const CAPITAL_PER_SYMBOL = 100;

/**
 * Backtest com stop-loss opcional.
 * Com SL: se o preço de saída implicar perda > 5%, assume saída a -5%.
 * Símbolos que saem do scanner sem preço: assume SL -5% (não há preço de fecho).
 */
function backtest(data, topN = 5, capitalPerSymbol = 100, stopLossPct = null) {
  const runs = [...data.runs].reverse();
  const trades = [];
  let totalPnl = 0;
  let totalTrades = 0;
  let wins = 0;
  let losses = 0;
  let stopLossHits = 0;

  for (let i = 0; i < runs.length - 1; i++) {
    const buyRun = runs[i];
    const sellRun = runs[i + 1];
    const sellPrices = new Map();
    for (const row of sellRun.top) sellPrices.set(row.symbol, row.close);

    for (const bought of buyRun.top.slice(0, topN)) {
      const buyPrice = bought.close;
      const marketExit = sellPrices.get(bought.symbol) ?? null;

      let soldPrice = marketExit;
      let pnlPct;
      let stoppedOut = false;
      let note = '';

      if (marketExit === null) {
        if (stopLossPct !== null) {
          pnlPct = -stopLossPct;
          soldPrice = buyPrice * (1 - stopLossPct / 100);
          stoppedOut = true;
          note = 'saiu do scanner (SL -5%)';
        } else {
          trades.push({
            cycle: i + 1,
            buyRunAt: buyRun.scannedAt,
            sellRunAt: sellRun.scannedAt,
            symbol: bought.symbol,
            rank: bought.rank,
            buyPrice,
            soldPrice: null,
            marketExit: null,
            pnlPct: null,
            pnlUsdt: null,
            stoppedOut: false,
            note: 'saiu do scanner — sem preço',
          });
          continue;
        }
      } else {
        const rawPnlPct = ((marketExit - buyPrice) / buyPrice) * 100;
        if (stopLossPct !== null && rawPnlPct < -stopLossPct) {
          pnlPct = -stopLossPct;
          soldPrice = buyPrice * (1 - stopLossPct / 100);
          stoppedOut = true;
          note = `SL -${stopLossPct}% (mercado seria ${rawPnlPct.toFixed(2)}%)`;
        } else {
          pnlPct = rawPnlPct;
        }
      }

      const pnlUsdt = capitalPerSymbol * (pnlPct / 100);
      totalPnl += pnlUsdt;
      totalTrades++;
      if (pnlPct > 0) wins++;
      else losses++;
      if (stoppedOut) stopLossHits++;

      trades.push({
        cycle: i + 1,
        buyRunAt: buyRun.scannedAt,
        sellRunAt: sellRun.scannedAt,
        symbol: bought.symbol,
        rank: bought.rank,
        buyPrice,
        soldPrice: parseFloat(soldPrice.toFixed(8)),
        marketExit: marketExit,
        pnlPct: parseFloat(pnlPct.toFixed(3)),
        pnlUsdt: parseFloat(pnlUsdt.toFixed(3)),
        stoppedOut,
        note,
      });
    }
  }

  const byCycle = {};
  for (const t of trades.filter(t => t.pnlUsdt !== null)) {
    if (!byCycle[t.cycle]) {
      byCycle[t.cycle] = { cycle: t.cycle, buyAt: t.buyRunAt, sellAt: t.sellRunAt, totalPnl: 0, stops: 0 };
    }
    byCycle[t.cycle].totalPnl += t.pnlUsdt;
    if (t.stoppedOut) byCycle[t.cycle].stops++;
  }

  const bySymbol = {};
  for (const t of trades.filter(t => t.pnlUsdt !== null)) {
    if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { trades: 0, wins: 0, stops: 0, totalPnlUsdt: 0 };
    bySymbol[t.symbol].trades++;
    bySymbol[t.symbol].totalPnlUsdt += t.pnlUsdt;
    if (t.pnlPct > 0) bySymbol[t.symbol].wins++;
    if (t.stoppedOut) bySymbol[t.symbol].stops++;
  }

  const initialCapital = topN * capitalPerSymbol;
  let capital = initialCapital;
  for (const c of Object.values(byCycle).sort((a, b) => a.cycle - b.cycle)) {
    capital += c.totalPnl;
  }

  return {
    scanner: data.code,
    stopLossPct,
    initialCapital,
    finalCapital: parseFloat(capital.toFixed(2)),
    totalPnlUsdt: parseFloat(totalPnl.toFixed(2)),
    totalPnlPct: parseFloat(((capital - initialCapital) / initialCapital * 100).toFixed(2)),
    totalCycles: runs.length - 1,
    totalTrades,
    wins,
    losses,
    winRate: totalTrades > 0 ? parseFloat((wins / totalTrades * 100).toFixed(1)) : 0,
    stopLossHits,
    cycleResults: Object.values(byCycle).sort((a, b) => a.cycle - b.cycle),
    bySymbol: Object.entries(bySymbol)
      .map(([symbol, v]) => ({ symbol, ...v, totalPnlUsdt: parseFloat(v.totalPnlUsdt.toFixed(2)) }))
      .sort((a, b) => b.totalPnlUsdt - a.totalPnlUsdt),
    trades,
  };
}

function printComparison(label, base, sl) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(label);
  console.log('='.repeat(70));
  console.log('                        | Sem SL      | Com SL -5%');
  console.log('------------------------|-------------|-------------');
  console.log(`Capital final           | ${String(base.finalCapital).padStart(8)} USDT | ${String(sl.finalCapital).padStart(8)} USDT`);
  console.log(`P&L total               | ${(base.totalPnlUsdt >= 0 ? '+' : '') + base.totalPnlUsdt.toString().padStart(7)} USDT | ${(sl.totalPnlUsdt >= 0 ? '+' : '') + sl.totalPnlUsdt.toString().padStart(7)} USDT`);
  console.log(`P&L %                   | ${(base.totalPnlPct >= 0 ? '+' : '') + base.totalPnlPct}%`.padEnd(25) + `| ${(sl.totalPnlPct >= 0 ? '+' : '') + sl.totalPnlPct}%`);
  console.log(`Win rate                | ${base.winRate}%`.padEnd(25) + `| ${sl.winRate}%`);
  console.log(`Stops activados         | —`.padEnd(25) + `| ${sl.stopLossHits}`);
}

function printCycles(sl, scannerLabel) {
  console.log(`\n--- ${scannerLabel} — Ciclos com SL -5% ---`);
  for (const c of sl.cycleResults) {
    const date = c.buyAt.slice(0, 16).replace('T', ' ');
    const sign = c.totalPnl >= 0 ? '+' : '';
    const stops = c.stops > 0 ? ` (${c.stops} SL)` : '';
    console.log(`  Ciclo ${String(c.cycle).padStart(2)}: ${date} | ${sign}${c.totalPnl.toFixed(2)} USDT${stops}`);
  }
}

function printStops(sl, scannerLabel) {
  const stopped = sl.trades.filter(t => t.stoppedOut);
  console.log(`\n--- ${scannerLabel} — Trades com SL activado (${stopped.length}) ---`);
  for (const t of stopped) {
    const date = t.buyRunAt.slice(0, 16).replace('T', ' ');
    console.log(`  Ciclo ${t.cycle} ${date} | ${t.symbol.padEnd(16)} | ${t.note}`);
  }
}

// Sem SL (mesmo topN para comparação justa)
const s1base = backtest(s1data, TOP_N, CAPITAL_PER_SYMBOL, null);
const s4base = backtest(s4data, TOP_N, CAPITAL_PER_SYMBOL, null);

// Com SL 5%
const s1sl = backtest(s1data, TOP_N, CAPITAL_PER_SYMBOL, STOP_LOSS_PCT);
const s4sl = backtest(s4data, TOP_N, CAPITAL_PER_SYMBOL, STOP_LOSS_PCT);

console.log(`\nConfig: top ${TOP_N} símbolos · ${CAPITAL_PER_SYMBOL} USDT/trade · SL -${STOP_LOSS_PCT}%`);
console.log(`Capital por ciclo: ${TOP_N * CAPITAL_PER_SYMBOL} USDT`);

printComparison('SCANNER 1 — Comparação', s1base, s1sl);
printCycles(s1sl, 'S1');
printStops(s1sl, 'S1');

printComparison('SCANNER 4 — Comparação', s4base, s4sl);
printCycles(s4sl, 'S4');
printStops(s4sl, 'S4');

console.log('\n--- Top símbolos S1 (SL -5%) ---');
s1sl.bySymbol.slice(0, 8).forEach(s => {
  console.log(`  ${s.symbol}: ${s.trades} trades, ${s.stops} SL, P&L ${s.totalPnlUsdt >= 0 ? '+' : ''}${s.totalPnlUsdt} USDT`);
});

console.log('\n--- Top símbolos S4 (SL -5%) ---');
s4sl.bySymbol.slice(0, 8).forEach(s => {
  console.log(`  ${s.symbol}: ${s.trades} trades, ${s.stops} SL, P&L ${s.totalPnlUsdt >= 0 ? '+' : ''}${s.totalPnlUsdt} USDT`);
});

// CSV export
import { writeFileSync } from 'fs';
const csvRows = ['scanner,cycle,buyAt,symbol,rank,buyPrice,soldPrice,marketExit,pnlPct,pnlUsdt,stoppedOut,note'];
for (const t of [...s1sl.trades, ...s4sl.trades]) {
  csvRows.push([
    t.buyRunAt.includes('1H') ? '' : '',
    t.cycle, t.buyRunAt, t.symbol, t.rank, t.buyPrice,
    t.soldPrice, t.marketExit ?? '', t.pnlPct, t.pnlUsdt, t.stoppedOut, `"${t.note}"`,
  ].join(',').replace(/^,/, ''));
}
// Fix scanner column
const allTrades = [
  ...s1sl.trades.map(t => ({ ...t, scanner: 'S1' })),
  ...s4sl.trades.map(t => ({ ...t, scanner: 'S4' })),
];
const header = 'scanner,cycle,buyAt,symbol,rank,buyPrice,soldPrice,marketExit,pnlPct,pnlUsdt,stoppedOut,note';
const rows = allTrades.map(t =>
  [t.scanner, t.cycle, t.buyRunAt, t.symbol, t.rank, t.buyPrice, t.soldPrice, t.marketExit ?? '', t.pnlPct, t.pnlUsdt, t.stoppedOut, t.note]
    .map(v => typeof v === 'string' && v.includes(',') ? `"${v}"` : v)
    .join(',')
);
const csvName = `./scripts/backtest_sl5_top${TOP_N}.csv`;
writeFileSync(csvName, [header, ...rows].join('\n'), 'utf8');
console.log(`\nCSV exportado: ${csvName} (${allTrades.length} trades)`);
