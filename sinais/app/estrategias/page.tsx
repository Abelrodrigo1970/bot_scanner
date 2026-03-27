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
  const [tradingEnabled, setTradingEnabled] = useState<boolean | null>(null);
  const [savingTrading, setSavingTrading] = useState(false);
  const [exchange, setExchange] = useState<{ exchange: string; label: string } | null>(null);

  useEffect(() => {
    fetchStrategies();
    fetchTradingSetting();
    fetchExchange();
  }, []);

  const fetchExchange = async () => {
    try {
      const res = await fetch('/api/settings/exchange');
      if (res.ok) setExchange(await res.json());
    } catch { /* ignorar */ }
  };

  const fetchTradingSetting = async () => {
    try {
      const res = await fetch('/api/settings/trading');
      const data = await res.json();
      if (res.ok && typeof data.enabled === 'boolean') {
        setTradingEnabled(data.enabled);
      }
    } catch {
      setTradingEnabled(false);
    }
  };

  const handleToggleTrading = async () => {
    if (tradingEnabled === null) return;
    try {
      setSavingTrading(true);
      const res = await fetch('/api/settings/trading', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !tradingEnabled }),
      });
      const data = await res.json();
      if (res.ok) {
        setTradingEnabled(data.enabled);
        setMessage(data.message || (data.enabled ? 'Trades ativados' : 'Trades desativados'));
        setTimeout(() => setMessage(''), 3000);
      } else {
        setMessage(data.error || 'Erro ao atualizar');
      }
    } catch {
      setMessage('Erro ao atualizar trades');
    } finally {
      setSavingTrading(false);
    }
  };

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

  const handleToggleDirection = async (strategy: Strategy, direction: 'BUY' | 'SELL') => {
    const params = JSON.parse(strategy.params || '{}');
    const field = direction === 'BUY' ? 'allowBuy' : 'allowSell';
    const current = params[field] !== false; // default true
    try {
      setSaving(strategy.id + direction);
      const response = await fetch('/api/strategies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: strategy.id, [field]: !current }),
      });
      if (response.ok) {
        await fetchStrategies();
        setMessage(`${direction} ${!current ? 'ativado' : 'desativado'} em ${strategy.displayName}`);
        setTimeout(() => setMessage(''), 3000);
      } else {
        setMessage('Erro ao atualizar');
      }
    } catch {
      setMessage('Erro ao atualizar');
    } finally {
      setSaving(null);
    }
  };

  const getDefaultParams = (strategyName: string) => {
    switch (strategyName) {
      case 'RSI':
        return { period: 14, buyThreshold: 69, sellThreshold: 29 };
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
                Compra quando RSI sobe acima de
              </label>
              <input
                type="number"
                defaultValue={params.buyThreshold ?? defaults.buyThreshold}
                onBlur={(e) =>
                  handleUpdateParams(strategy, {
                    ...params,
                    buyThreshold: parseInt(e.target.value) || defaults.buyThreshold,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Venda quando RSI desce abaixo de
              </label>
              <input
                type="number"
                defaultValue={params.sellThreshold ?? defaults.sellThreshold}
                onBlur={(e) =>
                  handleUpdateParams(strategy, {
                    ...params,
                    sellThreshold: parseInt(e.target.value) || defaults.sellThreshold,
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

        {/* Toggle Trades + Exchange */}
        <div className="mb-8 bg-white dark:bg-gray-800 rounded-xl shadow p-6 border border-gray-200 dark:border-gray-700">
          <div className="flex justify-between items-start gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Execução de Trades
                </h2>
                {exchange && (
                  <span className={`px-3 py-1 rounded-full text-xs font-bold tracking-wide ${
                    exchange.exchange === 'bybit'
                      ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 border border-yellow-300 dark:border-yellow-700'
                      : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border border-blue-300 dark:border-blue-700'
                  }`}>
                    {exchange.exchange === 'bybit' ? '🟡 Bybit' : '🔵 Binance'}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Quando ativo, os sinais com força suficiente são executados automaticamente no cron.
                A exchange é configurada via variável <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded text-xs">EXCHANGE</code> no Railway.
              </p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className={`text-sm font-medium ${tradingEnabled ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}>
                {tradingEnabled === null ? '...' : tradingEnabled ? 'Ativado' : 'Desativado'}
              </span>
              <button
                onClick={handleToggleTrading}
                disabled={tradingEnabled === null || savingTrading}
                className={`relative inline-flex h-8 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  tradingEnabled ? 'bg-green-600' : 'bg-gray-300 dark:bg-gray-600'
                } ${(tradingEnabled === null || savingTrading) ? 'opacity-50 cursor-not-allowed' : ''}`}
                role="switch"
                aria-checked={tradingEnabled ?? false}
              >
                <span
                  className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition ${
                    tradingEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

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

                {/* Toggles BUY / SELL */}
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    Direções permitidas
                  </h3>
                  <div className="flex gap-3">
                    {(['BUY', 'SELL'] as const).map((dir) => {
                      const params   = JSON.parse(strategy.params || '{}');
                      const field    = dir === 'BUY' ? 'allowBuy' : 'allowSell';
                      const enabled  = params[field] !== false;
                      const isSaving = saving === strategy.id + dir;
                      return (
                        <button
                          key={dir}
                          onClick={() => handleToggleDirection(strategy, dir)}
                          disabled={isSaving}
                          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border transition-all ${
                            enabled
                              ? dir === 'BUY'
                                ? 'bg-green-100 border-green-400 text-green-800 dark:bg-green-900/40 dark:border-green-600 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60'
                                : 'bg-red-100 border-red-400 text-red-800 dark:bg-red-900/40 dark:border-red-600 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60'
                              : 'bg-gray-100 border-gray-300 text-gray-400 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600'
                          } ${isSaving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          <span className={`w-2 h-2 rounded-full ${enabled ? (dir === 'BUY' ? 'bg-green-500' : 'bg-red-500') : 'bg-gray-400'}`} />
                          {dir === 'BUY' ? '↑ COMPRA' : '↓ VENDA'}
                          <span className="text-xs opacity-70">{enabled ? 'ON' : 'OFF'}</span>
                        </button>
                      );
                    })}
                  </div>
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






