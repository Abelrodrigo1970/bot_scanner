/**
 * Simula MA Cross 15m (MA12/MA30) — estratégia MA_CROSS_5M — com TPs custom
 * sobre sinais já guardados com high24h / low24h / result24h.
 *
 * Uso (na pasta sinais, com DATABASE_URL):
 *   npx tsx scripts/simulate-ma-cross-5m-tp-window.ts
 *   npx tsx scripts/simulate-ma-cross-5m-tp-window.ts --from=2026-04-27 --to=2026-04-28
 *   npx tsx scripts/simulate-ma-cross-5m-tp-window.ts --buyTp1=4 --buyTp2=28 --sellTp1=4 --sellTp2=28
 *   npx tsx scripts/simulate-ma-cross-5m-tp-window.ts --compare
 *
 * Janela por defeito: 27 e 28 de Abril de 2026 (UTC, [from, to) em dias).
 * Mesma lógica conservadora que em app/estatisticas (SL primeiro; depois TP2/TP1;
 * restante com projeção linear a partir de result24h às 24h).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type SignalRow = {
  id: string;
  symbol: string;
  direction: string;
  entryPrice: number;
  result24h: number | null;
  high24h: number | null;
  low24h: number | null;
  generatedAt: Date;
};

function parseArgs(): {
  from: string;
  to: string;
  buyTp1: number;
  buyTp2: number;
  sellTp1: number;
  sellTp2: number;
  buySl: number;
  sellSl: number;
  tp1Pos: number;
  tp2Pos: number;
  finalHours: number;
  compare: boolean;
} {
  const a = process.argv.slice(2);
  const get = (k: string, d: string) => {
    const p = a.find((x) => x.startsWith(`${k}=`));
    return p ? p.slice(k.length + 1) : d;
  };
  const num = (k: string, d: number) => parseFloat(get(k, String(d))) || d;
  return {
    from: get('--from', '2026-04-27'),
    to: get('--to', '2026-04-29'),
    buyTp1: num('--buyTp1', 4),
    buyTp2: num('--buyTp2', 28),
    sellTp1: num('--sellTp1', 4),
    sellTp2: num('--sellTp2', 28),
    buySl: num('--buySl', 4),
    sellSl: num('--sellSl', 4),
    tp1Pos: num('--tp1Pos', 30),
    tp2Pos: num('--tp2Pos', 30),
    finalHours: num('--hours', 24),
    compare: a.includes('--compare'),
  };
}

function dayStartUtc(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/** [fromDay, toDay) — toDay is exclusive calendar day in UTC */
function parseRange(fromStr: string, toStr: string): { start: Date; end: Date } {
  return { start: dayStartUtc(fromStr), end: dayStartUtc(toStr) };
}

function simulateTrade(
  signal: SignalRow,
  buyParams: { stopLossPercent: number; tp1Percent: number; tp2Percent: number },
  sellParams: { stopLossPercent: number; tp1Percent: number; tp2Percent: number },
  buyPositionParams: { tp1PosPercent: number; tp2PosPercent: number },
  sellPositionParams: { tp1PosPercent: number; tp2PosPercent: number },
  finalHours: number
): { netPct: number; grossPct: number; path: string } {
  const FEE_OPEN = 0.0005;
  const FEE_CLOSE = 0.0005;
  const TOTAL_FEE = FEE_OPEN + FEE_CLOSE;
  const feeAmount = 100 * TOTAL_FEE;

  const activeParams = signal.direction === 'BUY' ? buyParams : sellParams;
  const activePositionParams = signal.direction === 'BUY' ? buyPositionParams : sellPositionParams;
  const stopLossPercent = activeParams.stopLossPercent;
  const tp1Percent = activeParams.tp1Percent;
  const tp2Percent = activeParams.tp2Percent;
  const tp1Weight = Math.max(0, Math.min(100, activePositionParams.tp1PosPercent)) / 100;
  const tp2Weight = Math.max(0, Math.min(100, activePositionParams.tp2PosPercent)) / 100;
  const finalWeight = Math.max(0, 1 - tp1Weight - tp2Weight);

  let stopLossPrice: number;
  let takeProfit1Price: number;
  let takeProfit2Price: number;

  if (signal.direction === 'BUY') {
    stopLossPrice = signal.entryPrice * (1 - stopLossPercent / 100);
    takeProfit1Price = signal.entryPrice * (1 + tp1Percent / 100);
    takeProfit2Price = signal.entryPrice * (1 + tp2Percent / 100);
  } else {
    stopLossPrice = signal.entryPrice * (1 + stopLossPercent / 100);
    takeProfit1Price = signal.entryPrice * (1 - tp1Percent / 100);
    takeProfit2Price = signal.entryPrice * (1 - tp2Percent / 100);
  }

  const base24hPercent =
    signal.result24h === null ? 0 : (signal.result24h / signal.entryPrice) * 100;
  const hoursMultiplier = Math.max(0.25, finalHours / 24);
  const finalResultPercent = base24hPercent * hoursMultiplier;

  let grossPercentResult = 0;
  let path = 'no_data';

  if (signal.direction === 'BUY') {
    if (signal.low24h !== null && signal.low24h <= stopLossPrice) {
      grossPercentResult = -stopLossPercent;
      path = 'SL';
    } else if (signal.high24h !== null && signal.high24h >= takeProfit2Price) {
      const cappedFinal = Math.max(finalResultPercent, -stopLossPercent);
      grossPercentResult = tp1Weight * tp1Percent + tp2Weight * tp2Percent + finalWeight * cappedFinal;
      path = 'TP2+';
    } else if (signal.high24h !== null && signal.high24h >= takeProfit1Price) {
      const remainingWeight = Math.max(0, 1 - tp1Weight);
      const cappedFinal = Math.max(finalResultPercent, -stopLossPercent);
      grossPercentResult = tp1Weight * tp1Percent + remainingWeight * cappedFinal;
      path = 'TP1_only';
    } else {
      grossPercentResult = Math.max(finalResultPercent, -stopLossPercent);
      path = 'mark';
    }
  } else {
    if (signal.high24h !== null && signal.high24h >= stopLossPrice) {
      grossPercentResult = -stopLossPercent;
      path = 'SL';
    } else if (signal.low24h !== null && signal.low24h <= takeProfit2Price) {
      const cappedFinal = Math.max(finalResultPercent, -stopLossPercent);
      grossPercentResult = tp1Weight * tp1Percent + tp2Weight * tp2Percent + finalWeight * cappedFinal;
      path = 'TP2+';
    } else if (signal.low24h !== null && signal.low24h <= takeProfit1Price) {
      const remainingWeight = Math.max(0, 1 - tp1Weight);
      const cappedFinal = Math.max(finalResultPercent, -stopLossPercent);
      grossPercentResult = tp1Weight * tp1Percent + remainingWeight * cappedFinal;
      path = 'TP1_only';
    } else {
      grossPercentResult = Math.max(finalResultPercent, -stopLossPercent);
      path = 'mark';
    }
  }

  return { netPct: grossPercentResult - feeAmount, grossPct: grossPercentResult, path };
}

async function main() {
  const cfg = parseArgs();
  const { start, end } = parseRange(cfg.from, cfg.to);

  console.log('═'.repeat(72));
  console.log('Simulação MA_CROSS_5M (MA Cross 15m MA12/MA30)');
  console.log(`Janela UTC: ${start.toISOString().slice(0, 10)} .. ${new Date(end.getTime() - 1).toISOString().slice(0, 10)} (exclusive end ${cfg.to})`);
  console.log(
    `TPs: BUY +${cfg.buyTp1}% / +${cfg.buyTp2}% | SELL −${cfg.sellTp1}% / −${cfg.sellTp2}% | SL ${cfg.buySl}% / ${cfg.sellSl}%`
  );
  console.log(`Pesos TP1/TP2/restante: ${cfg.tp1Pos}% / ${cfg.tp2Pos}% / ${100 - cfg.tp1Pos - cfg.tp2Pos}%`);
  console.log('═'.repeat(72));

  const strategy = await prisma.strategy.findUnique({ where: { name: 'MA_CROSS_5M' } });
  if (!strategy) {
    console.error('Estratégia MA_CROSS_5M não encontrada.');
    process.exit(1);
  }

  const raw = await prisma.signal.findMany({
    where: {
      strategyId: strategy.id,
      generatedAt: { gte: start, lt: end },
    },
    select: {
      id: true,
      symbol: true,
      direction: true,
      entryPrice: true,
      result24h: true,
      high24h: true,
      low24h: true,
      generatedAt: true,
    },
    orderBy: { generatedAt: 'asc' },
  });

  const with24h = raw.filter((s) => s.high24h != null && s.low24h != null && s.result24h != null);
  const missing = raw.length - with24h.length;

  const buyP = { stopLossPercent: cfg.buySl, tp1Percent: cfg.buyTp1, tp2Percent: cfg.buyTp2 };
  const sellP = { stopLossPercent: cfg.sellSl, tp1Percent: cfg.sellTp1, tp2Percent: cfg.sellTp2 };
  const buyPos = { tp1PosPercent: cfg.tp1Pos, tp2PosPercent: cfg.tp2Pos };
  const sellPos = { tp1PosPercent: cfg.tp1Pos, tp2PosPercent: cfg.tp2Pos };

  const rows = with24h.map((s) => ({
    ...s,
    result24h: s.result24h!,
    high24h: s.high24h!,
    low24h: s.low24h!,
  }));

  function summarize(
    label: string,
    buy: { stopLossPercent: number; tp1Percent: number; tp2Percent: number },
    sell: { stopLossPercent: number; tp1Percent: number; tp2Percent: number }
  ) {
    const sims = rows.map((s) => ({
      s,
      ...simulateTrade(s, buy, sell, buyPos, sellPos, cfg.finalHours),
    }));
    const totalNet = sims.reduce((a, b) => a + b.netPct, 0);
    const avgNet = sims.length ? totalNet / sims.length : 0;
    const wins = sims.filter((x) => x.netPct > 0).length;
    const losses = sims.filter((x) => x.netPct < 0).length;
    const byPath: Record<string, number> = {};
    for (const x of sims) {
      byPath[x.path] = (byPath[x.path] || 0) + 1;
    }
    console.log(`\n── ${label} ──`);
    console.log(`Vitórias: ${wins} | Derrotas: ${losses} | Soma P&L líquido: ${totalNet.toFixed(2)}% | Média: ${avgNet.toFixed(3)}%`);
    console.log('Por percurso:', byPath);
    return sims;
  }

  console.log(`\nSinais na janela: ${raw.length} | Com dados 24h: ${with24h.length} | Sem dados 24h: ${missing}`);

  const sims = summarize('Cenário pedido (TP1 4% / TP2 28% BUY e SELL)', buyP, sellP);

  if (cfg.compare) {
    summarize('Referência: TPs por defeito da estratégia (BUY 18/40, SELL 7/15)', {
      stopLossPercent: cfg.buySl,
      tp1Percent: 18,
      tp2Percent: 40,
    }, {
      stopLossPercent: cfg.sellSl,
      tp1Percent: 7,
      tp2Percent: 15,
    });
  }

  console.log('\n─ Detalhe (cenário pedido) ─');
  for (const { s, netPct, path } of sims) {
    const t = s.generatedAt.toISOString().slice(0, 16);
    console.log(
      `${t}  ${s.symbol.padEnd(14)} ${s.direction.padEnd(4)}  net ${netPct.toFixed(2).padStart(8)}%  [${path}]`
    );
  }

  if (missing > 0) {
    console.log('\n(Sinais sem high24h/low24h/result24h não entram na simulação — correr job de actualização 24h.)');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
