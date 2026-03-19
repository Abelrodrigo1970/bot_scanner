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
  price24h: number | null;
  result24h: number | null;
  status24h: string | null;
  high24h: number | null;
  low24h: number | null;
  generatedAt: string;
}

export default function ResultadosPage() {
  interface SignalWithResult extends Signal {
    netResult: number;
  }

  const [signals, setSignals] = useState<SignalWithResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    symbol: '',
    direction: '',
    strategy: '',
    timeframe: '',
    dateFrom: '',
    dateTo: '',
  });
  const [stats, setStats] = useState({
    total: 0,
    lucros: 0,
    prejuizos: 0,
    totalLucro: 0,
    totalPrejuizo: 0,
    winRate: 0,
  });

  useEffect(() => {
    fetchSignals();
  }, [filters]);

  const fetchSignals = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('limit', '1000');
      params.append('minStrength', '70');
      params.append('onlyClosed', 'true'); // Buscar apenas sinais com resultado 24h
      if (filters.symbol) params.append('symbol', filters.symbol);
      if (filters.direction) params.append('direction', filters.direction);
      if (filters.strategy) params.append('strategy', filters.strategy);
      if (filters.timeframe) params.append('timeframe', filters.timeframe);
      if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.append('dateTo', filters.dateTo);

      const response = await fetch(`/api/signals?${params.toString()}`);
      const data = await response.json();

      if (response.ok) {
        // Calcular estatísticas com $100 por trade (com fees de 0.05% abertura + 0.05% fechamento = 0.1% total)
        const FEE_OPEN = 0.0005; // 0.05%
        const FEE_CLOSE = 0.0005; // 0.05%
        const TOTAL_FEE = FEE_OPEN + FEE_CLOSE; // 0.1%
        
        // Calcular resultados em dólares com fees para cada sinal
        const signalsWithResults: SignalWithResult[] = data.signals.map((s: Signal) => {
          if (s.result24h === null) return { ...s, netResult: 0 };
          
          // result24h é a diferença de preço absoluta
          // Resultado bruto em $ = (result24h / entryPrice) * 100
          const grossResult = (s.result24h / s.entryPrice) * 100;
          
          // Descontar fees: 0.05% na abertura + 0.05% no fechamento
          const feeAmount = 100 * TOTAL_FEE; // $100 * 0.1% = $0.10
          const netResult = grossResult - feeAmount;
          
          return { ...s, netResult };
        });
        
        setSignals(signalsWithResults);
        
        const total = signalsWithResults.length;
        const lucros = signalsWithResults.filter((s: SignalWithResult) => s.netResult >= 0).length;
        const prejuizos = total - lucros;
        
        const totalLucro = signalsWithResults
          .filter((s: SignalWithResult) => s.netResult >= 0)
          .reduce((sum: number, s: SignalWithResult) => sum + s.netResult, 0);
        
        const totalPrejuizo = Math.abs(
          signalsWithResults
            .filter((s: SignalWithResult) => s.netResult < 0)
            .reduce((sum: number, s: SignalWithResult) => sum + s.netResult, 0)
        );
        const winRate = total > 0 ? (lucros / total) * 100 : 0;

        setStats({
          total,
          lucros,
          prejuizos,
          totalLucro,
          totalPrejuizo,
          winRate,
        });
      }
    } catch (error) {
      console.error('Erro ao buscar resultados:', error);
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

  const formatPercent = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">
          Resultados Após 24 Horas
        </h1>

        {/* Filtros */}
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
            <input
              type="date"
              placeholder="Data final"
              value={filters.dateTo}
              onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
        </div>

        {/* Estatísticas */}
        {!loading && signals.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 border border-gray-200 dark:border-gray-700">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Total de Trades</p>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">{stats.total}</p>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-xl shadow p-6 border border-green-200 dark:border-green-800">
              <p className="text-sm text-green-600 dark:text-green-400 mb-1">Lucros</p>
              <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                {stats.lucros}
              </p>
              <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                +${formatPrice(stats.totalLucro)}
              </p>
            </div>
            <div className="bg-red-50 dark:bg-red-900/20 rounded-xl shadow p-6 border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-600 dark:text-red-400 mb-1">Prejuízos</p>
              <p className="text-3xl font-bold text-red-600 dark:text-red-400">
                {stats.prejuizos}
              </p>
              <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                -${formatPrice(stats.totalPrejuizo)}
              </p>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl shadow p-6 border border-blue-200 dark:border-blue-800">
              <p className="text-sm text-blue-600 dark:text-blue-400 mb-1">Win Rate</p>
              <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                {formatPercent(stats.winRate)}%
              </p>
              <p className="text-sm text-blue-600 dark:text-blue-400 mt-1">
                Lucro Líquido: ${formatPrice(stats.totalLucro - stats.totalPrejuizo)}
              </p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">Carregando resultados...</p>
          </div>
        ) : signals.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">
              Nenhum resultado encontrado. Os resultados aparecem aqui após 24 horas do sinal.
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden border border-gray-200 dark:border-gray-700">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Par
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Dir
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Estratégia
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      TF
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Entrada
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      24h
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Resultado
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Máx 24h
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Mín 24h
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Data/Hora
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {signals.map((signal) => (
                    <tr
                      key={signal.id}
                      className={`hover:bg-gray-50 dark:hover:bg-gray-700 ${
                        signal.result24h! >= 0
                          ? 'bg-green-50/50 dark:bg-green-900/10'
                          : 'bg-red-50/50 dark:bg-red-900/10'
                      }`}
                    >
                      <td className="px-2 py-2 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                        {signal.symbol}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        <DirectionTag direction={signal.direction} />
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        <div className="max-w-[100px] truncate" title={signal.strategyName}>
                          {signal.strategyName}
                        </div>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {signal.timeframe}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        ${formatPrice(signal.entryPrice)}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {signal.price24h ? `$${formatPrice(signal.price24h)}` : '-'}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-sm">
                        {signal.result24h !== null && signal.netResult !== undefined && (
                          <div>
                            <div
                              className={`font-bold text-xs ${
                                signal.netResult >= 0
                                  ? 'text-green-600 dark:text-green-400'
                                  : 'text-red-600 dark:text-red-400'
                              }`}
                            >
                              {signal.netResult >= 0 ? '+' : ''}${formatPrice(signal.netResult)}
                            </div>
                            <div
                              className={`text-xs ${
                                signal.netResult >= 0
                                  ? 'text-green-500 dark:text-green-500'
                                  : 'text-red-500 dark:text-red-500'
                              }`}
                            >
                              {/* Percentual: netResult em $ / $100 investidos * 100 */}
                              {(() => {
                                const resultPercent = signal.netResult; // netResult já é em $, então % = netResult%
                                return `${resultPercent >= 0 ? '+' : ''}${formatPercent(resultPercent)}%`;
                              })()}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-sm">
                        {signal.high24h ? (
                          <div>
                            <div className="font-bold text-xs text-gray-900 dark:text-white">
                              {formatPrice(signal.high24h)}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {(() => {
                                const percent = ((signal.high24h - signal.entryPrice) / signal.entryPrice) * 100;
                                return `${percent >= 0 ? '+' : ''}${formatPercent(percent)}%`;
                              })()}
                            </div>
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-sm">
                        {signal.low24h ? (
                          <div>
                            <div className="font-bold text-xs text-gray-900 dark:text-white">
                              {formatPrice(signal.low24h)}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {(() => {
                                const percent = ((signal.low24h - signal.entryPrice) / signal.entryPrice) * 100;
                                return `${percent >= 0 ? '+' : ''}${formatPercent(percent)}%`;
                              })()}
                            </div>
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-xs font-medium text-gray-900 dark:text-white">
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

