'use client';

import { useMemo, useState } from 'react';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';

interface ReportRow {
  day: string;
  strategyName: string;
  direction: 'BUY' | 'SELL';
  nr: number;
  winRate: number | null;
  lucro: number;
  wins: number;
  losses: number;
  breakeven: number;
  closed: number;
  open: number;
}

interface ReportResponse {
  totalSignals: number;
  rows: ReportRow[];
}

const todayInputValue = new Date().toISOString().slice(0, 10);

function fmtNumber(v: number | null, digits = 2) {
  if (v === null) return '-';
  return new Intl.NumberFormat('pt-PT', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

function directionBadge(direction: 'BUY' | 'SELL') {
  if (direction === 'BUY') {
    return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
  }
  return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
}

export default function RelatorioPage() {
  const [dateFrom, setDateFrom] = useState(todayInputValue);
  const [dateTo, setDateTo] = useState(todayInputValue);
  const [strategyFilter, setStrategyFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [totalSignals, setTotalSignals] = useState(0);
  const [allRows, setAllRows] = useState<ReportRow[]>([]);

  const rows = useMemo(
    () =>
      strategyFilter
        ? allRows.filter((r) => r.strategyName === strategyFilter)
        : allRows,
    [allRows, strategyFilter]
  );
  const hasRows = rows.length > 0;
  const strategyOptions = useMemo(
    () => Array.from(new Set(allRows.map((r) => r.strategyName))).sort((a, b) => a.localeCompare(b)),
    [allRows]
  );

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.total += row.nr;
        acc.closed += row.closed;
        acc.open += row.open;
        acc.sum24h += row.lucro;
        return acc;
      },
      { total: 0, closed: 0, open: 0, sum24h: 0 }
    );
  }, [rows]);

  const fetchReport = async () => {
    try {
      setLoading(true);
      setError('');
      setAllRows([]);

      const params = new URLSearchParams({ dateFrom, dateTo });
      if (strategyFilter) params.append('strategy', strategyFilter);
      const res = await fetch(`/api/reports/strategies?${params.toString()}`);
      const data: ReportResponse & { error?: string; details?: string } = await res.json();

      if (!res.ok) {
        setError(data.error || data.details || 'Erro ao carregar relatório');
        return;
      }

      setTotalSignals(data.totalSignals || 0);
      setAllRows(data.rows || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado ao carregar relatório.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Relatório por intervalo</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          Formato diário por estratégia (lógica de execução): só sinais fechados, força &gt;= 70 e lucro líquido com fees.
        </p>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-6 border border-gray-200 dark:border-gray-700">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data inicial</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data final</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Estratégia</label>
              <select
                value={strategyFilter}
                onChange={(e) => setStrategyFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">Todas</option>
                {strategyOptions.map((strategy) => (
                  <option key={strategy} value={strategy}>
                    {strategy}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <button
                onClick={fetchReport}
                disabled={loading}
                className="w-full md:w-auto px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg transition-colors"
              >
                {loading ? 'A gerar relatório...' : 'Gerar relatório'}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200">
            {error}
          </div>
        )}

        {hasRows && (
          <div className="mb-4 text-sm text-gray-700 dark:text-gray-300">
            <strong>Total de sinais no intervalo:</strong> {totalSignals} | <strong>Estratégia:</strong> {strategyFilter || 'Todas'} |{' '}
            <strong>Linhas (dia x estratégia x direção):</strong> {rows.length} |{' '}
            <strong>Fechados:</strong> {totals.closed} | <strong>Abertos:</strong> {totals.open} | <strong>Lucro total:</strong>{' '}
            {fmtNumber(totals.sum24h, 2)}%
          </div>
        )}

        {hasRows ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden border border-gray-200 dark:border-gray-700">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Dia</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Estratégia</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Direção</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Nr.</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Wins</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Losses</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Win rate</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Lucro Líquido</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {rows.map((row) => {
                    return (
                      <tr key={`${row.day}-${row.strategyName}-${row.direction}`} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-3 py-3 text-sm text-gray-900 dark:text-white">{row.day}</td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{row.strategyName}</td>
                        <td className="px-3 py-3 text-sm">
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${directionBadge(row.direction)}`}>{row.direction}</span>
                        </td>
                        <td className="px-3 py-3 text-sm text-right text-gray-700 dark:text-gray-300">{row.nr}</td>
                        <td className="px-3 py-3 text-sm text-right text-green-600 dark:text-green-400">{row.wins}</td>
                        <td className="px-3 py-3 text-sm text-right text-red-600 dark:text-red-400">{row.losses}</td>
                        <td className="px-3 py-3 text-sm text-right text-gray-700 dark:text-gray-300">{fmtNumber(row.winRate, 2)}%</td>
                        <td className="px-3 py-3 text-sm text-right text-gray-700 dark:text-gray-300">{fmtNumber(row.lucro, 2)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          !loading && (
            <div className="text-center py-12 text-gray-600 dark:text-gray-400">
              Seleciona o intervalo e clica em <strong>Gerar relatório</strong>.
            </div>
          )
        )}

        <Disclaimer />
      </main>
    </div>
  );
}

