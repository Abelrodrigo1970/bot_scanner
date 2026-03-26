/**
 * Análise completa MA200_VOLATILE — Grid search de SL / TP1 / TP2
 *
 * Como usar:
 *   $env:DATABASE_URL="postgresql://user:pass@host:port/db"
 *   node scripts/analyze-ma200.js
 *
 * Requer DATABASE_URL apontando para o PostgreSQL de produção.
 */

process.env.DATABASE_URL = process.env.DATABASE_URL || '';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/* ─────────────────────────────────────────────────────────────────────────── */
/* Constantes                                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */
const FEE_RT   = 0.10;  // 0.10% round-trip (0.05% abertura + 0.05% fecho)
const TRADE_SZ = 100;   // $ por trade (referência)

// Weights padrão na saída parcial (30% no TP1, 40% no TP2, 30% resto/SL)
const W1 = 0.30;
const W2 = 0.40;
const W3 = 0.30;

/* ─────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */
function pct(a, b) { return ((a - b) / b) * 100; }

/**
 * Para cada trade calcula:
 *   fav  = máxima excursão favorável em %  (intraday)
 *   adv  = máxima excursão adversa em %   (intraday)
 *   close= resultado no fecho das 24h em %
 */
function excursion(t) {
  const e = t.entryPrice;
  if (t.direction === 'BUY') {
    return {
      fav:   t.high24h ? pct(t.high24h, e) : null,
      adv:   t.low24h  ? pct(e, t.low24h)  : null,   // quanto caiu
      close: t.result24h != null ? (t.result24h / e) * 100 : null,
    };
  }
  // SELL: lucro quando preço desce
  return {
    fav:   t.low24h  ? pct(e, t.low24h)  : null,   // quanto desceu = favorável
    adv:   t.high24h ? pct(t.high24h, e) : null,   // quanto subiu = adverso
    close: t.result24h != null ? (t.result24h / e) * 100 : null,
  };
}

/**
 * Simula P&L de um trade com dados de excursão e parâmetros (SL, TP1, TP2).
 * Usa modelo "conservative": SL tem prioridade se adv >= SL antes de fav >= TP.
 *   - Se adv >= SL  → perde SL% em 100% posição
 *   - Senão se fav >= TP2 → TP1 em W1, TP2 em W2, close em W3
 *   - Senão se fav >= TP1 → TP1 em W1, close em W2+W3
 *   - Senão → close em 100%
 */
function simulatePnl(ex, sl, tp1, tp2) {
  if (ex.fav === null || ex.adv === null || ex.close === null) {
    return ex.close !== null ? ex.close - FEE_RT : null;
  }
  const hitSL  = ex.adv  >= sl;
  const hitTP1 = ex.fav  >= tp1;
  const hitTP2 = ex.fav  >= tp2;

  let gross;
  if (hitSL) {
    // Stop hit (independentemente de TP — conservador)
    gross = -sl;
  } else if (hitTP2) {
    gross = tp1 * W1 + tp2 * W2 + ex.close * W3;
  } else if (hitTP1) {
    gross = tp1 * W1 + ex.close * (W2 + W3);
  } else {
    gross = ex.close;
  }
  return gross - FEE_RT;
}

function stats(pnls) {
  const valid = pnls.filter(v => v !== null);
  if (valid.length === 0) return null;
  const n      = valid.length;
  const wins   = valid.filter(v => v > 0);
  const losses = valid.filter(v => v <= 0);
  const sumW   = wins.reduce((a, b) => a + b, 0);
  const sumL   = Math.abs(losses.reduce((a, b) => a + b, 0));
  const net    = sumW - sumL;
  return {
    n,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / n * 100).toFixed(1),
    avgWin: wins.length ? (sumW / wins.length).toFixed(2) : '0.00',
    avgLoss: losses.length ? (sumL / losses.length).toFixed(2) : '0.00',
    net: net.toFixed(2),
    avg: (net / n).toFixed(2),
    pf: sumL > 0 ? (sumW / sumL).toFixed(2) : sumW > 0 ? '∞' : '0.00',
    maxWin:  wins.length   ? Math.max(...wins).toFixed(2)   : '0.00',
    maxLoss: losses.length ? Math.abs(Math.min(...losses)).toFixed(2) : '0.00',
  };
}

function line(char = '─', len = 78) { return char.repeat(len); }

/* ─────────────────────────────────────────────────────────────────────────── */
/* Main                                                                        */
/* ─────────────────────────────────────────────────────────────────────────── */
async function main() {
  console.log('\n' + line('═'));
  console.log('  📊  ANÁLISE MA200 TOP VOLÁTEIS — Grid Search SL / TP1 / TP2');
  console.log(line('═'));

  /* 1. Buscar todos os sinais fechados da MA200 ─────────────────────────── */
  const trades = await prisma.signal.findMany({
    where: {
      strategyName: 'MA200 Top Voláteis',
      status24h: 'CLOSED',
      result24h: { not: null },
    },
    orderBy: { generatedAt: 'asc' },
    select: {
      id: true, symbol: true, direction: true,
      entryPrice: true, result24h: true,
      high24h: true, low24h: true, generatedAt: true,
    },
  });

  if (trades.length === 0) {
    console.error('\n❌ Nenhum sinal MA200 fechado encontrado.');
    console.error('   Verifique DATABASE_URL e se há sinais com status24h=CLOSED.\n');
    return;
  }

  const enriched = trades.map(t => ({ ...t, ex: excursion(t) }));
  const hasHL    = enriched.filter(t => t.high24h !== null && t.low24h !== null).length;

  console.log(`\n  Total de trades fechados: ${trades.length}`);
  console.log(`  Com high24h / low24h:     ${hasHL}`);
  console.log(`  Sem high24h / low24h:     ${trades.length - hasHL} (usa só close 24h)`);

  /* 2. Estatísticas brutas (sem SL/TP) ─────────────────────────────────── */
  const rawPnls = enriched.map(t =>
    t.ex.close !== null ? t.ex.close - FEE_RT : null
  );
  const rawStats = stats(rawPnls);

  console.log('\n' + line());
  console.log('  RESULTADOS BRUTOS (sem SL/TP enforçado — preço de fecho 24h)');
  console.log(line());
  console.log(`  Trades  : ${rawStats.n}`);
  console.log(`  Ganhos  : ${rawStats.wins}   (Win Rate ${rawStats.winRate}%)`);
  console.log(`  Perdas  : ${rawStats.losses}`);
  console.log(`  Avg Win : +${rawStats.avgWin}%`);
  console.log(`  Avg Loss: -${rawStats.avgLoss}%`);
  console.log(`  Max Win : +${rawStats.maxWin}%`);
  console.log(`  Max Loss: -${rawStats.maxLoss}%`);
  console.log(`  Net %   : ${rawStats.net}%  (avg por trade: ${rawStats.avg}%)`);
  console.log(`  PF      : ${rawStats.pf}`);

  /* 3. Tabela por trade ────────────────────────────────────────────────── */
  console.log('\n' + line());
  console.log('  DETALHE POR TRADE');
  console.log(line());
  console.log(`  ${'DATA'.padEnd(17)} ${'PAR'.padEnd(12)} ${'DIR'.padEnd(5)} ${'ENTRADA'.padEnd(12)} ${'FAV%'.padEnd(8)} ${'ADV%'.padEnd(8)} ${'CLOSE%'.padEnd(9)} STATUS`);
  console.log(line('-'));
  for (const t of enriched) {
    const date  = new Date(t.generatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    const fav   = t.ex.fav   !== null ? `+${t.ex.fav.toFixed(1)}%`   : '  N/A   ';
    const adv   = t.ex.adv   !== null ? `-${t.ex.adv.toFixed(1)}%`   : '  N/A   ';
    const close = t.ex.close !== null ? `${t.ex.close >= 0 ? '+' : ''}${t.ex.close.toFixed(1)}%` : '  N/A ';
    const status = (t.ex.close ?? 0) >= 0 ? '✅ WIN' : '❌ LOSS';
    console.log(`  ${date.padEnd(17)} ${t.symbol.padEnd(12)} ${t.direction.padEnd(5)} ${t.entryPrice.toFixed(5).padEnd(12)} ${fav.padEnd(8)} ${adv.padEnd(8)} ${close.padEnd(9)} ${status}`);
  }

  /* 4. Grid search SL × TP1 × TP2 ─────────────────────────────────────── */
  if (hasHL === 0) {
    console.log('\n⚠️  Sem high24h/low24h: grid search de SL/TP apenas com close 24h (menos preciso).');
  }

  const SLS  = [5, 6, 7, 8, 9, 10, 11, 12, 13, 15];
  const TP1S = [6, 8, 10, 12, 15, 18, 20, 25, 30];
  const TP2S = [12, 15, 18, 20, 25, 30, 35, 40, 50];

  let best = [];

  for (const sl of SLS) {
    for (const tp1 of TP1S) {
      for (const tp2 of TP2S) {
        if (tp2 <= tp1) continue;
        const pnls = enriched.map(t => simulatePnl(t.ex, sl, tp1, tp2));
        const s    = stats(pnls.filter(v => v !== null));
        if (!s) continue;
        best.push({ sl, tp1, tp2, ...s });
      }
    }
  }

  // Ordenar por net % total
  best.sort((a, b) => parseFloat(b.net) - parseFloat(a.net));

  const top20 = best.slice(0, 20);

  console.log('\n' + line('═'));
  console.log('  TOP 20 CONFIGURAÇÕES POR LUCRO LÍQUIDO ACUMULADO');
  console.log(line('═'));
  console.log(`  ${'RANK'.padEnd(5)} ${'SL%'.padEnd(6)} ${'TP1%'.padEnd(6)} ${'TP2%'.padEnd(6)} ${'WR%'.padEnd(7)} ${'avgW%'.padEnd(8)} ${'avgL%'.padEnd(8)} ${'Net%'.padEnd(9)} ${'avg/tr'.padEnd(8)} PF`);
  console.log(line('-'));
  top20.forEach((r, i) => {
    console.log(
      `  ${String(i + 1).padEnd(5)} ${String(r.sl).padEnd(6)} ${String(r.tp1).padEnd(6)} ${String(r.tp2).padEnd(6)} ${r.winRate.padEnd(7)} +${r.avgWin.padEnd(7)} -${r.avgLoss.padEnd(7)} ${r.net.padEnd(9)} ${r.avg.padEnd(8)} ${r.pf}`
    );
  });

  /* 5. Configuração recomendada ──────────────────────────────────────────── */
  const rec = best[0];
  const cur = best.find(r => r.sl === 10 && r.tp1 === 20 && r.tp2 === 40) ||
              { sl: 10, tp1: 20, tp2: 40, net: 'N/A', winRate: 'N/A', pf: 'N/A' };

  console.log('\n' + line('═'));
  console.log('  RECOMENDAÇÃO FINAL');
  console.log(line('═'));
  console.log(`\n  Config ATUAL    (SL ${cur.sl}% / TP1 ${cur.tp1}% / TP2 ${cur.tp2}%):`);
  console.log(`    Net acumulado : ${cur.net}%   WR: ${cur.winRate}%   PF: ${cur.pf}`);
  console.log(`\n  Config ÓTIMA   (SL ${rec.sl}% / TP1 ${rec.tp1}% / TP2 ${rec.tp2}%):`);
  console.log(`    Net acumulado : ${rec.net}%   WR: ${rec.winRate}%   PF: ${rec.pf}`);

  /* 6. Análise por direção ─────────────────────────────────────────────── */
  const buys  = enriched.filter(t => t.direction === 'BUY');
  const sells = enriched.filter(t => t.direction === 'SELL');

  function dirStats(arr) {
    if (!arr.length) return null;
    const pnls = arr.map(t => t.ex.close !== null ? t.ex.close - FEE_RT : null);
    return stats(pnls);
  }

  const buyStats  = dirStats(buys);
  const sellStats = dirStats(sells);

  console.log('\n' + line());
  console.log('  POR DIREÇÃO (resultados brutos)');
  console.log(line());
  if (buyStats) {
    console.log(`  BUY  → ${buys.length} trades | WR ${buyStats.winRate}% | avg ${buyStats.avg}% | PF ${buyStats.pf}`);
  }
  if (sellStats) {
    console.log(`  SELL → ${sells.length} trades | WR ${sellStats.winRate}% | avg ${sellStats.avg}% | PF ${sellStats.pf}`);
  }

  /* 7. Maior drawdown / outliers ─────────────────────────────────────────── */
  const sorted = [...enriched].sort((a, b) => (a.ex.close ?? 0) - (b.ex.close ?? 0));
  const worst  = sorted.slice(0, 3);
  const best3  = sorted.slice(-3).reverse();

  console.log('\n' + line());
  console.log('  TOP 3 PIORES TRADES (candidatos a SL mais apertado)');
  console.log(line('-'));
  worst.forEach(t => {
    console.log(`  ${t.symbol} ${t.direction} ${new Date(t.generatedAt).toLocaleDateString('pt-BR')} → close ${(t.ex.close ?? 0).toFixed(2)}%  adv ${t.ex.adv !== null ? t.ex.adv.toFixed(2) : 'N/A'}%`);
  });
  console.log('\n  TOP 3 MELHORES TRADES');
  console.log(line('-'));
  best3.forEach(t => {
    console.log(`  ${t.symbol} ${t.direction} ${new Date(t.generatedAt).toLocaleDateString('pt-BR')} → close ${(t.ex.close ?? 0).toFixed(2)}%  fav ${t.ex.fav !== null ? t.ex.fav.toFixed(2) : 'N/A'}%`);
  });

  console.log('\n' + line('═') + '\n');

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('\n❌ Erro:', err.message || err);
  prisma.$disconnect();
  process.exit(1);
});
