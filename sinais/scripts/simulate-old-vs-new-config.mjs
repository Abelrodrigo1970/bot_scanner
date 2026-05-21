/**
 * Simulação: MA Cross 15m — config antiga vs nova (1 Mai → presente)
 * Dados: API produção (sinais fechados com result24h)
 */
const FEE = 0.1;
const TZ = 'Europe/Lisbon';
const API =
  'https://botcripto-production.up.railway.app/api/signals?limit=5000&minStrength=70&onlyClosed=true&dateFrom=2026-05-01';

const OLD_COOLDOWN_MS = 8 * 60 * 60 * 1000;
const NEW_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const net = (s) => (s.result24h / s.entryPrice) * 100 - FEE;

function stats(rows, label) {
  if (!rows.length) {
    console.log(`${label}: 0 trades`);
    return { n: 0, wr: 0, total: 0, pf: 0, avg: 0 };
  }
  const nets = rows.map(net);
  const wins = nets.filter((n) => n >= 0);
  const losses = nets.filter((n) => n < 0);
  const grossW = wins.reduce((a, n) => a + n, 0);
  const grossL = Math.abs(losses.reduce((a, n) => a + n, 0));
  const st = {
    n: rows.length,
    wr: (wins.length / rows.length) * 100,
    total: nets.reduce((a, n) => a + n, 0),
    avg: nets.reduce((a, n) => a + n, 0) / rows.length,
    pf: grossL > 0 ? grossW / grossL : Infinity,
    wins: wins.length,
    losses: losses.length,
    avgWin: wins.length ? grossW / wins.length : 0,
    avgLoss: losses.length ? losses.reduce((a, n) => a + n, 0) / losses.length : 0,
  };
  console.log(
    `${label}: n=${st.n} | WR=${st.wr.toFixed(1)}% | liq=${st.total.toFixed(1)}% | avg=${st.avg.toFixed(2)}% | PF=${st.pf.toFixed(2)} | W/L=${st.wins}/${st.losses}`
  );
  return st;
}

function localDayKey(iso) {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ });
}

function isWeekend(iso) {
  const dow = new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' });
  return dow === 'Sat' || dow === 'Sun';
}

function simulateSlTp(signal) {
  const sl = 15;
  const tp1 = 44;
  const tp1Pos = 0.6;
  const stopLossPrice = signal.entryPrice * (1 - sl / 100);
  const takeProfit1Price = signal.entryPrice * (1 + tp1 / 100);
  const base24 = (signal.result24h / signal.entryPrice) * 100;
  let gross;
  if (signal.low24h != null && signal.low24h <= stopLossPrice) gross = -sl;
  else if (signal.high24h != null && signal.high24h >= takeProfit1Price)
    gross = tp1Pos * tp1 + (1 - tp1Pos) * Math.max(base24, -sl);
  else gross = Math.max(base24, -sl);
  return gross - FEE;
}

/** Config ANTIGA: cooldown 8h, mesma direção, sem bloqueio fim-de-semana, sem limite diário */
function filterOld(signals) {
  const sorted = [...signals].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
  const accepted = [];
  const lastByKey = new Map();

  for (const s of sorted) {
    const key = `${s.symbol}:${s.direction}`;
    const t = new Date(s.generatedAt).getTime();
    const last = lastByKey.get(key);
    if (last != null && t - last < OLD_COOLDOWN_MS) continue;
    accepted.push(s);
    lastByKey.set(key, t);
  }
  return accepted;
}

/** Config NOVA: sem fim-de-semana, cooldown 24h por símbolo, máx 1/dia PT */
function filterNew(signals) {
  const sorted = [...signals].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
  const accepted = [];
  const lastBySymbol = new Map();
  const dayBySymbol = new Map();

  for (const s of sorted) {
    if (isWeekend(s.generatedAt)) continue;

    const sym = s.symbol;
    const t = new Date(s.generatedAt).getTime();
    const day = localDayKey(s.generatedAt);

    const last = lastBySymbol.get(sym);
    if (last != null && t - last < NEW_COOLDOWN_MS) continue;

    if (dayBySymbol.get(`${sym}:${day}`)) continue;

    accepted.push(s);
    lastBySymbol.set(sym, t);
    dayBySymbol.set(`${sym}:${day}`, true);
  }
  return accepted;
}

function dailyBreakdown(rows) {
  const byDay = {};
  for (const s of rows) {
    const d = localDayKey(s.generatedAt);
    (byDay[d] ||= []).push(s);
  }
  return byDay;
}

const raw = await (await fetch(API)).json();
const all = raw.signals.filter(
  (s) => s.strategyName?.includes('MA Cross 15m') && s.result24h != null
);

const baseline = [...all].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
const oldCfg = filterOld(all);
const newCfg = filterNew(all);

console.log('='.repeat(72));
console.log('MA Cross 15m — ANTIGA vs NOVA (1 Mai 2026 → presente, horário PT)');
console.log(`Período: ${localDayKey(baseline[0]?.generatedAt)} → ${localDayKey(baseline.at(-1)?.generatedAt)}`);
console.log('='.repeat(72));

console.log('\n--- BRUTO 24h (como Estatísticas) ---');
const stAll = stats(baseline, 'Todos os sinais na BD (sem filtro)');
const stOld = stats(oldCfg, 'ANTIGA (cooldown 8h/direção, FDS activo)');
const stNew = stats(newCfg, 'NOVA   (sem FDS, cooldown 24h/símbolo, máx 1/dia)');

console.log('\n--- SIMULAÇÃO SL 15% / TP1 44% (60%) ---');
function simStats(rows, label) {
  const sims = rows.map(simulateSlTp);
  const wins = sims.filter((n) => n >= 0);
  const losses = sims.filter((n) => n < 0);
  const grossW = wins.reduce((a, n) => a + n, 0);
  const grossL = Math.abs(losses.reduce((a, n) => a + n, 0));
  const total = sims.reduce((a, n) => a + n, 0);
  console.log(
    `${label}: n=${rows.length} | WR=${((wins.length / rows.length) * 100).toFixed(1)}% | liq=${total.toFixed(1)}% | PF=${grossL > 0 ? (grossW / grossL).toFixed(2) : 'inf'}`
  );
  return total;
}
simStats(baseline, 'Todos BD     ');
simStats(oldCfg, 'ANTIGA       ');
simStats(newCfg, 'NOVA         ');

console.log('\n--- DELTA (NOVA − ANTIGA) ---');
console.log(`Trades: ${newCfg.length - oldCfg.length} (${((newCfg.length / oldCfg.length - 1) * 100).toFixed(1)}% volume)`);
console.log(`Lucro bruto 24h: ${(stNew.total - stOld.total).toFixed(1)}% (${stNew.total.toFixed(1)} vs ${stOld.total.toFixed(1)})`);
console.log(`WR: ${(stNew.wr - stOld.wr).toFixed(1)} pp`);

const blockedByNew = baseline.filter((s) => !newCfg.find((x) => x.id === s.id));
const blockedOld = baseline.filter((s) => !oldCfg.find((x) => x.id === s.id));
console.log(`\nSinais bloqueados ANTIGA: ${blockedOld.length} (cooldown 8h)`);
console.log(`Sinais bloqueados NOVA:   ${blockedByNew.length}`);

const blockedNewWeekend = baseline.filter((s) => isWeekend(s.generatedAt));
const blockedNewOther = blockedByNew.filter((s) => !isWeekend(s.generatedAt));
console.log(`  → fim-de-semana: ${blockedNewWeekend.length}`);
console.log(`  → cooldown/dia:  ${blockedNewOther.length}`);

console.log('\n--- IMPACTO DOS BLOQUEADOS PELA NOVA ---');
stats(blockedByNew, 'Trades que a NOVA exclui');
stats(
  newCfg.filter((s) => oldCfg.some((o) => o.id === s.id)),
  'Trades em comum (ambas aceitam)'
);
stats(
  oldCfg.filter((s) => !newCfg.find((n) => n.id === s.id)),
  'Só ANTIGA aceita (perdidos pela NOVA)'
);
stats(
  newCfg.filter((s) => !oldCfg.find((o) => o.id === s.id)),
  'Só NOVA aceita (impossível — subset)'
);

console.log('\n--- POR DIA (lucro bruto 24h cumulativo) ---');
const daysOld = dailyBreakdown(oldCfg);
const daysNew = dailyBreakdown(newCfg);
const allDays = [...new Set([...Object.keys(daysOld), ...Object.keys(daysNew)])].sort();
let cumOld = 0;
let cumNew = 0;
console.log('Dia       | ANTIGA n  dia%   cum%  | NOVA n  dia%   cum%');
for (const d of allDays) {
  const o = daysOld[d] || [];
  const n = daysNew[d] || [];
  const oSum = o.reduce((a, s) => a + net(s), 0);
  const nSum = n.reduce((a, s) => a + net(s), 0);
  cumOld += oSum;
  cumNew += nSum;
  const wk = isWeekend(`${d}T12:00:00Z`) ? ' FDS' : '';
  console.log(
    `${d}${wk.padEnd(4)} | ${String(o.length).padStart(3)} ${oSum.toFixed(0).padStart(6)} ${cumOld.toFixed(0).padStart(6)} | ${String(n.length).padStart(3)} ${nSum.toFixed(0).padStart(6)} ${cumNew.toFixed(0).padStart(6)}`
  );
}

console.log('\n--- FIM-DE-SEMANA (só config ANTIGA) ---');
stats(baseline.filter((s) => isWeekend(s.generatedAt)), 'Trades sáb/dom (bloqueados pela NOVA)');

console.log('\n--- MEIO DE SEMANA ---');
stats(baseline.filter((s) => !isWeekend(s.generatedAt)), 'Trades seg–sex (base total)');
