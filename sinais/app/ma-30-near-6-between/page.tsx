'use client';

import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';

interface Row {
  id?: string;
  symbol: string;
  lastPrice: number;
  ma30: number;
  ma200: number;
  distPriceMa200: number;
  distMa30Ma200: number;
  rank: number;
  updatedAt?: string;
}

export default function Ma30Near6BetweenPage() {
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchFromDb = async () => {
    try {
      const response = await fetch('/api/ma-30-near-6-between');
      const data = await response.json();
      if (response.ok && data.success) {
        setItems(data.items || []);
        if (data.fetchedAt) setLastUpdate(new Date(data.fetchedAt));
      } else {
        setError(data.error || 'Erro ao carregar dados');
      }
    } catch {
      setError('Erro ao carregar dados. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      setError('');
      const response = await fetch('/api/ma-30-near-6-between', { method: 'POST' });
      const data = await response.json();
      if (response.ok && data.success) {
        setItems(data.items || []);
        setLastUpdate(new Date());
      } else {
        setError(data.error || data.details || 'Erro ao actualizar');
      }
    } catch {
      setError('Erro ao actualizar. Tente novamente.');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchFromDb();
  }, []);

  const formatPrice = (price: number) => {
    if (price >= 1) return price.toFixed(4);
    if (price >= 0.01) return price.toFixed(5);
    return price.toFixed(8);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">MA30 entre −3% e −9% vs MA200 (1h)</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              SMA 30 e SMA 200 na vela 1h fechada; MA30 abaixo da MA200 com distância relativa entre <strong>−9%</strong> e <strong>−3%</strong> (inclusive)
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-6 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-400 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            {refreshing ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                A processar... (pode demorar ~60s)
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Atualizar Scan
              </>
            )}
          </button>
        </div>

        <div className="mb-6 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-violet-800 dark:text-violet-300 mb-1">Como funciona o scan</h2>
          <ul className="text-xs text-violet-800 dark:text-violet-300 space-y-1 list-disc list-inside">
            <li>Top 300 criptos por volume na Binance Futures — <strong>timeframe 1h</strong> (SMA 30 e SMA 200, como os outros menus)</li>
            <li>
              <strong>−9% ≤ (MA30 − MA200) / MA200 × 100 ≤ −3%</strong> (MA30 entre ~3% e ~9% abaixo da MA200)
            </li>
            <li>
              Ordenado do mais próximo de <strong>−3%</strong> para o mais próximo de <strong>−9%</strong>
            </li>
            <li>Guarda até <strong>300</strong> linhas após &quot;Atualizar Scan&quot;</li>
            <li>
              Esta lista alimenta o universo de símbolos das estratégias <strong>RSI</strong> (1h) e{' '}
              <strong>RSI 15m</strong> — sem dados aqui, esses crons não analisam pares para essas estratégias.
            </li>
          </ul>
        </div>

        {lastUpdate && (
          <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            Última actualização: {lastUpdate.toLocaleString('pt-PT')}
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">A carregar...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">
              Nenhum dado. Clica em &quot;Atualizar Scan&quot; para analisar as top 300 criptos.
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
              <span className="text-sm text-gray-600 dark:text-gray-400">{items.length} símbolos encontrados</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">#</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Símbolo</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Preço</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">MA30</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">MA200</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Preço vs MA200</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">MA30 vs MA200</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {items.map((item) => (
                    <tr key={item.symbol} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                      <td className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">{item.rank}</td>
                      <td className="px-6 py-4">
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">{item.symbol}</span>
                      </td>
                      <td className="px-6 py-4 text-right text-sm text-gray-900 dark:text-white">${formatPrice(item.lastPrice)}</td>
                      <td className="px-6 py-4 text-right text-sm text-gray-600 dark:text-gray-400">
                        ${formatPrice(item.ma30)}
                      </td>
                      <td className="px-6 py-4 text-right text-sm text-gray-600 dark:text-gray-400">
                        ${formatPrice(item.ma200)}
                      </td>
                      <td
                        className={`px-6 py-4 text-right text-sm font-semibold ${
                          item.distPriceMa200 >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {item.distPriceMa200 >= 0 ? '+' : ''}
                        {item.distPriceMa200.toFixed(2)}%
                      </td>
                      <td className="px-6 py-4 text-right text-sm font-semibold text-violet-600 dark:text-violet-400">
                        {item.distMa30Ma200 >= 0 ? '+' : ''}
                        {item.distMa30Ma200.toFixed(2)}%
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
