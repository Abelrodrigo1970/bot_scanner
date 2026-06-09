import { readFileSync } from 'fs';

const stripBom = s => s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
const s1data = JSON.parse(stripBom(readFileSync('./scripts/s1_hist_full.json', 'utf8')));
const s4data = JSON.parse(stripBom(readFileSync('./scripts/s4_hist_full.json', 'utf8')));

function backtest(data, topN = 5, capitalPerSymbol = 100) {
  const runs = [...data.runs].reverse();
  const trades = [];
  let totalPnl = 0;
  let totalTrades = 0;
  let wins = 0;
  let losses = 0;

  for (let i = 0; i < runs.length - 1; i++) {
    const buyRun = runs[i];
    const sellRun = runs[i + 1];
    const sellPrices = new Map();
    for (const row of sellRun.top) sellPrices.set(row.symbol, row.close);
    const buyTop5 = buyRun.top.slice(0, topN);

    for (const bought of buyTop5) {
      const buyPrice = bought.close;
      const soldPrice = sellPrices.get(bought.symbol) ?? null;
      if (soldPrice === null) {
        trades.push({
          cycle: i + 1,
          buyAt: buyRun.scannedAt,
          sellAt: sellRun.scannedAt,
          symbol: bought.symbol,
          rank: bought.rank,
          buyPrice,
          soldPrice: null,
          pnlPct: null,
          pnlUsdt: null,
          note: 'saiu do scanner',
        });
        continue;
      }
      const pnlPct = ((soldPrice - buyPrice) / buyPrice) * 100;
      const pnlUsdt = capitalPerSymbol * (pnlPct / 100);
      totalPnl += pnlUsdt;
      totalTrades++;
      if (pnlPct > 0) wins++; else losses++;
      trades.push({
        cycle: i + 1,
        buyAt: buyRun.scannedAt,
        sellAt: sellRun.scannedAt,
        symbol: bought.symbol,
        rank: bought.rank,
        buyPrice,
        soldPrice,
        pnlPct: parseFloat(pnlPct.toFixed(3)),
        pnlUsdt: parseFloat(pnlUsdt.toFixed(3)),
        note: '',
      });
    }
  }

  const byCycle = {};
  for (const t of trades) {
    if (!byCycle[t.cycle]) {
      byCycle[t.cycle] = { cycle: t.cycle, buyAt: t.buyAt, sellAt: t.sellAt, totalPnl: 0, trades: [] };
    }
    byCycle[t.cycle].trades.push(t);
    if (t.pnlUsdt !== null) byCycle[t.cycle].totalPnl += t.pnlUsdt;
  }

  return {
    scanner: data.code,
    topN,
    capitalPerSymbol,
    initialCapital: topN * capitalPerSymbol,
    finalCapital: parseFloat((topN * capitalPerSymbol + totalPnl).toFixed(2)),
    totalPnlUsdt: parseFloat(totalPnl.toFixed(2)),
    totalCycles: runs.length - 1,
    totalTrades,
    wins,
    losses,
    trades,
    cycles: Object.values(byCycle).sort((a, b) => a.cycle - b.cycle),
  };
}

function printFull(result, label) {
  console.log(`\n${'='.repeat(90)}`);
  console.log(`${label}`);
  console.log(`${'='.repeat(90)}`);
  console.log(`Capital inicial: ${result.initialCapital} USDT | Final: ${result.finalCapital} USDT | P&L: ${result.totalPnlUsdt >= 0 ? '+' : ''}${result.totalPnlUsdt} USDT`);
  console.log(`Ciclos: ${result.totalCycles} | Trades: ${result.totalTrades} | Wins: ${result.wins} | Losses: ${result.losses}`);
  console.log('');

  for (const c of result.cycles) {
    const buyDate = c.buyAt.slice(0, 16).replace('T', ' ');
    const sellDate = c.sellAt.slice(0, 16).replace('T', ' ');
    const sign = c.totalPnl >= 0 ? '+' : '';
    console.log(`--- CICLO ${c.cycle} | Compra: ${buyDate} | Venda: ${sellDate} | P&L ciclo: ${sign}${c.totalPnl.toFixed(2)} USDT ---`);
    console.log('Rank | Símbolo          | Compra      | Venda       | P&L %     | P&L USDT  | Nota');
    console.log('-----|------------------|-------------|-------------|-----------|-----------|------');
    for (const t of c.trades) {
      const sym = t.symbol.padEnd(16);
      const buy = t.buyPrice.toString().padStart(11);
      const sell = t.soldPrice !== null ? t.soldPrice.toString().padStart(11) : 'N/A'.padStart(11);
      const pct = t.pnlPct !== null ? ((t.pnlPct >= 0 ? '+' : '') + t.pnlPct.toFixed(2) + '%').padStart(9) : 'N/A'.padStart(9);
      const usdt = t.pnlUsdt !== null ? ((t.pnlUsdt >= 0 ? '+' : '') + t.pnlUsdt.toFixed(2)).padStart(9) : 'N/A'.padStart(9);
      console.log(`  ${String(t.rank).padStart(2)} | ${sym} | ${buy} | ${sell} | ${pct} | ${usdt} | ${t.note}`);
    }
    console.log('');
  }
}

const s1 = backtest(s1data, 5, 100);
const s4 = backtest(s4data, 5, 100);

printFull(s1, 'SCANNER 1 — UNIVERSE_ABOVE_MA200_1H (top 5, 100 USDT/trade)');
printFull(s4, 'SCANNER 4 — UNIVERSE_ABOVE_MA200_1D (top 5, 100 USDT/trade)');
