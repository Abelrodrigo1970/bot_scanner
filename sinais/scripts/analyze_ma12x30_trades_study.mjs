/**
 * Estudo MA12×MA30 offline: Σ simples (A/B), equity composta, max DD, Kelly aprox. (Secção C).
 * `python analyze_ma12x30_trades_study.py` mantém só A/B (sem datas/cronologia no .py por defeito).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseEuNum(s) {
  let t = s.trim().replace("$", "").replace(/\s/g, "");
  if (!t) return NaN;
  if (t.includes(",") && t.includes("."))
    return parseFloat(t.replace(/\./g, "").replace(",", "."));
  if (t.includes(",")) return parseFloat(t.replace(",", "."));
  return parseFloat(t);
}

function pctFromLine(line) {
  const m = line.match(/(-?\s*\d+(?:[\.,]\d+)?)%/);
  if (!m) return null;
  return parseFloat(m[1].replace(/\s/g, "").replace(",", "."));
}

function readPriceToken(ln) {
  const tokens = ln.trim().split(/[\t\s]+/);
  for (const tok of tokens) {
    const t = tok.replace("$", "").trim();
    if (/^-?\d/.test(t))
      try {
        return parseEuNum(t);
      } catch (_) {}
  }
  return parseEuNum(ln.replace("$", ""));
}

/** `dd/mm/yyyy` ou `dd/mm/yyyy hh:mm` → ms UTC; `null` se não casar. */
function parsePtDateTime(line) {
  const m = line
    ?.trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  const h = m[4] != null ? Number(m[4]) : 12;
  const mi = m[5] != null ? Number(m[5]) : 0;
  const t = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  return Number.isFinite(t) ? t : null;
}

function parseTradesBlob(text) {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  /** @typedef {{symbol:string,side:string,entry:number,exit_px:number,mfe_pct:number,mae_pct:number,actual_ret_pct:number,ts:number|null,fileOrder:number}} Trade */
  const trades = /** @type {Trade[]} */ ([]);
  let fileOrder = 0;
  const symRe = /^([A-Z0-9]+USDT)\s+(COMPRA|VENDA)/;
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(symRe);
    if (!m) {
      i++;
      continue;
    }
    const symbol = m[1];
    const side = m[2];
    let j = i + 1;
    while (
      j < lines.length &&
      !lines[j].startsWith("15m\t") &&
      !lines[j].startsWith("15m ")
    )
      j++;
    if (j >= lines.length) break;
    const row = lines[j];
    const partsTab = row.split("\t").filter(Boolean);
    const ents = [];
    for (const chunk of partsTab.slice(1)) {
      const cc = chunk.replace("$", "").trim();
      if (!cc) continue;
      try {
        ents.push(parseEuNum(cc));
      } catch (_) {}
    }
    let entry, exit_px;
    if (ents.length >= 2) {
      entry = ents[ents.length - 2];
      exit_px = ents[ents.length - 1];
    } else {
      const dp = [...row.matchAll(/(\d+[.,]\d+)/g)];
      if (dp.length < 2) {
        i++;
        continue;
      }
      entry = parseEuNum(dp[dp.length - 2][1]);
      exit_px = parseEuNum(dp[dp.length - 1][1]);
    }

    let k = j + 1;
    // Linha monetária do PnL com $ (ex.: $-8,22 ou $+15,71)
    if ((lines[k] ?? "").includes("$")) k++;
    let act =
      side === "COMPRA"
        ? ((exit_px - entry) / entry) * 100
        : ((entry - exit_px) / entry) * 100;
    const pct = pctFromLine(lines[k] ?? "");
    if (pct != null) {
      act = pct;
      k++;
    }

    const hi_px = readPriceToken(lines[k] ?? "");
    k++;
    if (pctFromLine(lines[k] ?? "") != null) k++;
    const lo_px = readPriceToken(lines[k] ?? "");
    k++;
    if (pctFromLine(lines[k] ?? "") != null) k++;

    let mfe_pct, mae_pct;
    if (side === "COMPRA") {
      mfe_pct = ((hi_px - entry) / entry) * 100;
      mae_pct = ((lo_px - entry) / entry) * 100;
    } else {
      mfe_pct = ((entry - lo_px) / entry) * 100;
      mae_pct = ((entry - hi_px) / entry) * 100;
    }

    let ts = null;
    const parsedTs = parsePtDateTime(lines[k] ?? "");
    if (parsedTs != null) {
      ts = parsedTs;
      k++;
    }

    trades.push({
      symbol,
      side,
      entry,
      exit_px,
      high: hi_px,
      low: lo_px,
      mfe_pct,
      mae_pct,
      actual_ret_pct: act,
      ts,
      fileOrder: fileOrder++,
    });

    while (k < lines.length && !symRe.test(lines[k])) k++;
    i = k;
  }
  return trades;
}

function pnlWithPartials(t, sl_pct, tp1, tp2, w1, w2) {
  const hit_sl = t.mae_pct <= -sl_pct;
  if (hit_sl) return -sl_pct;
  let rest = 1.0;
  let total = 0.0;
  if (t.mfe_pct >= tp1 && rest > 1e-9) {
    const take = Math.min(w1, rest);
    total += take * tp1;
    rest -= take;
  }
  if (t.mfe_pct >= tp2 && rest > 1e-9) {
    const take = Math.min(w2, rest);
    total += take * tp2;
    rest -= take;
  }
  total += rest * t.actual_ret_pct;
  return total;
}

/** Ordem temporal ascendente; sem `ts` mantém ordem no ficheiro (`fileOrder`). */
function sortChronological(arr) {
  return [...arr].sort((a, b) => {
    if (a.ts != null && b.ts != null) return a.ts - b.ts;
    if (a.ts != null) return -1;
    if (b.ts != null) return 1;
    return a.fileOrder - b.fileOrder;
  });
}

/**
 * @param {number[]} pctSeries - retorno % por trade (sequência cronológica)
 */
function seriesStatsFromReturns(pctSeries) {
  if (!pctSeries.length) {
    return {
      finalEq: 100,
      maxDdPct: 0,
      sumSimple: 0,
      kellyMerton: 0,
      kellyBinary: 0,
      muPct: 0,
      sigmaPct: 0,
      n: 0,
    };
  }
  let eq = 100;
  let peak = 100;
  let maxDdPct = 0;
  for (let i = 0; i < pctSeries.length; i++) {
    const r = pctSeries[i];
    eq *= 1 + r / 100;
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
    if (dd > maxDdPct) maxDdPct = dd;
  }
  const rs = pctSeries.map((x) => x / 100);
  const n = rs.length;
  const mu = rs.reduce((s, x) => s + x, 0) / n;
  const var_ = rs.reduce((s, x) => s + (x - mu) ** 2, 0) / n;
  const sigma = Math.sqrt(Math.max(var_, 0));
  const kellyMerton = var_ > 1e-16 ? mu / var_ : 0;
  const pos = pctSeries.filter((x) => x > 0);
  const neg = pctSeries.filter((x) => x < 0);
  const p = pos.length / n;
  const avgWin = pos.length ? pos.reduce((a, b) => a + b, 0) / pos.length : 0;
  const avgLossAbs = neg.length ? neg.reduce((a, b) => a + Math.abs(b), 0) / neg.length : 0;
  let kellyBinary = 0;
  if (avgWin > 0 && avgLossAbs > 0) {
    const b = avgWin / avgLossAbs;
    kellyBinary = p - (1 - p) / b;
  }
  return {
    finalEq: eq,
    maxDdPct,
    sumSimple: pctSeries.reduce((s, x) => s + x, 0),
    kellyMerton,
    kellyBinary,
    muPct: mu * 100,
    sigmaPct: sigma * 100,
    n,
  };
}

function summarize(trades) {
  let actSum = trades.reduce((s, t) => s + t.actual_ret_pct, 0);
  const sumMfe = trades.reduce((s, t) => s + t.mfe_pct, 0);
  const wins = trades.filter((t) => t.actual_ret_pct > 0).length;
  console.log(
    `Trades: ${trades.length} | soma retornos observados: ${actSum.toFixed(2)}% | média ${(actSum / trades.length).toFixed(3)}%`
  );
  console.log(
    `Win rate observado: ${wins}/${trades.length} (${((100 * wins) / trades.length).toFixed(1)}%)`
  );
  const mfeNeg = trades.filter((t) => t.mfe_pct < 0).length;
  console.log(
    `Soma MFE (%): ${sumMfe.toFixed(0)} | trades com MFE<0: ${mfeNeg} (LONG só em queda líquida do máximo)`
  );

  const slGrid = [3, 4, 5, 6, 7, 8, 10, 12, 15];
  const tpPairs = [
    [6, 12],
    [8, 16],
    [10, 20],
    [12, 25],
    [15, 30],
    [20, 40],
    [30, 50],
    [44, 44],
  ];
  const weights = [
    [0.4, 0.4],
    [0.5, 0.3],
    [0.6, 0.3],
  ];

  console.log(
    "\n--- A: restante ao fecho real (proxy estratégia / time stop até ao fecho listado) ---\n"
  );
  for (const [w1, w2] of weights) {
    for (const [tp1, tp2] of tpPairs) {
      if (tp2 < tp1) continue;
      const parts = [];
      for (const sl of slGrid) {
        const s = trades.reduce(
          (acc, t) => acc + pnlWithPartials(t, sl, tp1, tp2, w1, w2),
          0
        );
        parts.push(`SL${sl}%=${s.toFixed(0)}`);
      }
      console.log(`TP ${tp1}/${tp2} w ${w1}/${w2} | ${parts.join(" | ")}`);
    }
  }

  console.log(
    "\n--- B: remanescente com `max(MFE observado, fecho real)` (teto pessimista/coerente vs duplicar TPs+MFE inteiro) ---\n"
  );
  /** @param {typeof trades[number]} t */
  function pnlMfeRemainderCapped(t, sl_pct, tp1, tp2, w1, w2) {
    if (t.mae_pct <= -sl_pct) return -sl_pct;
    let rest = 1.0;
    let total = 0.0;
    if (t.mfe_pct >= tp1 && rest > 1e-9) {
      const take = Math.min(w1, rest);
      total += take * tp1;
      rest -= take;
    }
    if (t.mfe_pct >= tp2 && rest > 1e-9) {
      const take = Math.min(w2, rest);
      total += take * tp2;
      rest -= take;
    }
    const tail = Math.max(t.mfe_pct, t.actual_ret_pct);
    total += rest * tail;
    return total;
  }
  for (const [w1, w2] of weights.slice(0, 2)) {
    for (const [tp1, tp2] of [[15, 30], [20, 40], [44, 44]]) {
      const row = slGrid.map((sl) => {
        const s = trades.reduce(
          (acc, t) =>
            acc + pnlMfeRemainderCapped(t, sl, tp1, tp2, w1, w2),
          0
        );
        return `${s.toFixed(0)}`;
      });
      console.log(`TP ${tp1}/${tp2} w ${w1}/${w2}: SL grid → ${row.join(", ")}`);
    }
  }

  console.log("\n--- Topo por soma total (cenário A, todos SL da grelha) ---");
  const allConfigs = [];
  for (const [w1, w2] of weights)
    for (const [tp1, tp2] of tpPairs)
      for (const sl of slGrid) {
        const s = trades.reduce(
          (acc, t) => acc + pnlWithPartials(t, sl, tp1, tp2, w1, w2),
          0
        );
        allConfigs.push({ s, sl, tp1, tp2, w1, w2 });
      }
  allConfigs.sort((a, b) => b.s - a.s);
  const seen = new Set();
  for (const c of allConfigs) {
    const k = `${c.sl}-${c.tp1}-${c.tp2}-${c.w1}-${c.w2}`;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(
      `Σ=${c.s.toFixed(0)}%  SL=${c.sl}%  TP= ${c.tp1}/${c.tp2}%  w= ${c.w1}/${c.w2}`
    );
    if (seen.size >= 15) break;
  }

  console.log("\n--- Config produto aprox.: 1 TP 44% em 60% posição ---");
  for (const sl of slGrid) {
    const s = trades.reduce(
      (acc, t) => acc + pnlWithPartials(t, sl, 44, 44, 0.6, 0),
      0
    );
    console.log(`  SL ${sl}%  → Σ ${s.toFixed(0)}%`);
  }

  const slTriggers = {};
  for (const sl of [5, 7, 10]) {
    slTriggers[sl] = trades.filter((t) => t.mae_pct <= -sl).length;
  }

  const dated = trades.filter((t) => t.ts != null).length;
  console.log(
    `\n--- C: Equity composta (base 100), max drawdown, Kelly aproximado ---\n` +
      `Datas parseadas: ${dated}/${trades.length} (ordem temporal ascendente).\n` +
      `Kelly Merton ≈ μ/σ² (retornos % como fraccionários); Kelly binário = p − (1−p)/b, b=avgWin/avgLoss. ` +
      `Valores f* >> 100% indicam modelo i.i.d. frágil (ignorar como tamanho de posição literal). ` +
      `Preferir fração << f* (ex. meio-Kelly); amostra curta e não estacionária.\n`
  );

  function fmtRisk(st) {
    return (
      `Eq→${st.finalEq.toFixed(2)} | maxDD ${st.maxDdPct.toFixed(2)}% | ` +
      `μ ${st.muPct.toFixed(3)}% σ ${st.sigmaPct.toFixed(3)}% | ` +
      `f*_M ${st.kellyMerton.toFixed(4)} (½ ${(st.kellyMerton / 2).toFixed(4)}) | ` +
      `f*_B ${st.kellyBinary.toFixed(4)} (½ ${(st.kellyBinary / 2).toFixed(4)})`
    );
  }

  const stObs = seriesStatsFromReturns(trades.map((t) => t.actual_ret_pct));
  console.log("[Observado — fechos reais] " + fmtRisk(stObs));

  console.log("\n[Produto sintét.: TP +44% em 60%]");
  const prodRows = [];
  for (const sl of slGrid) {
    const srs = trades.map((t) => pnlWithPartials(t, sl, 44, 44, 0.6, 0));
    const st = seriesStatsFromReturns(srs);
    prodRows.push({ sl, st });
    console.log(`  SL ${String(sl).padStart(2)}%  ${fmtRisk(st)}`);
  }

  console.log("\n[Simul.: TP 44/44, 40%+40%, resto fecho real]");
  for (const sl of slGrid) {
    const srs = trades.map((t) => pnlWithPartials(t, sl, 44, 44, 0.4, 0.4));
    const st = seriesStatsFromReturns(srs);
    console.log(`  SL ${String(sl).padStart(2)}%  ${fmtRisk(st)}`);
  }

  console.log("\n--- SL vs equity final vs max DD (produto sintét. 44%×60%) ---");
  console.log(prodRows.map((r) => `SL${r.sl}% Eq${r.st.finalEq.toFixed(1)} DD${r.st.maxDdPct.toFixed(1)}%`).join(" | "));
  const bestEq = [...prodRows].sort((a, b) => b.st.finalEq - a.st.finalEq)[0];
  console.log(`Maior equity final nesta amostra: SL=${bestEq.sl}% (${bestEq.st.finalEq.toFixed(2)})`);

  console.log(
    `\n--- Trades com MAE que tocou SL (referência) --- ${JSON.stringify(slTriggers)}`
  );
  console.log(
    "MAE só até ao fecho listado; Kelly é ilustrativo, não aconselhamento de posição."
  );
}

const blobPath =
  process.argv[2] || path.join(__dirname, "ma12x30_trades_paste.txt");
const blob = fs.readFileSync(blobPath, "utf8");
const trades = sortChronological(parseTradesBlob(blob));
if (trades.length < 10) {
  console.error("Poucos trades:", trades.length);
  process.exit(1);
}
summarize(trades);
