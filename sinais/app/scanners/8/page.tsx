'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';

type Row = {
  rank: number;
  symbol: string;
  baseAsset: string;
  close: number;
  change24hPct: number | null;
  change1wPct: number | null;
  ema21: number | null;
  ema70: number | null;
  pctFromEma21: number | null;
  pctFromEma70: number | null;
  tradingViewUrl: string;
};

type SortKey =
  | 'rank'
  | 'symbol'
  | 'close'
  | 'change24hPct'
  | 'change1wPct'
  | 'ema21'
  | 'pctFromEma21'
  | 'ema70'
  | 'pctFromEma70';

function formatPrice(price: number) {
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(3);
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(8);
}

function formatPct(value: number | null, decimals = 2) {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

function pctClass(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'text-gray-400';
  return value >= 0
    ? 'text-green-600 dark:text-green-400'
    : 'text-red-600 dark:text-red-400';
}

export default function Scanner8Page() {
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [scanSource, setScanSource] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('change24hPct');
  const [sortAsc, setSortAsc] = useState(false);
  const [filter, setFilter] = useState('');

  const fetchCache = useCallback(async () => {
    try {
      setError('');
      const response = await fetch('/api/scanner8');
      const data = await response.json();
      if (response.ok && data.success) {
        setItems(data.items || []);
        setScanSource(data.source ?? null);
        if (data.scannedAt) setLastUpdate(new Date(data.scannedAt));
        else setLastUpdate(null);
      } else {
        setError(data.error || 'Erro ao carregar Scanner 8');
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
      const response = await fetch('/api/scanner8', { method: 'POST' });
      const data = await response.json();
      if (response.status === 202 && (data.background || data.busy)) {
        setError(`⏳ ${data.message || 'Scan em background. Recarregue em 2–3 minutos.'}`);
      } else if (response.ok && data.success && data.items) {
        setItems(data.items);
        setLastUpdate(new Date(data.scannedAt || Date.now()));
        setScanSource(data.source ?? 'ui/scanner8');
      } else {
        setError(data.error || data.message || 'Erro ao actualizar');
      }
    } catch {
      setError('Erro ao actualizar. O scan pode demorar vários minutos.');
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
      ? items.filter(
          (r) => r.symbol.includes(q) || r.baseAsset.toUpperCase().includes(q)
        )
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
      setSortAsc(key === 'symbol');
    }
  };

  const th = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <th
      className={`px-3 py-3 text-${align} text-xs font-medium text-gray-500 dark:text-gray-400 uppercase cursor-pointer select-none hover:text-violet-600`}
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
              Scanner 8 — Bybit Stocks
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-2xl">
              Perpétuos Bybit com <code className="text-xs">symbolType=stock</code> (TradFi).
              Variação 24h (ticker), 1 semana e EMA21 / EMA70 em velas diárias. Link directo para
              TradingView.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-6 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-400 text-white font-medium rounded-lg transition-colors shrink-0"
          >
            {refreshing ? 'A processar… (2–3 min)' : 'Atualizar scan'}
          </button>
        </div>

        <div className="mb-6 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-violet-800 dark:text-violet-300 mb-1">
            Regra do scan
          </h2>
          <ul className="text-xs text-violet-700 dark:text-violet-400 space-y-1 list-disc list-inside">
            <li>
              Universo: Bybit linear <strong>stock</strong> (estado Trading) — inclui US e outros
              listados como stock
            </li>
            <li>
              <strong>% 24h</strong> via ticker Bybit · <strong>% 1 semana</strong> = fecho diário vs
              há 7 velas
            </li>
            <li>
              <strong>EMA21</strong> e <strong>EMA70</strong> em velas <strong>1D</strong> (última
              vela fechada)
            </li>
            <li>
              Actualização: manual nesta página (cache na BD). Sem estratégia ligada — só dados.
            </li>
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
              {items.length > 0 ? ` · ${items.length} símbolos` : ''}
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
            Nenhum scan gravado. Clica em &quot;Atualizar scan&quot; (demora 2–3 minutos).
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
                    {th('close', 'Preço')}
                    {th('change24hPct', '24h')}
                    {th('change1wPct', '1 semana')}
                    {th('ema21', 'EMA21')}
                    {th('pctFromEma21', '% vs 21')}
                    {th('ema70', 'EMA70')}
                    {th('pctFromEma70', '% vs 70')}
                    <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      TV
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {sorted.map((item) => (
                    <tr
                      key={item.symbol}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <td className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {item.rank}
                      </td>
                      <td className="px-3 py-3 text-sm font-semibold text-gray-900 dark:text-white">
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
                        ${formatPrice(item.close)}
                      </td>
                      <td
                        className={`px-3 py-3 text-right text-sm font-semibold ${pctClass(item.change24hPct)}`}
                      >
                        {formatPct(item.change24hPct)}
                      </td>
                      <td
                        className={`px-3 py-3 text-right text-sm font-semibold ${pctClass(item.change1wPct)}`}
                      >
                        {formatPct(item.change1wPct)}
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-gray-600 dark:text-gray-400">
                        {item.ema21 != null ? `$${formatPrice(item.ema21)}` : '—'}
                      </td>
                      <td
                        className={`px-3 py-3 text-right text-sm ${pctClass(item.pctFromEma21)}`}
                      >
                        {formatPct(item.pctFromEma21)}
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-gray-600 dark:text-gray-400">
                        {item.ema70 != null ? `$${formatPrice(item.ema70)}` : '—'}
                      </td>
                      <td
                        className={`px-3 py-3 text-right text-sm ${pctClass(item.pctFromEma70)}`}
                      >
                        {formatPct(item.pctFromEma70)}
                      </td>
                      <td className="px-3 py-3 text-center text-sm">
                        <a
                          href={item.tradingViewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-violet-600 dark:text-violet-400 hover:underline font-medium"
                        >
                          abrir
                        </a>
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
