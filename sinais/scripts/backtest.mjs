import { readFileSync } from 'fs';

const stripBom = s => s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
const s1data = JSON.parse(stripBom(readFileSync('./scripts/s1_hist_full.json', 'utf8')));
const s4data = JSON.parse(stripBom(readFileSync('./scripts/s4_hist_full.json', 'utf8')));

/**
 * Backtest: comprar os top-N de cada run ao preço de fecho desse run,
 * vender no run seguinte ao preço de fecho do run seguinte.
 * Capital inicial: 100 USDT por símbolo (posição igual por símbolo).
 * @param {object} data - resposta do endpoint /history
 * @param {number} topN - quantos símbolos comprar por ciclo
 * @param {number} capitalPerSymbol - USDT por posição
 */
function backtest(data, topN = 5, capitalPerSymbol = 100) {
  // Ordem cronológica (mais antigo primeiro)
  const runs = [...data.runs].reverse();

  const trades = [];
  let totalPnl = 0;
  let totalTrades = 0;
  let wins = 0;
  let losses = 0;

  // Para cada ciclo, comprar top-N e vender no ciclo seguinte
  for (let i = 0; i < runs.length - 1; i++) {
    const buyRun = runs[i];
    const sellRun = runs[i + 1];

    // Mapa de preços no run de venda (todos os símbolos disponíveis)
    const sellPrices = new Map();
    for (const row of sellRun.top) {
      sellPrices.set(row.symbol, row.close);
    }

    const buyTop5 = buyRun.top.slice(0, topN);

    for (const bought of buyTop5) {
      const buyPrice = bought.close;
      const exitPrice = sellPrices.get(bought.symbol);

      // Símbolo saiu do scanner — trata como perda parcial (saiu abaixo da MA)
      // Usamos como referência o preço do run de venda se disponível
      const soldPrice = exitPrice ?? null;

      if (soldPrice === null) {
        // Símbolo não encontrado no próximo run — saiu do universo
        // Não temos preço de saída exacto — marcamos como N/A e excluímos do P&L
        trades.push({
          cycle: i + 1,
          buyRunAt: buyRun.scannedAt,
          sellRunAt: sellRun.scannedAt,
          symbol: bought.symbol,
          rank: bought.rank,
          buyPrice,
          soldPrice: null,
          pnlPct: null,
          pnlUsdt: null,
          note: 'saiu do scanner — sem preço de saída',
        });
        continue;
      }

      const pnlPct = ((soldPrice - buyPrice) / buyPrice) * 100;
      const pnlUsdt = capitalPerSymbol * (pnlPct / 100);
      totalPnl += pnlUsdt;
      totalTrades++;
      if (pnlPct > 0) wins++;
      else losses++;

      trades.push({
        cycle: i + 1,
        buyRunAt: buyRun.scannedAt,
        sellRunAt: sellRun.scannedAt,
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

  // Resumo por símbolo
  const bySymbol = {};
  for (const t of trades.filter(t => t.pnlUsdt !== null)) {
    if (!bySymbol[t.symbol]) {
      bySymbol[t.symbol] = { trades: 0, wins: 0, totalPnlUsdt: 0, totalPnlPct: 0 };
    }
    bySymbol[t.symbol].trades++;
    bySymbol[t.symbol].totalPnlUsdt += t.pnlUsdt;
    bySymbol[t.symbol].totalPnlPct += t.pnlPct;
    if (t.pnlPct > 0) bySymbol[t.symbol].wins++;
  }

  // Resumo por ciclo (soma P&L de todos os símbolos comprados nesse ciclo)
  const byCycle = {};
  for (const t of trades.filter(t => t.pnlUsdt !== null)) {
    const key = t.cycle;
    if (!byCycle[key]) {
      byCycle[key] = { cycle: key, buyAt: t.buyRunAt, sellAt: t.sellRunAt, totalPnl: 0, symbols: [] };
    }
    byCycle[key].totalPnl += t.pnlUsdt;
    byCycle[key].symbols.push(t.symbol);
  }

  const cycleResults = Object.values(byCycle).sort((a, b) => a.cycle - b.cycle);

  // Evolução do capital (começando com topN × capitalPerSymbol)
  const initialCapital = topN * capitalPerSymbol;
  let capital = initialCapital;
  const capitalEvolution = [{ cycle: 0, capital: parseFloat(initialCapital.toFixed(2)) }];
  for (const c of cycleResults) {
    capital += c.totalPnl;
    capitalEvolution.push({
      cycle: c.cycle,
      date: c.buyAt.slice(0, 16).replace('T',' '),
      capital: parseFloat(capital.toFixed(2)),
      cyclePnl: parseFloat(c.totalPnl.toFixed(2)),
    });
  }

  return {
    scanner: data.code,
    topN,
    capitalPerSymbol,
    initialCapital,
    finalCapital: parseFloat(capital.toFixed(2)),
    totalPnlUsdt: parseFloat(totalPnl.toFixed(2)),
    totalPnlPct: parseFloat(((capital - initialCapital) / initialCapital * 100).toFixed(2)),
    totalCycles: runs.length - 1,
    totalTrades,
    wins,
    losses,
    winRate: totalTrades > 0 ? parseFloat((wins / totalTrades * 100).toFixed(1)) : 0,
    tradesWithNoExit: trades.filter(t => t.pnlUsdt === null).length,
    capitalEvolution,
    cycleResults: cycleResults.map(c => ({...c, totalPnl: parseFloat(c.totalPnl.toFixed(2))})),
    bySymbol: Object.entries(bySymbol)
      .map(([sym, v]) => ({
        symbol: sym,
        trades: v.trades,
        wins: v.wins,
        winRate: parseFloat((v.wins / v.trades * 100).toFixed(1)),
        totalPnlUsdt: parseFloat(v.totalPnlUsdt.toFixed(2)),
        avgPnlPct: parseFloat((v.totalPnlPct / v.trades).toFixed(2)),
      }))
      .sort((a, b) => b.totalPnlUsdt - a.totalPnlUsdt),
    topTrades: trades
      .filter(t => t.pnlPct !== null)
      .sort((a, b) => b.pnlPct - a.pnlPct)
      .slice(0, 10),
    worstTrades: trades
      .filter(t => t.pnlPct !== null)
      .sort((a, b) => a.pnlPct - b.pnlPct)
      .slice(0, 10),
  };
}

const s1Result = backtest(s1data, 5, 100);
const s4Result = backtest(s4data, 5, 100);

console.log('\n=== BACKTEST SCANNER 1 (top 5, 100 USDT/símbolo) ===');
console.log(`Ciclos: ${s1Result.totalCycles}`);
console.log(`Capital inicial: ${s1Result.initialCapital} USDT`);
console.log(`Capital final: ${s1Result.finalCapital} USDT`);
console.log(`P&L total: ${s1Result.totalPnlUsdt > 0 ? '+' : ''}${s1Result.totalPnlUsdt} USDT (${s1Result.totalPnlPct > 0 ? '+' : ''}${s1Result.totalPnlPct}%)`);
console.log(`Win rate: ${s1Result.wins}/${s1Result.totalTrades} = ${s1Result.winRate}%`);
console.log(`Trades sem preço saída: ${s1Result.tradesWithNoExit}`);

console.log('\nCiclos S1:');
s1Result.cycleResults.forEach(c => {
  const sign = c.totalPnl >= 0 ? '+' : '';
  const dateStr = c.buyAt ? c.buyAt.slice(0,16).replace('T',' ') : '?';
  console.log(`  Ciclo ${String(c.cycle).padStart(2)}: ${dateStr} | P&L ${sign}${c.totalPnl.toFixed(2)} USDT | ${c.symbols.join(', ')}`);
});

console.log('\nTop símbolos S1:');
s1Result.bySymbol.slice(0, 10).forEach(s => {
  console.log(`  ${s.symbol}: ${s.trades} trades, WR ${s.winRate}%, P&L ${s.totalPnlUsdt > 0 ? '+' : ''}${s.totalPnlUsdt} USDT`);
});

console.log('\n=== BACKTEST SCANNER 4 (top 5, 100 USDT/símbolo) ===');
console.log(`Ciclos: ${s4Result.totalCycles}`);
console.log(`Capital inicial: ${s4Result.initialCapital} USDT`);
console.log(`Capital final: ${s4Result.finalCapital} USDT`);
console.log(`P&L total: ${s4Result.totalPnlUsdt > 0 ? '+' : ''}${s4Result.totalPnlUsdt} USDT (${s4Result.totalPnlPct > 0 ? '+' : ''}${s4Result.totalPnlPct}%)`);
console.log(`Win rate: ${s4Result.wins}/${s4Result.totalTrades} = ${s4Result.winRate}%`);

console.log('\nCiclos S4:');
s4Result.cycleResults.forEach(c => {
  const sign = c.totalPnl >= 0 ? '+' : '';
  const dateStr = c.buyAt ? c.buyAt.slice(0,16).replace('T',' ') : '?';
  console.log(`  Ciclo ${String(c.cycle).padStart(2)}: ${dateStr} | P&L ${sign}${c.totalPnl.toFixed(2)} USDT | ${c.symbols.join(', ')}`);
});

console.log('\nTop símbolos S4:');
s4Result.bySymbol.slice(0, 10).forEach(s => {
  console.log(`  ${s.symbol}: ${s.trades} trades, WR ${s.winRate}%, P&L ${s.totalPnlUsdt > 0 ? '+' : ''}${s.totalPnlUsdt} USDT`);
});

// Output compacto para o canvas
console.log('\n=== S1_RESULT_JSON ===');
console.log(JSON.stringify(s1Result));
console.log('=== S1_RESULT_JSON_END ===');
console.log('\n=== S4_RESULT_JSON ===');
console.log(JSON.stringify(s4Result));
console.log('=== S4_RESULT_JSON_END ===');
