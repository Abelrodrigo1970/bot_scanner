'use client';

import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';

interface Strategy {
  id: string;
  name: string;
  displayName: string;
  description: string;
  isActive: boolean;
  params: string;
}

export default function EstrategiasPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchStrategies();
  }, []);

  const fetchStrategies = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/strategies');
      const data = await response.json();

      if (response.ok) {
        setStrategies(data.strategies);
      }
    } catch (error) {
      console.error('Erro ao buscar estratégias:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (strategy: Strategy) => {
    try {
      setSaving(strategy.id);
      const response = await fetch('/api/strategies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: strategy.id,
          isActive: !strategy.isActive,
        }),
      });

      if (response.ok) {
        await fetchStrategies();
        setMessage('Estratégia atualizada com sucesso');
        setTimeout(() => setMessage(''), 3000);
      } else {
        setMessage('Erro ao atualizar estratégia');
      }
    } catch (error) {
      setMessage('Erro ao atualizar estratégia');
    } finally {
      setSaving(null);
    }
  };

  const handleUpdateParams = async (strategy: Strategy, newParams: any) => {
    try {
      setSaving(strategy.id);
      const response = await fetch('/api/strategies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: strategy.id,
          params: newParams,
        }),
      });

      if (response.ok) {
        await fetchStrategies();
        setMessage('Parâmetros atualizados com sucesso');
        setTimeout(() => setMessage(''), 3000);
      } else {
        setMessage('Erro ao atualizar parâmetros');
      }
    } catch (error) {
      setMessage('Erro ao atualizar parâmetros');
    } finally {
      setSaving(null);
    }
  };

  const getDefaultParams = (strategyName: string) => {
    switch (strategyName) {
      case 'RSI':
        return { period: 14, overbought: 70, oversold: 30 };
      case 'MA_CROSSOVER':
        return { fastPeriod: 9, slowPeriod: 21 };
      case 'MACD':
        return { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 };
      default:
        return {};
    }
  };

  const renderStrategyParams = (strategy: Strategy) => {
    const params = JSON.parse(strategy.params || '{}');
    const defaults = getDefaultParams(strategy.name);

    switch (strategy.name) {
      case 'RSI':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Período
              </label>
              <input
                type="number"
                defaultValue={params.period || defaults.period}
                onBlur={(e) =>
                  handleUpdateParams(strategy, {
                    ...params,
                    period: parseInt(e.target.value) || defaults.period,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Limite de Sobrecompra
              </label>
              <input
                type="number"
                defaultValue={params.overbought || defaults.overbought}
                onBlur={(e) =>
                  handleUpdateParams(strategy, {
                    ...params,
                    overbought: parseInt(e.target.value) || defaults.overbought,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Limite de Sobrevenda
              </label>
              <input
                type="number"
                defaultValue={params.oversold || defaults.oversold}
                onBlur={(e) =>
                  handleUpdateParams(strategy, {
                    ...params,
                    oversold: parseInt(e.target.value) || defaults.oversold,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>
        );

      case 'MA_CROSSOVER':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                MA Curta
              </label>
              <input
                type="number"
                defaultValue={params.fastPeriod || defaults.fastPeriod}
                onBlur={(e) =>
                  handleUpdateParams(strategy, {
                    ...params,
                    fastPeriod: parseInt(e.target.value) || defaults.fastPeriod,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                MA Longa
              </label>
              <input
                type="number"
                defaultValue={params.slowPeriod || defaults.slowPeriod}
                onBlur={(e) =>
                  handleUpdateParams(strategy, {
                    ...params,
                    slowPeriod: parseInt(e.target.value) || defaults.slowPeriod,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>
        );

      case 'MACD':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Fast Period
              </label>
              <input
                type="number"
                defaultValue={params.fastPeriod || defaults.fastPeriod}
                onBlur={(e) =>
                  handleUpdateParams(strategy, {
                    ...params,
                    fastPeriod: parseInt(e.target.value) || defaults.fastPeriod,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Slow Period
              </label>
              <input
                type="number"
                defaultValue={params.slowPeriod || defaults.slowPeriod}
                onBlur={(e) =>
                  handleUpdateParams(strategy, {
                    ...params,
                    slowPeriod: parseInt(e.target.value) || defaults.slowPeriod,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Signal Period
              </label>
              <input
                type="number"
                defaultValue={params.signalPeriod || defaults.signalPeriod}
                onBlur={(e) =>
                  handleUpdateParams(strategy, {
                    ...params,
                    signalPeriod: parseInt(e.target.value) || defaults.signalPeriod,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>
        );

      default:
        return <p className="text-sm text-gray-500 dark:text-gray-400">Sem parâmetros configuráveis</p>;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">Estratégias</h1>

        {message && (
          <div
            className={`mb-4 p-4 rounded-lg ${
              message.includes('Erro')
                ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                : 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
            }`}
          >
            {message}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">Carregando estratégias...</p>
          </div>
        ) : (
          <div className="space-y-6">
            {strategies.map((strategy) => (
              <div
                key={strategy.id}
                className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 border border-gray-200 dark:border-gray-700"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                        {strategy.displayName}
                      </h2>
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          strategy.isActive
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                            : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {strategy.isActive ? 'Ativa' : 'Inativa'}
                      </span>
                    </div>
                    <p className="text-gray-600 dark:text-gray-400">{strategy.description}</p>
                  </div>
                  <button
                    onClick={() => handleToggleActive(strategy)}
                    disabled={saving === strategy.id}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      strategy.isActive
                        ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-200 dark:hover:bg-red-800'
                        : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900 dark:text-green-200 dark:hover:bg-green-800'
                    }`}
                  >
                    {saving === strategy.id
                      ? 'Salvando...'
                      : strategy.isActive
                      ? 'Desativar'
                      : 'Ativar'}
                  </button>
                </div>

                <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
                    Parâmetros
                  </h3>
                  {renderStrategyParams(strategy)}
                </div>
              </div>
            ))}
          </div>
        )}

        <Disclaimer />
      </main>
    </div>
  );
}






