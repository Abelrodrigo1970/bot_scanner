"""
Estudo offline: trades MA12×MA30 (dados colados da UI).
Usa entrada, saída real, máxima e mínima intradiárias (MFE/MAE em %).

Modelo de encadeamento (conservador para SL):
- Se o MAE tocou o SL (% vs entrada, no sentido da posição), assume-se saída total no SL.
- Caso contrário: aplica TP1 em fração w1 se MFE >= TP1%; depois TP2 em fração w2 do resto se MFE >= TP2%;
  o remanescente fecha na % do preço real de saída (proxy de fecho dinâmico / 24h).

Variante "24h": igual, mas o remanescente usa sempre o retorno do fecho observado (já é o caso);
  para comparar com "sem time stop" podíamos usar só MFE no remanescente — aqui "24h" = assumir
  que o fecho listado é a marcação após janela (mesmo número que baseline real).

Limitação: sem série temporal intra-trade, não sabemos se o SL foi tocado antes ou depois dos TPs;
  a regra acima dá prioridade implícita ao SL se MAE <= -SL (realista para stops fixos).

Equity composta, max drawdown e Kelly (ordem cronológica com datas dd/mm/yyyy): ver
`sinais/scripts/analyze_ma12x30_trades_study.mjs` (Node).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

Side = Literal["COMPRA", "VENDA"]


@dataclass
class Trade:
    symbol: str
    side: Side
    entry: float
    exit_px: float
    high: float
    low: float
    mfe_pct: float  # melhor movimento a favor (% PnL vs entrada)
    mae_pct: float  # pior movimento contra (% PnL vs entrada, negativo em long)
    actual_ret_pct: float


def parse_eu_num(s: str) -> float:
    s = s.strip().replace("$", "").replace(" ", "")
    if "," in s and "." in s:
        # e.g. 1.234,56
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    return float(s)


def _pct_from_line(line: str) -> float | None:
    m = re.search(r"(-?\s*\d+(?:[\.,]\d+)?)%", line)
    if not m:
        return None
    return float(m.group(1).replace(" ", "").replace(",", "."))


def _read_price_token(ln: str) -> float:
    """Primeiro token tipo preço (pode vir '0,0007103' ou '13,054')."""
    ln = ln.strip()
    tokens = re.split(r"[\t\s]+", ln)
    for tok in tokens:
        t = tok.strip().replace("$", "")
        if t and re.match(r"^-?\d", t):
            try:
                return parse_eu_num(t)
            except ValueError:
                continue
    return parse_eu_num(ln.replace("$", ""))


def parse_trades_blob(text: str) -> list[Trade]:
    """Parser ao bloco colado: SYMBOL + lado → linha 15m → PnL% → dois preços+cada %."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    trades: list[Trade] = []
    sym_re = re.compile(r"^([A-Z0-9]+USDT)\s+(COMPRA|VENDA)")

    i = 0
    while i < len(lines):
        m = sym_re.match(lines[i])
        if not m:
            i += 1
            continue
        symbol = m.group(1)
        side = m.group(2)  # type: Side
        j = i + 1
        while j < len(lines) and not (lines[j].startswith("15m\t") or lines[j].startswith("15m ")):
            j += 1
        if j >= len(lines):
            break
        row = lines[j]
        parts_tab = row.split("\t")
        ents: list[float] = []
        for chunk in parts_tab[1:]:
            cc = chunk.replace("$", "").strip()
            if not cc:
                continue
            try:
                ents.append(parse_eu_num(cc))
            except ValueError:
                pass
        if len(ents) >= 2:
            entry = ents[-2]
            exit_px = ents[-1]
        else:
            dp = list(re.finditer(r"(\d+[.,]\d+)", row))
            if len(dp) < 2:
                i += 1
                continue
            entry = parse_eu_num(dp[-2].group(1))
            exit_px = parse_eu_num(dp[-1].group(1))

        k = j + 1
        # Linha monetária do PnL com símbolo $ (mesmo quando negativa, ex.: $-8,22)
        if k < len(lines) and "$" in lines[k]:
            k += 1
        # Retorno observado %
        act = (
            ((exit_px - entry) / entry) * 100
            if side == "COMPRA"
            else ((entry - exit_px) / entry) * 100
        )
        if k < len(lines) and _pct_from_line(lines[k]) is not None:
            act = float(_pct_from_line(lines[k]) or act)
            k += 1

        if k >= len(lines):
            break
        hi_px = _read_price_token(lines[k])
        k += 1
        if k < len(lines) and _pct_from_line(lines[k]) is not None:
            k += 1
        if k >= len(lines):
            break
        lo_px = _read_price_token(lines[k])
        k += 1
        if k < len(lines) and _pct_from_line(lines[k]) is not None:
            k += 1

        # MFE / MAE = retorno % da posição no melhor/pior extreme (vs entrada)
        if side == "COMPRA":
            mfe_pct = ((hi_px - entry) / entry) * 100
            mae_pct = ((lo_px - entry) / entry) * 100
        else:
            mfe_pct = ((entry - lo_px) / entry) * 100
            mae_pct = ((entry - hi_px) / entry) * 100

        trades.append(
            Trade(
                symbol=symbol,
                side=side,
                entry=entry,
                exit_px=exit_px,
                high=hi_px,
                low=lo_px,
                mfe_pct=mfe_pct,
                mae_pct=mae_pct,
                actual_ret_pct=act,
            )
        )

        while k < len(lines) and not sym_re.match(lines[k]):
            k += 1
        i = k

    return trades


def pnl_with_partials(
    t: Trade,
    sl_pct: float,
    tp1: float,
    tp2: float,
    w1: float,
    w2: float,
) -> float:
    """Retorno % sobre a posição total ( média ponderada das fatias )."""
    if t.side == "COMPRA":
        hit_sl = t.mae_pct <= -sl_pct
    else:
        hit_sl = t.mae_pct <= -sl_pct

    if hit_sl:
        return -sl_pct

    rest = 1.0
    total = 0.0
    # TP1
    if t.mfe_pct >= tp1 and rest > 1e-9:
        take = min(w1, rest)
        total += take * tp1
        rest -= take
    # TP2 (fracção do original position)
    if t.mfe_pct >= tp2 and rest > 1e-9:
        take = min(w2, rest)
        total += take * tp2
        rest -= take
    # resto ao fecho real
    total += rest * t.actual_ret_pct
    return total


def summarize(trades: list[Trade]) -> None:
    act = sum(t.actual_ret_pct for t in trades)
    print(f"Trades: {len(trades)} | soma retornos observados %: {act:.2f}% | média {act/len(trades):.3f}%")
    wins = sum(1 for t in trades if t.actual_ret_pct > 0)
    print(f"Win rate observado: {wins}/{len(trades)} = {100*wins/len(trades):.1f}%")

    sl_grid = [3, 4, 5, 6, 7, 8, 10, 12, 15]
    # Dois TP parciais — grelhas (TP1 menor, TP2 maior); pesos típicos 40/40/20 runners
    tp_pairs = [(6, 12), (8, 16), (10, 20), (12, 25), (15, 30), (20, 40), (30, 50), (44, 44)]
    weights = [(0.40, 0.40), (0.50, 0.30), (0.60, 0.30)]

    print("\n--- Grelha: SL × (TP1,TP2,w1,w2), restante no fecho real (proxy 24h/dinâmico) ---\n")

    best: list[tuple[float, tuple]] = []

    for w1, w2 in weights:
        for tp1, tp2 in tp_pairs:
            if tp2 < tp1:
                continue
            row = []
            for sl in sl_grid:
                s = sum(pnl_with_partials(t, sl, tp1, tp2, w1, w2) for t in trades)
                row.append((sl, s))
                best.append((s, (sl, tp1, tp2, w1, w2)))
            line = ", ".join(f"SL{s:g}%→Σ{smm:.0f}" for s, smm in row)
            print(f"TP1={tp1}% TP2={tp2}%  w=( {w1:.0f} , {w2:.0f} ) | {line}")

    best.sort(reverse=True, key=lambda x: x[0])
    print("\n--- Top 12 combinações por soma total % ---")
    seen = set()
    for total, cfg in best:
        key = cfg
        if key in seen:
            continue
        seen.add(key)
        print(f"Σ={total:.1f}%  SL={cfg[0]}%  TP1={cfg[1]}% TP2={cfg[2]}%  w1={cfg[3]:.2f} w2={cfg[4]:.2f}")
        if len(seen) >= 12:
            break

    # Produto actual aproximado: um TP a 44% 60% posição (só 1 parcial no código)
    print("\n--- Aproximação config produto: 1 TP a 44% em 60% posição ---")
    for sl in sl_grid:
        s_single = sum(
            pnl_with_partials(t, sl, 44.0, 44.0, 0.60, 0.0) for t in trades
        )
        print(f"  SL {sl}%  → soma Σ {s_single:.1f}%")


# Colar dados abaixo (entre TRADES_BEGIN / END) quando correr standalone.
TRADES_PLACEHOLDER = "TRADES_BEGIN\nTRADES_END"


if __name__ == "__main__":
    import sys
    from pathlib import Path

    path = Path(__file__).resolve()
    blob_file = path.parent / "ma12x30_trades_paste.txt"
    blob = blob_file.read_text(encoding="utf-8") if blob_file.exists() else ""
    if not blob.strip():
        blob = sys.stdin.read()
    trades = parse_trades_blob(blob)
    if len(trades) < 50:
        print("Poucos trades parseados;", len(trades), "— verificar ficheiro ma12x30_trades_paste.txt")
        if trades:
            for x in trades[:3]:
                print(x)
        sys.exit(1)
    summarize(trades)
