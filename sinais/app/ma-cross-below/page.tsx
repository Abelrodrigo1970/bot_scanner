'use client';

import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';

interface MaCrossBelowItem {
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

export default function MaCrossBelowPage() {
  const [items, setItems] = useState<MaCrossBelowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchFromDb = async () => {
    try {
      const response = await fetch('/api/ma-cross-below');
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
      const response = await fetch('/api/ma-cross-below', { method: 'POST' });
      const data = await response.json();
      if (response.ok && data.success) {
        setItems(data.items || []);
        setLastUpdate(new Date());
      } else {
        setError(data.error || data.details || 'Erro ao atualizar');
      }
    } catch {
      setError('Erro ao atualizar. Tente novamente.');
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
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              MA Cross Proximidade
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Criptos onde a MA30 está a uma distância de ±4% da MA200 — cruzamento iminente (15m)
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
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

        {/* Info box */}
        <div className="mb-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">Como funciona o scan</h2>
          <ul className="text-xs text-blue-700 dark:text-blue-400 space-y-1 list-disc list-inside">
            <li>Analisa as top 300 criptos por volume na Binance Futures — <strong>timeframe 15m</strong></li>
            <li>Filtra as que têm a <strong>MA30 a uma distância entre -4% e +4% da MA200</strong> — cruzamento iminente</li>
            <li>Distância positiva (MA30 acima MA200) → potencial Golden Cross · Negativa → potencial Death Cross</li>
            <li>Ordenado pela distância absoluta mais pequena (MA30 mais próxima de cruzar a MA200)</li>
            <li>Esta lista pode ser usada por estratégias como universo de símbolos a analisar</li>
          </ul>
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
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {items.length} símbolos encontrados
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">#</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Símbolo</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Preço</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">MA30</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">MA200</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Preço vs MA200</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">MA30 vs MA200</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {items.map((item) => (
                    <tr key={item.symbol} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {item.rank}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">{item.symbol}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900 dark:text-white">
                        ${formatPrice(item.lastPrice)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-600 dark:text-gray-400">
                        ${formatPrice(item.ma30)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-600 dark:text-gray-400">
                        ${formatPrice(item.ma200)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                          {item.distPriceMa200.toFixed(2)}%
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                          +{item.distMa30Ma200.toFixed(2)}%
                        </span>
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
