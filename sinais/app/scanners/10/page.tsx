'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';

type Row = {
  rank: number;
  symbol: string;
  baseAsset: string;
  price: number;
  score: number;
  stage: 'ignition' | 'early';
  kind: 'rise' | 'bounce';
  daysFromLow: number;
  lowAt: string;
  highAt: string;
  pctFromLow: number;
  washPct: number;
  fresh90dLow: boolean;
  d1Green: boolean;
  d1Rsi: number | null;
  d1VolX: number | null;
  d1AboveEma12: boolean | null;
  d1AboveEma21: boolean | null;
  d1Ema12gt21: boolean | null;
  h4Rsi: number | null;
  h4AboveEma21: boolean | null;
  h4Ema12gt21: boolean | null;
  h4AboveEma50: boolean | null;
  btcDayPct: number | null;
  change24hPct: number | null;
  turnover24h: number;
  tradingViewUrl: string;
};

type SortKey =
  | 'rank'
  | 'symbol'
  | 'score'
  | 'daysFromLow'
  | 'pctFromLow'
  | 'h4Rsi'
  | 'd1Rsi'
  | 'd1VolX'
  | 'change24hPct'
  | 'turnover24h';

function formatPrice(price: number) {
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(3);
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(8);
}

function formatPct(value: number | null, decimals = 1) {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

function formatTurnover(v: number) {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${(v / 1e3).toFixed(0)}k`;
}

function formatDate(d: string) {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y.slice(2)}`;
}

function pctClass(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'text-gray-400';
  return value >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
}

function yn(v: boolean | null) {
  if (v == null) return '—';
  return v ? 'sim' : 'não';
}

export default function Scanner10Page() {
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [scanSource, setScanSource] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<number | null>(null);
  const [prefiltered, setPrefiltered] = useState<number | null>(null);
  const [btcDayPct, setBtcDayPct] = useState<number | null>(null);
  const [btcOk, setBtcOk] = useState<boolean | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortAsc, setSortAsc] = useState(false);
  const [filter, setFilter] = useState('');
  const [stageFilter, setStageFilter] = useState<'all' | 'ignition' | 'early'>('all');

  const applyPayload = (data: Record<string, unknown>) => {
    setItems((data.items as Row[]) || []);
    setScanSource((data.source as string) ?? null);
    setCandidates(typeof data.candidates === 'number' ? data.candidates : null);
    setPrefiltered(typeof data.prefiltered === 'number' ? data.prefiltered : null);
    setBtcDayPct(typeof data.btcDayPct === 'number' ? data.btcDayPct : null);
    setBtcOk(typeof data.btcOk === 'boolean' ? data.btcOk : null);
    setLastUpdate(data.scannedAt ? new Date(String(data.scannedAt)) : null);
  };

  const fetchCache = useCallback(async () => {
    try {
      setError('');
      const response = await fetch('/api/scanner10');
      const data = await response.json();
      if (response.ok && data.success) {
        applyPayload(data);
      } else {
        setError(data.error || 'Erro ao carregar Scanner 10');
        setItems([]);
      }
    } catch {
      setError('Erro ao carregar dados. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      setError('');
      const response = await fetch('/api/scanner10', { method: 'POST' });
      const data = await response.json();
      if (response.status === 202 && (data.background || data.busy)) {
        setError(`⏳ ${data.message || 'Scan em background. Recarregue em 1–3 minutos.'}`);
      } else if (response.ok && data.success && data.items) {
        applyPayload(data);
      } else {
        setError(data.error || data.message || 'Erro ao actualizar');
      }
    } catch {
      setError('Erro ao actualizar. O scan pode demorar alguns minutos.');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchCache();
  }, [fetchCache]);

  const sorted = useMemo(() => {
    const q = filter.trim().toUpperCase();
    const filtered = items.filter((r) => {
      if (stageFilter !== 'all' && r.stage !== stageFilter) return false;
      if (!q) return true;
      return r.symbol.includes(q) || r.baseAsset.toUpperCase().includes(q);
    });
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = typeof av === 'number' && Number.isFinite(av) ? av : sortAsc ? Infinity : -Infinity;
      const bn = typeof bv === 'number' && Number.isFinite(bv) ? bv : sortAsc ? Infinity : -Infinity;
      return sortAsc ? an - bn : bn - an;
    });
    return copy;
  }, [items, filter, stageFilter, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(key === 'symbol' || key === 'rank' || key === 'daysFromLow');
    }
  };

  const th = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <th
      className={`px-3 py-3 text-${align} text-xs font-medium text-gray-500 dark:text-gray-400 uppercase cursor-pointer select-none hover:text-violet-600 whitespace-nowrap`}
      onClick={() => toggleSort(key)}
    >
      {label}
      {sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : ''}
    </th>
  );

  const ignitionN = items.filter((r) => r.stage === 'ignition').length;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-start gap-4 mb-6 flex-wrap">
          <div>
            <Link
              href="/scanners"
              className="text-sm text-violet-600 dark:text-violet-400 hover:underline mb-2 inline-block"
            >
              ← Todos os scanners
            </Link>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Scanner 10 — Caça-rali (ignição)
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-2xl">
              Perpétuos USDT que acabaram de sair de um mínimo de 30 dias (queda ≥12%) e já têm
              o stack 4H do estudo Scanner 9: preço &gt; EMA21, EMA12 &gt; EMA21, RSI ≥ 50. Sem
              estratégia ligada — só candidatos.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-6 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-400 text-white font-medium rounded-lg transition-colors shrink-0"
          >
            {refreshing ? 'A processar… (1–3 min)' : 'Atualizar scan'}
          </button>
        </div>

        <div className="mb-6 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-violet-800 dark:text-violet-300 mb-1">
            Regra do scan
          </h2>
          <ul className="text-xs text-violet-700 dark:text-violet-400 space-y-1 list-disc list-inside">
            <li>
              Universo: perps USDT Bybit (cripto, Trading), volume 24h ≥ <strong>$1M</strong>, ≥80
              velas 1D
            </li>
            <li>
              Mínimo de <strong>30 dias</strong> há 0–15 dias, queda high→low ≥ <strong>12%</strong>,
              preço ainda &lt; +55% desse low
            </li>
            <li>
              <strong>4H obrigatório</strong>: fecho &gt; EMA21 + EMA12 &gt; EMA21 + RSI ≥ 50
              (score sobe se RSI ≥ 55 / 60)
            </li>
            <li>
              <strong>1D confirma</strong> (sobe o score): vela verde, vol ≥ 2× MA20, acima EMA12/21
            </li>
            <li>
              Rejeita bounce de liquidação: máxima 90d antes do mínimo e Daily ainda &lt; EMA21 com
              RSI &lt; 50
            </li>
            <li>
              BTC do dia ≥ <strong>−1%</strong> — no estudo 95% dos ralis arrancaram assim
            </li>
            <li>
              Score: quanto mais cedo no low + mais confirmações 1D/4H. Bónus se o mínimo de 90d
              também for recente. Ignição = ≤9 dias; cedo = 10–15 dias
            </li>
          </ul>
        </div>

        {btcOk === false && (
          <div className="mb-4 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-900 dark:text-red-100 text-sm">
            BTC do dia {formatPct(btcDayPct)} — abaixo de −1%. O scan não lista candidatos (no
            estudo quase nenhum rali começou em dump do BTC).
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar símbolo…"
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          />
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as typeof stageFilter)}
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value="all">Todas as fases</option>
            <option value="ignition">Só ignição (≤9d)</option>
            <option value="early">Só cedo (10–15d)</option>
          </select>
          {lastUpdate && (
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Última actualização: {lastUpdate.toLocaleString('pt-PT')}
              {scanSource ? ` · origem: ${scanSource}` : ''}
              {candidates != null ? ` · ${candidates} univ.` : ''}
              {prefiltered != null ? ` · ${prefiltered} pré-filtro 1D` : ''}
              {btcDayPct != null ? ` · BTC ${formatPct(btcDayPct)}` : ''}
              {items.length ? ` · ${ignitionN} ignição / ${items.length - ignitionN} cedo` : ''}
            </span>
          )}
        </div>

        {error && (
          <div className="mb-4 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-center py-12 text-gray-600 dark:text-gray-400">A carregar...</p>
        ) : items.length === 0 ? (
          <p className="text-center py-12 text-gray-600 dark:text-gray-400">
            Nenhum candidato. Clica em &quot;Atualizar scan&quot; (demora 1–3 minutos), ou BTC está
            a cair / nenhum par passou o stack 4H.
          </p>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {sorted.length} / {items.length} símbolos
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    {th('rank', '#', 'left')}
                    {th('symbol', 'Símbolo', 'left')}
                    {th('score', 'Score')}
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">
                      Fase
                    </th>
                    {th('daysFromLow', '+d low')}
                    {th('pctFromLow', '% vs mín.')}
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">
                      Wash 30d
                    </th>
                    {th('h4Rsi', 'RSI 4H')}
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">
                      4H &gt;50
                    </th>
                    {th('d1Rsi', 'RSI 1D')}
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">
                      1D
                    </th>
                    {th('d1VolX', 'Vol×')}
                    {th('change24hPct', '% 24h')}
                    {th('turnover24h', 'Vol 24h')}
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {sorted.map((item) => (
                    <tr key={item.symbol} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                      <td className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">{item.rank}</td>
                      <td className="px-3 py-3 text-sm font-semibold">
                        <a
                          href={item.tradingViewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-violet-600 dark:text-violet-400 hover:underline"
                        >
                          {item.symbol}
                        </a>
                        <div className="text-[11px] text-gray-400">${formatPrice(item.price)}</div>
                      </td>
                      <td className="px-3 py-3 text-right text-sm font-semibold text-violet-700 dark:text-violet-300">
                        {item.score}
                      </td>
                      <td className="px-3 py-3 text-sm">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium ${
                            item.stage === 'ignition'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                          }`}
                        >
                          {item.stage === 'ignition' ? 'ignição' : 'cedo'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-gray-700 dark:text-gray-300">
                        {item.daysFromLow}d
                        <div className="text-[11px] text-gray-400">{formatDate(item.lowAt)}</div>
                      </td>
                      <td className={`px-3 py-3 text-right text-sm font-semibold ${pctClass(item.pctFromLow)}`}>
                        {formatPct(item.pctFromLow)}
                        {item.fresh90dLow ? (
                          <div className="text-[10px] text-emerald-600 dark:text-emerald-400">low 90d</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-gray-600 dark:text-gray-400">
                        {formatPct(item.washPct, 0)}
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-gray-900 dark:text-white">
                        {item.h4Rsi ?? '—'}
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-gray-600 dark:text-gray-400">
                        {yn(item.h4AboveEma50)}
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-gray-700 dark:text-gray-300">
                        {item.d1Rsi ?? '—'}
                      </td>
                      <td className="px-3 py-3 text-sm">
                        <div className="flex flex-wrap gap-1">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] ${
                              item.d1Green
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                                : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                            }`}
                          >
                            {item.d1Green ? 'verde' : 'vermelha'}
                          </span>
                          {item.d1AboveEma21 ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300">
                              &gt;EMA21
                            </span>
                          ) : null}
                          {item.kind === 'bounce' ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                              bounce
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-gray-700 dark:text-gray-300">
                        {item.d1VolX != null ? `${item.d1VolX.toFixed(1)}×` : '—'}
                      </td>
                      <td className={`px-3 py-3 text-right text-sm font-semibold ${pctClass(item.change24hPct)}`}>
                        {formatPct(item.change24hPct)}
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-gray-500 dark:text-gray-400">
                        {formatTurnover(item.turnover24h)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <Disclaimer />
      </main>
    </div>
  );
}
