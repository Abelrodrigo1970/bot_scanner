/**
 * Estudo Rompimento de Acumulação 15m — grelha de TPs parciais.
 *
 * Usa high24h / low24h / result24h dos sinais fechados (API).
 * Lógica conservadora: SL primeiro; depois TP2; depois TP1; resto ao fecho 24h.
 *
 * Uso (pasta sinais):
 *   node scripts/study-breakout-tp-scenarios.mjs
 *   node scripts/study-breakout-tp-scenarios.mjs --from=2026-06-14 --to=2026-08-10
 *   node scripts/study-breakout-tp-scenarios.mjs --unique   # 1.º sinal/símbolo/dia
 *   node scripts/study-breakout-tp-scenarios.mjs --json=out.json
 */

const API_BASE = process.env.API_BASE || 'https://botscanner-production.up.railway.app';
const FEE_RT = 0.1; // % round-trip
const DEFAULT_SL_PCT = 7;
/** Grelha de SL a testar (inclui actual 7% + pedidos 12%/20%) */
const SL_GRID = [7, 10, 12, 15, 20];

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k, d) => {
    const p = a.find((x) => x.startsWith(`${k}=`));
    return p ? p.slice(k.length + 1) : d;
  };
  const slList = get('--sl', '')
    .split(',')
    .map((x) => parseFloat(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return {
    from: get('--from', '2026-06-14'),
    to: get('--to', '2026-08-10'),
    unique: a.includes('--unique'),
    /** sl_first | tp_first | partial_then_sl | all */
    order: get('--order', 'partial_then_sl'),
    slLevels: slList.length ? slList : SL_GRID,
    jsonOut: get('--json', ''),
  };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

function dayChunks(fromStr, toStr) {
  const start = new Date(`${fromStr}T00:00:00.000Z`);
  const end = new Date(`${toStr}T00:00:00.000Z`);
  const chunks = [];
  let cur = new Date(start);
  while (cur <= end) {
    const next = new Date(cur);
    next.setUTCDate(next.getUTCDate() + 14);
    const to = next > end ? end : new Date(next.getTime() - 86400000);
    chunks.push([
      cur.toISOString().slice(0, 10),
      to.toISOString().slice(0, 10),
    ]);
    cur = next;
  }
  return chunks;
}

async function loadSignals(from, to) {
  const chunks = dayChunks(from, to);
  const byId = new Map();
  for (const [f, t] of chunks) {
    const url =
      `${API_BASE}/api/signals?minStrength=0&activeOnly=false` +
      `&strategy=${encodeURIComponent('Rompimento de Acumulação')}` +
      `&onlyClosed=true&dateFrom=${f}&dateTo=${t}&limit=5000`;
    const { signals } = await fetchJson(url);
    for (const s of signals || []) {
      if (
        s.strategyName === 'Rompimento de Acumulação 15m' &&
        s.high24h != null &&
        s.low24h != null &&
        s.result24h != null &&
        s.entryPrice > 0
      ) {
        byId.set(s.id, s);
      }
    }
  }
  return [...byId.values()].sort(
    (a, b) => new Date(a.generatedAt) - new Date(b.generatedAt)
  );
}

/** 1.º sinal por símbolo + dia UTC */
function uniqueFirstPerSymbolDay(signals) {
  const seen = new Set();
  const out = [];
  for (const s of signals) {
    const day = s.generatedAt.slice(0, 10);
    const key = `${s.symbol}|${day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * @param {object} signal
 * @param {{ tp1Pct: number, tp1Pos: number, tp2Pct?: number, tp2Pos?: number, slPct?: number }} sc
 * @param {'sl_first'|'tp_first'|'partial_then_sl'} order
 */
function simulate(signal, sc, order = 'sl_first') {
  const entry = signal.entryPrice;
  const slPct = sc.slPct ?? DEFAULT_SL_PCT;
  const tp1Pct = sc.tp1Pct;
  const tp2Pct = sc.tp2Pct ?? 0;
  const tp1W = Math.max(0, Math.min(100, sc.tp1Pos)) / 100;
  const tp2W = Math.max(0, Math.min(100, sc.tp2Pos ?? 0)) / 100;
  const finalW = Math.max(0, 1 - tp1W - tp2W);

  const slPrice = entry * (1 - slPct / 100);
  const tp1Price = tp1Pct > 0 ? entry * (1 + tp1Pct / 100) : Infinity;
  const tp2Price = tp2Pct > 0 ? entry * (1 + tp2Pct / 100) : Infinity;

  const base24 = (signal.result24h / entry) * 100;
  const cappedFinal = Math.max(base24, -slPct);

  const hitSl = signal.low24h <= slPrice;
  const hitTp2 = tp2Pct > 0 && tp2W > 0 && signal.high24h >= tp2Price;
  const hitTp1 = tp1Pct > 0 && tp1W > 0 && signal.high24h >= tp1Price;

  let gross;
  let path;

  if (order === 'tp_first') {
    if (hitTp2) {
      gross = tp1W * tp1Pct + tp2W * tp2Pct + finalW * cappedFinal;
      path = 'TP2+';
    } else if (hitTp1) {
      gross = tp1W * tp1Pct + Math.max(0, 1 - tp1W) * cappedFinal;
      path = 'TP1';
    } else if (hitSl) {
      gross = -slPct;
      path = 'SL';
    } else {
      gross = cappedFinal;
      path = 'MARK24';
    }
  } else if (order === 'partial_then_sl') {
    // Se tocou TP e SL no mesmo dia: trava parcial no TP, resto no SL
    if (hitSl && (hitTp1 || hitTp2)) {
      if (hitTp2) {
        gross = tp1W * tp1Pct + tp2W * tp2Pct + finalW * -slPct;
      } else {
        gross = tp1W * tp1Pct + Math.max(0, 1 - tp1W) * -slPct;
      }
      path = 'TP_then_SL';
    } else if (hitSl) {
      gross = -slPct;
      path = 'SL';
    } else if (hitTp2) {
      gross = tp1W * tp1Pct + tp2W * tp2Pct + finalW * cappedFinal;
      path = 'TP2+';
    } else if (hitTp1) {
      gross = tp1W * tp1Pct + Math.max(0, 1 - tp1W) * cappedFinal;
      path = 'TP1';
    } else {
      gross = cappedFinal;
      path = 'MARK24';
    }
  } else {
    // sl_first (conservador — default Estatísticas)
    if (hitSl) {
      gross = -slPct;
      path = 'SL';
    } else if (hitTp2) {
      gross = tp1W * tp1Pct + tp2W * tp2Pct + finalW * cappedFinal;
      path = 'TP2+';
    } else if (hitTp1) {
      gross = tp1W * tp1Pct + Math.max(0, 1 - tp1W) * cappedFinal;
      path = 'TP1';
    } else {
      gross = cappedFinal;
      path = 'MARK24';
    }
  }

  return { net: gross - FEE_RT, gross, path };
}

function summarize(label, signals, scenario, order) {
  const sims = signals.map((s) => simulate(s, scenario, order));
  const n = sims.length;
  const sum = sims.reduce((a, b) => a + b.net, 0);
  const avg = n ? sum / n : 0;
  const wins = sims.filter((x) => x.net > 0).length;
  const losses = sims.filter((x) => x.net < 0).length;
  const byPath = {};
  for (const x of sims) byPath[x.path] = (byPath[x.path] || 0) + 1;

  // expectancy-style: win rate * avg win + loss rate * avg loss
  const winAvg = wins ? sims.filter((x) => x.net > 0).reduce((a, b) => a + b.net, 0) / wins : 0;
  const lossAvg = losses
    ? sims.filter((x) => x.net < 0).reduce((a, b) => a + b.net, 0) / losses
    : 0;

  // max drawdown on equity curve of equal $100 trades (sum of nets)
  let eq = 0;
  let peak = 0;
  let maxDd = 0;
  for (const x of sims) {
    eq += x.net;
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    if (dd > maxDd) maxDd = dd;
  }

  return {
    label,
    order,
    scenario,
    n,
    sumNet: sum,
    avgNet: avg,
    winRate: n ? (100 * wins) / n : 0,
    wins,
    losses,
    winAvg,
    lossAvg,
    maxDd,
    byPath,
    profitFactor:
      losses && Math.abs(lossAvg * losses) > 0
        ? (winAvg * wins) / Math.abs(lossAvg * losses)
        : wins
          ? Infinity
          : 0,
  };
}

/** Templates de TP (sem SL — o SL vem da grelha) */
function buildTpTemplates() {
  return [
    { label: 'Sem TP (só SL + 24h)', tp1Pct: 0, tp1Pos: 0 },
    { label: 'Actual TP +10.5% @50%', tp1Pct: 10.5, tp1Pos: 50 },
    { label: 'TP +10.5% @100%', tp1Pct: 10.5, tp1Pos: 100 },
    { label: 'TP +12% @50%', tp1Pct: 12, tp1Pos: 50 },
    { label: 'TP +12% @100%', tp1Pct: 12, tp1Pos: 100 },
    { label: 'TP +22% @50%', tp1Pct: 22, tp1Pos: 50 },
    { label: 'TP +22% @100%', tp1Pct: 22, tp1Pos: 100 },
    { label: 'TP +8% @50%', tp1Pct: 8, tp1Pos: 50 },
    { label: 'TP +6% @50%', tp1Pct: 6, tp1Pos: 50 },
    { label: 'TP +15% @50%', tp1Pct: 15, tp1Pos: 50 },
    { label: 'TP +18% @50%', tp1Pct: 18, tp1Pos: 50 },
    {
      label: 'TP +8%@40% +22%@40%',
      tp1Pct: 8,
      tp1Pos: 40,
      tp2Pct: 22,
      tp2Pos: 40,
    },
    {
      label: 'TP +12%@40% +22%@40%',
      tp1Pct: 12,
      tp1Pos: 40,
      tp2Pct: 22,
      tp2Pos: 40,
    },
    {
      label: 'TP +12%@50% +30%@30%',
      tp1Pct: 12,
      tp1Pos: 50,
      tp2Pct: 30,
      tp2Pos: 30,
    },
    // R:R alinhado ao SL (reward ×1.5 / ×2)
    { label: 'TP R×1.5 @50%', tp1Pct: null, tp1Pos: 50, rr: 1.5 },
    { label: 'TP R×1.5 @100%', tp1Pct: null, tp1Pos: 100, rr: 1.5 },
    { label: 'TP R×2 @50%', tp1Pct: null, tp1Pos: 50, rr: 2 },
    { label: 'TP R×2 @100%', tp1Pct: null, tp1Pos: 100, rr: 2 },
  ];
}

/** Expande templates × níveis de SL */
function buildScenarios(slLevels) {
  const out = [];
  for (const slPct of slLevels) {
    for (const t of buildTpTemplates()) {
      const tp1Pct = t.rr != null ? slPct * t.rr : t.tp1Pct;
      const tpLabel =
        t.rr != null
          ? `TP +${(slPct * t.rr).toFixed(1)}% (R×${t.rr}) @${t.tp1Pos}%`
          : t.label;
      out.push({
        label: `SL${slPct}% | ${tpLabel}`,
        slPct,
        tp1Pct: tp1Pct ?? 0,
        tp1Pos: t.tp1Pos,
        tp2Pct: t.tp2Pct,
        tp2Pos: t.tp2Pos,
        tpKey: t.label,
      });
    }
  }
  return out;
}

function pad(s, n) {
  const t = String(s);
  return t.length >= n ? t.slice(0, n) : t + ' '.repeat(n - t.length);
}

async function main() {
  const cfg = parseArgs();
  console.log('═'.repeat(96));
  console.log('Estudo SL × TP parcial — Rompimento de Acumulação 15m');
  console.log(`Janela: ${cfg.from} → ${cfg.to} | API: ${API_BASE}`);
  console.log(
    `Modo: ${cfg.unique ? '1.º sinal / símbolo / dia' : 'todos os sinais'} | Fee RT ${FEE_RT}% | SL grid: ${cfg.slLevels.join(', ')}%`
  );
  console.log('═'.repeat(96));

  let signals = await loadSignals(cfg.from, cfg.to);
  console.log(`Sinais carregados (com 24h): ${signals.length}`);
  if (cfg.unique) {
    signals = uniqueFirstPerSymbolDay(signals);
    console.log(`Após dedupe 1.º/símbolo/dia: ${signals.length}`);
  }
  if (!signals.length) {
    console.error('Sem sinais.');
    process.exit(1);
  }

  const tpLevels = [6, 8, 10.5, 12, 15, 18, 22, 30];
  const slHitByLevel = {};
  for (const sl of cfg.slLevels) slHitByLevel[sl] = 0;
  const hits = Object.fromEntries(tpLevels.map((l) => [l, 0]));
  for (const s of signals) {
    const highPct = ((s.high24h - s.entryPrice) / s.entryPrice) * 100;
    const lowPct = ((s.low24h - s.entryPrice) / s.entryPrice) * 100;
    for (const sl of cfg.slLevels) if (lowPct <= -sl) slHitByLevel[sl]++;
    for (const l of tpLevels) if (highPct >= l) hits[l]++;
  }
  console.log('\nTaxas de SL (low24h):');
  for (const sl of cfg.slLevels) {
    console.log(
      `  SL −${sl}%: ${slHitByLevel[sl]}/${signals.length} (${((100 * slHitByLevel[sl]) / signals.length).toFixed(1)}%)`
    );
  }
  console.log('Taxas de high:');
  for (const l of tpLevels) {
    console.log(
      `  High ≥ +${l}%: ${hits[l]}/${signals.length} (${((100 * hits[l]) / signals.length).toFixed(1)}%)`
    );
  }

  const orders =
    cfg.order === 'all'
      ? ['sl_first', 'tp_first', 'partial_then_sl']
      : [cfg.order];

  const allByOrder = {};
  const scenarios = buildScenarios(cfg.slLevels);

  for (const order of orders) {
    const results = scenarios.map((sc) => summarize(sc.label, signals, sc, order));
    results.sort((a, b) => b.sumNet - a.sumNet);
    allByOrder[order] = results;

    console.log('\n' + '═'.repeat(96));
    console.log(`ORDEM: ${order} — TOP 25 / ${results.length}`);
    console.log('─'.repeat(96));
    console.log(
      pad('#', 4) +
        pad('Cenário', 48) +
        pad('Soma%', 10) +
        pad('Média%', 9) +
        pad('WR%', 7) +
        pad('PF', 7) +
        'Paths'
    );
    console.log('─'.repeat(96));

    results.slice(0, 25).forEach((r, i) => {
      const pathStr = Object.entries(r.byPath)
        .map(([k, v]) => `${k}:${v}`)
        .join(' ');
      console.log(
        pad(String(i + 1), 4) +
          pad(r.label, 48) +
          pad((r.sumNet >= 0 ? '+' : '') + r.sumNet.toFixed(1), 10) +
          pad((r.avgNet >= 0 ? '+' : '') + r.avgNet.toFixed(3), 9) +
          pad(r.winRate.toFixed(1), 7) +
          pad(Number.isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : '∞', 7) +
          pathStr
      );
    });

    console.log('\n── Melhor por cada SL ──');
    for (const sl of cfg.slLevels) {
      const best = results.find((r) => r.scenario.slPct === sl);
      if (best) {
        console.log(
          `  SL${sl}%: ${best.label.replace(`SL${sl}% | `, '')} → média ${best.avgNet.toFixed(3)}% | WR ${best.winRate.toFixed(1)}% | PF ${best.profitFactor.toFixed(2)}`
        );
      }
    }

    // Matriz compacta: SL × TP chave
    const focusKeys = [
      'Sem TP (só SL + 24h)',
      'Actual TP +10.5% @50%',
      'TP +12% @50%',
      'TP +12% @100%',
      'TP +22% @50%',
      'TP +22% @100%',
      'TP +8% @50%',
      'TP R×1.5 @100%',
      'TP R×2 @100%',
    ];
    console.log('\n── Matriz média% (linhas=SL, colunas=TP) ──');
    const header = pad('SL\\TP', 10) + focusKeys.map((k) => pad(k.slice(0, 14), 14)).join('');
    console.log(header);
    for (const sl of cfg.slLevels) {
      let row = pad(`${sl}%`, 10);
      for (const key of focusKeys) {
        const r = results.find((x) => x.scenario.slPct === sl && x.scenario.tpKey === key);
        row += pad(r ? r.avgNet.toFixed(2) : 'n/a', 14);
      }
      console.log(row);
    }

    const best = results[0];
    const baseline = results.find(
      (r) => r.scenario.slPct === 7 && r.scenario.tpKey === 'Actual TP +10.5% @50%'
    );
    console.log(`\n★ Melhor global: ${best.label}`);
    console.log(
      `  Soma ${best.sumNet.toFixed(1)}% | Média ${best.avgNet.toFixed(3)}% | WR ${best.winRate.toFixed(1)}% | PF ${best.profitFactor.toFixed(2)}`
    );
    if (baseline) {
      console.log(
        `vs Actual SL7%+TP10.5%@50%: Δ média ${(best.avgNet - baseline.avgNet).toFixed(3)} pp`
      );
    }
  }

  if (cfg.jsonOut) {
    const fs = await import('fs');
    fs.writeFileSync(
      cfg.jsonOut,
      JSON.stringify(
        {
          meta: {
            from: cfg.from,
            to: cfg.to,
            unique: cfg.unique,
            n: signals.length,
            feeRt: FEE_RT,
            slLevels: cfg.slLevels,
            slHitByLevel,
            highHits: hits,
          },
          byOrder: allByOrder,
        },
        null,
        2
      )
    );
    console.log(`\nJSON escrito: ${cfg.jsonOut}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
