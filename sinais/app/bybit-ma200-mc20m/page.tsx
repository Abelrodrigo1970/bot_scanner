'use client';

import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';

interface BybitMa200Mc20mItem {
  symbol: string;
  baseAsset: string;
  marketCap: number;
  lastPrice: number;
  ma200: number;
  distPriceMa200: number;
  rank: number;
}

export default function BybitMa200Mc20mPage() {
  const [items, setItems] = useState<BybitMa200Mc20mItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchFromDb = async () => {
    try {
      const response = await fetch('/api/bybit-ma200-mc20m');
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
      const baselineFetchedAt = lastUpdate?.toISOString() ?? null;

      const response = await fetch('/api/bybit-ma200-mc20m', { method: 'POST' });
      const data = await response.json();

      if (response.status === 401) {
        setError(data.error || 'Não autorizado');
        return;
      }

      if (!response.ok || data.success === false) {
        setError(data.error || data.details || 'Erro ao atualizar');
        return;
      }

      // Scan pesado corre em background (evita 503 por timeout do proxy).
      if (data.skipped) {
        setError(data.message || 'Atualização já em curso.');
        return;
      }

      const pollMs = 5000;
      const maxAttempts = 48;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, pollMs));
        const checkRes = await fetch('/api/bybit-ma200-mc20m');
        const checkData = await checkRes.json();
        if (checkRes.ok && checkData.success) {
          const nextFetchedAt = checkData.fetchedAt ?? null;
          if (nextFetchedAt != null && nextFetchedAt !== baselineFetchedAt) {
            setItems(checkData.items || []);
            setLastUpdate(new Date(checkData.fetchedAt));
            return;
          }
        }
      }

      setError(
        'O scan ainda não reportou dados novos. Espera 1–2 minutos e usa novamente «Atualizar Scan» ou recarrega a página.'
      );
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

  const formatMarketCap = (value: number) => {
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
    return value.toFixed(0);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Bybit Volume 1h (500k) + MA200 (1h)
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Criptos listadas na Bybit com turnover da última 1h acima de 500k USDT e preço acima da MA200 (1h)
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            {refreshing ? 'A processar...' : 'Atualizar Scan'}
          </button>
        </div>

        <div className="mb-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">Como funciona o scan</h2>
          <ul className="text-xs text-blue-700 dark:text-blue-400 space-y-1 list-disc list-inside">
            <li>Universo: símbolos USDT Perpetual em estado Trading na Bybit</li>
            <li>Liquidez: turnover da última vela 1h da Bybit, apenas ativos com turnover maior ou igual a 500 mil USDT</li>
            <li>Técnico: timeframe 1h na Bybit, preço de fecho acima da MA200 (vela fechada)</li>
            <li>Ordenação: turnover 1h descendente</li>
            <li>
              «Atualizar Scan» corre vários minutos no servidor; a página espera até a BD mudar (evita erro 503 por timeout).
            </li>
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
              Nenhum dado. Clica em &quot;Atualizar Scan&quot; para executar o filtro.
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
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Base</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Turnover 1h</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Preço</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">MA200</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Preço vs MA200</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {items.map((item) => (
                    <tr key={item.symbol} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{item.rank}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-white">{item.symbol}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">{item.baseAsset}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900 dark:text-white">${formatMarketCap(item.marketCap)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900 dark:text-white">${formatPrice(item.lastPrice)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-600 dark:text-gray-400">${formatPrice(item.ma200)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold text-green-600 dark:text-green-400">
                        +{item.distPriceMa200.toFixed(2)}%
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
