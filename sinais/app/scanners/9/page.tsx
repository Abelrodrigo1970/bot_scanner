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
  high6m: number;
  high6mAt: string;
  low6m: number;
  low6mAt: string;
  rangePct: number;
  pctFromHigh: number;
  pctFromLow: number;
  avgClose6m: number;
  pctFromAvg: number;
  midRange: number;
  rangePositionPct: number;
  turnover24h: number;
  tradingViewUrl: string;
};

type SortKey =
  | 'rank'
  | 'symbol'
  | 'price'
  | 'rangePct'
  | 'high6m'
  | 'pctFromHigh'
  | 'low6m'
  | 'pctFromLow'
  | 'avgClose6m'
  | 'pctFromAvg'
  | 'rangePositionPct'
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

export default function Scanner9Page() {
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [scanSource, setScanSource] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('rangePct');
  const [sortAsc, setSortAsc] = useState(false);
  const [filter, setFilter] = useState('');

  const fetchCache = useCallback(async () => {
    try {
      setError('');
      const response = await fetch('/api/scanner9');
      const data = await response.json();
      if (response.ok && data.success) {
        setItems(data.items || []);
        setScanSource(data.source ?? null);
        setCandidates(typeof data.candidates === 'number' ? data.candidates : null);
        setLastUpdate(data.scannedAt ? new Date(data.scannedAt) : null);
      } else {
        setError(data.error || 'Erro ao carregar Scanner 9');
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
      const response = await fetch('/api/scanner9', { method: 'POST' });
      const data = await response.json();
      if (response.status === 202 && (data.background || data.busy)) {
        setError(`⏳ ${data.message || 'Scan em background. Recarregue em 1–3 minutos.'}`);
      } else if (response.ok && data.success && data.items) {
        setItems(data.items);
        setLastUpdate(new Date(data.scannedAt || Date.now()));
        setScanSource(data.source ?? 'ui/scanner9');
        setCandidates(typeof data.candidates === 'number' ? data.candidates : null);
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
    const filtered = q
      ? items.filter((r) => r.symbol.includes(q) || r.baseAsset.toUpperCase().includes(q))
      : items;
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
  }, [items, filter, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(key === 'symbol' || key === 'rank');
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
              Scanner 9 — Maior amplitude 6 meses
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-2xl">
              Os 30 perpétuos USDT com a maior diferença entre a máxima e a mínima dos últimos 6
              meses. Preço actual, distância à máxima e à mínima, e média do período.
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
              Universo: perpétuos lineares <strong>USDT</strong> da Bybit (cripto, em Trading) com
              volume 24h ≥ <strong>$1M</strong> e pelo menos ~6 meses de histórico (exclui listagens
              recentes)
            </li>
            <li>
              <strong>Máxima / mínima 6m</strong>: high e low das velas <strong>1D</strong> dos
              últimos 182 dias (inclui o dia actual)
            </li>
            <li>
              <strong>Amplitude</strong> = máxima ÷ mínima − 1 · ordenado da maior para a menor ·
              top 30
            </li>
            <li>
              <strong>% vs máx.</strong> e <strong>% vs mín.</strong> = preço actual comparado com a
              máxima e a mínima · <strong>Média 6m</strong> = média dos fechos diários ·{' '}
              <strong>Posição</strong> = onde o preço está na amplitude (0% = mínima, 100% = máxima)
            </li>
            <li>Actualização: manual nesta página (cache na BD). Sem estratégia ligada — só dados.</li>
          </ul>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar símbolo…"
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          />
          {lastUpdate && (
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Última actualização: {lastUpdate.toLocaleString('pt-PT')}
              {scanSource ? ` · origem: ${scanSource}` : ''}
              {candidates != null ? ` · ${candidates} candidatos analisados` : ''}
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
            Nenhum scan gravado. Clica em &quot;Atualizar scan&quot; (demora 1–3 minutos).
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
                    {th('price', 'Preço')}
                    {th('rangePct', 'Amplitude')}
                    {th('high6m', 'Máx. 6m')}
                    {th('pctFromHigh', '% vs máx.')}
                    {th('low6m', 'Mín. 6m')}
                    {th('pctFromLow', '% vs mín.')}
                    {th('avgClose6m', 'Média 6m')}
                    {th('pctFromAvg', '% vs média')}
                    {th('rangePositionPct', 'Posição')}
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
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-gray-900 dark:text-white">
                        ${formatPrice(item.price)}
                      </td>
                      <td className="px-3 py-3 text-right text-sm font-semibold text-violet-700 dark:text-violet-300">
                        {formatPct(item.rangePct, 0)}
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-gray-700 dark:text-gray-300">
                        ${formatPrice(item.high6m)}
                        <div className="text-[11px] text-gray-400">{formatDate(item.high6mAt)}</div>
                      </td>
                      <td className={`px-3 py-3 text-right text-sm font-semibold ${pctClass(item.pctFromHigh)}`}>
                        {formatPct(item.pctFromHigh)}
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-gray-700 dark:text-gray-300">
                        ${formatPrice(item.low6m)}
                        <div className="text-[11px] text-gray-400">{formatDate(item.low6mAt)}</div>
                      </td>
                      <td className={`px-3 py-3 text-right text-sm font-semibold ${pctClass(item.pctFromLow)}`}>
                        {formatPct(item.pctFromLow)}
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-gray-700 dark:text-gray-300">
                        ${formatPrice(item.avgClose6m)}
                      </td>
                      <td className={`px-3 py-3 text-right text-sm ${pctClass(item.pctFromAvg)}`}>
                        {formatPct(item.pctFromAvg)}
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-gray-700 dark:text-gray-300">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                            <div
                              className="h-full bg-violet-500"
                              style={{ width: `${Math.min(100, Math.max(0, item.rangePositionPct))}%` }}
                            />
                          </div>
                          <span className="w-10 text-right">{item.rangePositionPct.toFixed(0)}%</span>
                        </div>
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
