import { readFileSync } from 'fs';

const stripBom = s => s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
const s1 = JSON.parse(stripBom(readFileSync('./scripts/s1_fresh.json', 'utf8')));
const s4 = JSON.parse(stripBom(readFileSync('./scripts/s4_fresh.json', 'utf8')));

function analyzeRankMovement(data, scannerName) {
  const items = data.items;
  const runAt = data.run.scannedAt;
  const prevRunAt = data.previousRun?.scannedAt || 'N/A';

  console.log(`\n=== ${scannerName} ===`);
  console.log(`Run atual: ${runAt}`);
  console.log(`Run anterior: ${prevRunAt}`);
  console.log(`Total: ${items.length} símbolos\n`);

  // Use pctFromMaPrev (already computed by API) or fall back to current - delta
  const withDelta = items.filter(x => x.pctFromMaPrev !== null && x.pctFromMaPrev !== undefined);
  const withoutDelta = items.filter(x => x.pctFromMaPrev === null || x.pctFromMaPrev === undefined);

  const prevItems = withDelta.map(x => ({
    symbol: x.symbol,
    prevPct: x.pctFromMaPrev,
    currPct: x.pctFromMa,
    delta: x.pctFromMaDelta,
    currRank: x.rank,
    change24h: x.closeChangePct,
  }));

  // Sort by prevPct descending to get previous ranking
  const sortedByPrev = [...prevItems].sort((a, b) => b.prevPct - a.prevPct);
  sortedByPrev.forEach((item, idx) => {
    item.prevRank = idx + 1;
  });

  // Map currRank -> prevRank
  const rankMap = {};
  sortedByPrev.forEach(x => { rankMap[x.symbol] = x.prevRank; });

  // New entrants (no delta) are treated as not in previous run
  withoutDelta.forEach(x => { rankMap[x.symbol] = null; });

  // Current top 10 with rank movement
  const top10 = items.slice(0, 10);
  console.log('TOP 10 ATUAL com posição anterior:');
  console.log('Rank | Símbolo           | % MA  | Delta 4h | Rank Ant | Movimento');
  console.log('-----|-------------------|-------|----------|----------|----------');
  top10.forEach(item => {
    const prevRank = rankMap[item.symbol];
    const movement = prevRank === null ? 'NOVO' :
                     prevRank > item.rank ? `+${prevRank - item.rank}` :
                     prevRank < item.rank ? `-${item.rank - prevRank}` : '=';
    const prevStr = prevRank === null ? 'NOVO' : `#${prevRank}`;
    console.log(
      `  ${String(item.rank).padStart(2)}  | ${item.symbol.padEnd(17)} | ${item.pctFromMa.toFixed(1).padStart(5)}% | ${(item.pctFromMaDelta !== null ? (item.pctFromMaDelta >= 0 ? '+' : '') + item.pctFromMaDelta.toFixed(1) : 'N/A').padStart(8)}% | ${prevStr.padStart(8)} | ${movement}`
    );
  });

  // Biggest rank gainers (current rank vs previous rank)
  const gainers = withDelta
    .map(x => ({
      ...x,
      prevRank: rankMap[x.symbol],
      gain: rankMap[x.symbol] ? rankMap[x.symbol] - x.rank : 0,
    }))
    .filter(x => x.prevRank && x.gain > 0)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 10);

  console.log('\nMAIORES SUBIDAS DE POSIÇÃO:');
  gainers.forEach(x => {
    console.log(`  #${x.rank} ${x.symbol}: era #${x.prevRank} (subiu ${x.gain} posições, delta ${x.pctFromMaDelta.toFixed(1)}%)`);
  });

  const fallers = withDelta
    .map(x => ({
      ...x,
      prevRank: rankMap[x.symbol],
      fall: x.prevRank ? x.rank - rankMap[x.symbol] : 0,
    }))
    .filter(x => x.prevRank && x.rank - rankMap[x.symbol] > 0)
    .sort((a, b) => (b.rank - rankMap[b.symbol]) - (a.rank - rankMap[a.symbol]))
    .slice(0, 10);

  console.log('\nMAIORES DESCIDAS DE POSIÇÃO:');
  fallers.forEach(x => {
    console.log(`  #${x.rank} ${x.symbol}: era #${x.prevRank} (caiu ${x.rank - x.prevRank} posições, delta ${x.pctFromMaDelta.toFixed(1)}%)`);
  });

  return { items, rankMap, sortedByPrev, withoutDelta };
}

const s1Analysis = analyzeRankMovement(s1, 'SCANNER 1 — Acima MA200 1h');
const s4Analysis = analyzeRankMovement(s4, 'SCANNER 4 — Acima MA200 1d');

// JTO specifically
console.log('\n=== JTOUSDT em todos os scanners ===');
const jtoS1 = s1.items.find(x => x.symbol === 'JTOUSDT');
const jtoS4 = s4.items.find(x => x.symbol === 'JTOUSDT');
if (jtoS1) {
  const prevRankS1 = s1Analysis.rankMap['JTOUSDT'];
  console.log(`S1: rank=${jtoS1.rank}, pct=${jtoS1.pctFromMa.toFixed(2)}%, delta=${jtoS1.pctFromMaDelta?.toFixed(2)}%, prevRank=${prevRankS1}`);
}
if (jtoS4) {
  const prevRankS4 = s4Analysis.rankMap['JTOUSDT'];
  console.log(`S4: rank=${jtoS4.rank}, pct=${jtoS4.pctFromMa.toFixed(2)}%, delta=${jtoS4.pctFromMaDelta?.toFixed(2)}%, prevRank=${prevRankS4}`);
}

// Output compact JSON for canvas
const buildCanvasData = (data, rankMap) => {
  return data.items.map(x => ({
    s: x.symbol.replace('USDT',''),
    r: x.rank,
    pct: parseFloat(x.pctFromMa.toFixed(2)),
    delta: x.pctFromMaDelta !== null ? parseFloat(x.pctFromMaDelta.toFixed(2)) : null,
    ch: x.closeChangePct !== null ? parseFloat(x.closeChangePct.toFixed(2)) : null,
    pr: rankMap[x.symbol] || null,
    ppct: x.pctFromMaPrev !== null ? parseFloat(x.pctFromMaPrev.toFixed(2)) : null,
    isNew: x.isNewInUniverse,
  }));
};

console.log('\n=== S1_CANVAS_JSON ===');
console.log(JSON.stringify(buildCanvasData(s1, s1Analysis.rankMap)));
console.log('=== S1_CANVAS_JSON_END ===');
console.log('\n=== S4_CANVAS_JSON ===');
console.log(JSON.stringify(buildCanvasData(s4, s4Analysis.rankMap)));
console.log('=== S4_CANVAS_JSON_END ===');
