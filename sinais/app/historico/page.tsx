'use client';

import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';
import DirectionTag from '@/components/DirectionTag';

interface Signal {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  timeframe: string;
  strategyName: string;
  entryPrice: number;
  stopLoss: number;
  target1: number | null;
  strength: number;
  status?: string;
  generatedAt: string;
  price24h: number | null;
  result24h: number | null;
  status24h: string | null;
}

export default function HistoricoPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    symbol: '',
    direction: '',
    strategy: '',
    timeframe: '',
    dateFrom: '',
    dateTo: '',
    onlyOpen: false, // Filtro para mostrar apenas sinais sem resultado 24h
  });

  useEffect(() => {
    fetchSignals();
  }, [filters]);

  const fetchSignals = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('limit', '500');
      params.append('minStrength', '70'); // Apenas sinais com força >= 70
      if (filters.symbol) params.append('symbol', filters.symbol);
      if (filters.direction) params.append('direction', filters.direction);
      if (filters.strategy) params.append('strategy', filters.strategy);
      if (filters.timeframe) params.append('timeframe', filters.timeframe);
      if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.append('dateTo', filters.dateTo);
      if (filters.onlyOpen) params.append('onlyOpen', 'true');

      const response = await fetch(`/api/signals?${params.toString()}`);
      const data = await response.json();

      if (response.ok) {
        setSignals(data.signals);
      }
    } catch (error) {
      console.error('Erro ao buscar histórico:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    }).format(price);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  };

  const getVariationPercent = (signal: Signal): number | null => {
    if (signal.status24h !== 'CLOSED' || signal.result24h === null || !signal.entryPrice) return null;
    return (signal.result24h / signal.entryPrice) * 100;
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">Histórico</h1>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-6 border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Filtros</h2>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <input
              type="text"
              placeholder="Par (BTC, ETH...)"
              value={filters.symbol}
              onChange={(e) => setFilters({ ...filters, symbol: e.target.value })}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <select
              value={filters.direction}
              onChange={(e) => setFilters({ ...filters, direction: e.target.value })}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">Todas direções</option>
              <option value="BUY">Compra</option>
              <option value="SELL">Venda</option>
            </select>
            <input
              type="text"
              placeholder="Estratégia"
              value={filters.strategy}
              onChange={(e) => setFilters({ ...filters, strategy: e.target.value })}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <select
              value={filters.timeframe}
              onChange={(e) => setFilters({ ...filters, timeframe: e.target.value })}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">Todos timeframes</option>
              <option value="1m">1m</option>
              <option value="5m">5m</option>
              <option value="15m">15m</option>
              <option value="1h">1h</option>
              <option value="4h">4h</option>
              <option value="1d">1d</option>
            </select>
            <input
              type="date"
              placeholder="Data inicial"
              value={filters.dateFrom}
              onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <div className="flex flex-col gap-2">
              <input
                type="date"
                placeholder="Data final"
                value={filters.dateTo}
                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={filters.onlyOpen}
                  onChange={(e) => setFilters({ ...filters, onlyOpen: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Apenas sem resultado 24h
                </span>
              </label>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">Carregando histórico...</p>
          </div>
        ) : signals.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">Nenhum sinal encontrado no histórico.</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden border border-gray-200 dark:border-gray-700">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Par
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Dir
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Estratégia
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      TF
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Entrada
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      24h
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Força
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Data/Hora
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {signals.map((signal) => (
                    <tr key={signal.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                        {signal.symbol}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        <DirectionTag direction={signal.direction} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        <div className="max-w-[120px] truncate" title={signal.strategyName}>
                          {signal.strategyName}
                        </div>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {signal.timeframe}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        ${formatPrice(signal.entryPrice)}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-sm font-medium">
                        {(() => {
                          const pct = getVariationPercent(signal);
                          if (pct === null) return <span className="text-gray-400 dark:text-gray-500">-</span>;
                          const isPositive = pct >= 0;
                          return (
                            <span className={isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                              {isPositive ? '+' : ''}{pct.toFixed(2)}%
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm">
                        {signal.status24h === 'CLOSED' && signal.price24h !== null && signal.result24h !== null ? (
                          <div className="min-w-[100px]">
                            <div className="text-xs text-gray-600 dark:text-gray-400">
                              ${formatPrice(signal.price24h)}
                            </div>
                            <div className={`text-xs font-medium ${signal.result24h >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                              {signal.result24h >= 0 ? '+' : ''}{formatPrice(signal.result24h)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400 dark:text-gray-500">-</span>
                        )}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {signal.strength}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                        {formatDate(signal.generatedAt)}
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



