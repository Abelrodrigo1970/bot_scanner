'use client';

import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';

interface TopVolatileItem {
  id?: string;
  symbol: string;
  high3m: number;
  low3m: number;
  volatilityPercent: number;
  lastPrice: number | null;
  rank: number;
  updatedAt?: string;
}

export default function TopVolateisPage() {
  const [topVolatile, setTopVolatile] = useState<TopVolatileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchFromDb = async () => {
    try {
      const response = await fetch('/api/top-movers');
      const data = await response.json();

      if (response.ok && data.success) {
        setTopVolatile(data.topVolatile || []);
        setSelectedSymbols([]);
        if (data.fetchedAt) {
          setLastUpdate(new Date(data.fetchedAt));
        }
      } else {
        const err = data.error || 'Erro ao carregar Top Voláteis';
        setError(data.hint ? `${err}. ${data.hint}` : err);
      }
    } catch (err) {
      setError('Erro ao carregar Top Voláteis. Tente novamente.');
      console.error('Erro:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      setError('');
      const response = await fetch('/api/top-movers', { method: 'POST' });
      const data = await response.json();

      if (response.ok && data.success) {
        setTopVolatile(data.topVolatile || []);
        setSelectedSymbols([]);
        setLastUpdate(new Date());
      } else {
        const err = data.error || data.details || 'Erro ao atualizar Top Voláteis';
        setError(data.hint ? `${err}. ${data.hint}` : err);
      }
    } catch (err) {
      setError('Erro ao atualizar Top Voláteis. Tente novamente.');
      console.error('Erro:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleSymbol = (symbol: string) => {
    setSelectedSymbols((prev) =>
      prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol]
    );
  };

  const handleRemoveSelected = async () => {
    if (selectedSymbols.length === 0) return;

    const confirmed = window.confirm(
      `Remover ${selectedSymbols.length} símbolo(s) da lista Top Voláteis?`
    );
    if (!confirmed) return;

    try {
      setRemoving(true);
      setError('');
      const response = await fetch('/api/top-movers/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: selectedSymbols }),
      });
      const data = await response.json();

      if (response.ok && data.success) {
        setTopVolatile(data.topVolatile || []);
        setSelectedSymbols([]);
      } else {
        const err = data.error || data.details || 'Erro ao remover símbolos';
        setError(data.hint ? `${err}. ${data.hint}` : err);
      }
    } catch (err) {
      setError('Erro ao remover símbolos. Tente novamente.');
      console.error('Erro:', err);
    } finally {
      setRemoving(false);
    }
  };

  useEffect(() => {
    fetchFromDb();
  }, []);

  const formatPrice = (price: number) => {
    if (price >= 1) {
      return price.toFixed(2);
    } else if (price >= 0.01) {
      return price.toFixed(4);
    } else {
      return price.toFixed(8);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Top Voláteis
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              As 20 criptos com maior diferença entre máxima e mínima dos últimos 3 meses - Binance Futures
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRemoveSelected}
              disabled={removing || selectedSymbols.length === 0}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-medium rounded-lg transition-colors"
            >
              {removing ? 'A remover...' : `Eliminar selecionadas (${selectedSymbols.length})`}
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
            >
              {refreshing ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  A processar... (pode demorar ~30s)
                </>
              ) : (
                <>
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  Atualizar Top Volatilidade
                </>
              )}
            </button>
          </div>
        </div>

        {lastUpdate && (
          <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            Última atualização: {lastUpdate.toLocaleString('pt-PT')}
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">Carregando Top Voláteis...</p>
          </div>
        ) : topVolatile.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">
              Nenhum dado. Clica em &quot;Atualizar Top Volatilidade&quot; para analisar ~200 criptos e gravar as 20 mais voláteis.
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Sel.
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      #
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Símbolo
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Volatilidade % (3 meses)
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Máxima (3m)
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Mínima (3m)
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Último Preço
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {topVolatile.map((item) => (
                    <tr
                      key={item.symbol}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <td className="px-3 py-4 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={selectedSymbols.includes(item.symbol)}
                          onChange={() => toggleSymbol(item.symbol)}
                          className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                        {item.rank}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                          {item.symbol}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                          {item.volatilityPercent.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-600 dark:text-gray-400">
                        ${formatPrice(item.high3m)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-600 dark:text-gray-400">
                        ${formatPrice(item.low3m)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900 dark:text-white">
                        {item.lastPrice != null ? `$${formatPrice(item.lastPrice)}` : '-'}
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
