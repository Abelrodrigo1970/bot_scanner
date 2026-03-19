'use client';

import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';
import DirectionTag from '@/components/DirectionTag';

interface ScannerAlert {
  symbol: string;
  side: 'LONG' | 'SHORT';
  setup: 'TREND_PULLBACK' | 'BREAKOUT_RETEST';
  alert_type: 'PRE_SETUP' | 'ENTRY';
  timeframe: string;
  score: number;
  entry: number;
  stop: number;
  t1: number;
  t2: number;
  atr_pct_15m: number;
  reasons: string[];
  timestamp: number;
}

export default function ScannerPage() {
  const [entries, setEntries] = useState<ScannerAlert[]>([]);
  const [preSetups, setPreSetups] = useState<ScannerAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState('');
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [config, setConfig] = useState({
    minScore: 7,
    topResultsLimit: 3,
    enableBreakoutRetest: false,
    minATRPercent: 0.3,
    maxATRPercent: 2.5,
  });

  const fetchAlerts = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        minScore: config.minScore.toString(),
        topResultsLimit: config.topResultsLimit.toString(),
        enableBreakoutRetest: config.enableBreakoutRetest.toString(),
        minATRPercent: config.minATRPercent.toString(),
        maxATRPercent: config.maxATRPercent.toString(),
      });

      const response = await fetch(`/api/scanner?${params.toString()}`);
      const data = await response.json();

      if (response.ok) {
        setEntries(data.entries || []);
        setPreSetups(data.preSetups || []);
        setLastScan(new Date(data.scannedAt || Date.now()));
      } else {
        setMessage(data.error || 'Erro ao buscar alertas');
      }
    } catch (error) {
      console.error('Erro ao buscar alertas:', error);
      setMessage('Erro ao buscar alertas');
    } finally {
      setLoading(false);
    }
  };

  const runScanner = async () => {
    try {
      setScanning(true);
      setMessage('');
      const response = await fetch('/api/scanner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      const data = await response.json();

      if (response.ok) {
        setEntries(data.entries || []);
        setPreSetups(data.preSetups || []);
        setLastScan(new Date(data.scannedAt || Date.now()));
        setMessage(
          `Scanner executado: ${data.count.entries} entrada(s) e ${data.count.preSetups} pré-setup(s) encontrado(s)`
        );
        setTimeout(() => setMessage(''), 5000);
      } else {
        setMessage(data.error || 'Erro ao executar scanner');
      }
    } catch (error) {
      console.error('Erro ao executar scanner:', error);
      setMessage('Erro ao executar scanner. Tente novamente.');
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, []);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    }).format(price);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('pt-BR');
  };

  const calculateRR = (entry: number, stop: number, target: number) => {
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    return risk > 0 ? (reward / risk).toFixed(2) : '0.00';
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Scanner de Trades A+
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              Análise de setups de alta qualidade para Binance Futures
            </p>
          </div>
          <div className="flex space-x-4">
            <button
              onClick={fetchAlerts}
              disabled={loading}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              {loading ? 'Carregando...' : 'Atualizar'}
            </button>
            <button
              onClick={runScanner}
              disabled={scanning}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {scanning ? 'Escaneando...' : 'Executar Scanner'}
            </button>
          </div>
        </div>

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

        {lastScan && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Última varredura: {lastScan.toLocaleString('pt-BR')}
          </p>
        )}

        {/* Configurações */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8 border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Configurações
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Score Mínimo
              </label>
              <input
                type="number"
                min="0"
                max="10"
                value={config.minScore}
                onChange={(e) =>
                  setConfig({ ...config, minScore: parseInt(e.target.value) || 7 })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Top Resultados
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={config.topResultsLimit}
                onChange={(e) =>
                  setConfig({ ...config, topResultsLimit: parseInt(e.target.value) || 3 })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                ATR Min (%)
              </label>
              <input
                type="number"
                step="0.1"
                value={config.minATRPercent}
                onChange={(e) =>
                  setConfig({ ...config, minATRPercent: parseFloat(e.target.value) || 0.3 })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                ATR Max (%)
              </label>
              <input
                type="number"
                step="0.1"
                value={config.maxATRPercent}
                onChange={(e) =>
                  setConfig({ ...config, maxATRPercent: parseFloat(e.target.value) || 2.5 })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.enableBreakoutRetest}
                onChange={(e) =>
                  setConfig({ ...config, enableBreakoutRetest: e.target.checked })
                }
                className="rounded border-gray-300 dark:border-gray-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Habilitar Setup BREAKOUT_RETEST
              </span>
            </label>
          </div>
        </div>

        {/* Entries */}
        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">
            Entradas A+ (Score ≥ {config.minScore})
          </h2>
          {loading ? (
            <div className="text-center py-12">
              <p className="text-gray-600 dark:text-gray-400">Carregando alertas...</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700">
              <p className="text-gray-600 dark:text-gray-400">
                Nenhuma entrada encontrada. Execute o scanner para buscar oportunidades.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {entries.map((alert, index) => (
                <div
                  key={`${alert.symbol}-${alert.timestamp}-${index}`}
                  className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 border border-gray-200 dark:border-gray-700"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="flex items-center space-x-3 mb-2">
                        <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                          {alert.symbol}
                        </h3>
                        <DirectionTag direction={alert.side} />
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                          {alert.setup}
                        </span>
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                          Score: {alert.score}/10
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {alert.timeframe} • {formatDate(alert.timestamp)}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Entrada</p>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        ${formatPrice(alert.entry)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Stop Loss</p>
                      <p className="text-sm font-medium text-red-600 dark:text-red-400">
                        ${formatPrice(alert.stop)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Target 1</p>
                      <p className="text-sm font-medium text-green-600 dark:text-green-400">
                        ${formatPrice(alert.t1)} (R:R {calculateRR(alert.entry, alert.stop, alert.t1)})
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Target 2</p>
                      <p className="text-sm font-medium text-green-600 dark:text-green-400">
                        ${formatPrice(alert.t2)} (R:R {calculateRR(alert.entry, alert.stop, alert.t2)})
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">ATR %</p>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {alert.atr_pct_15m.toFixed(2)}%
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Razões:</p>
                    <div className="flex flex-wrap gap-2">
                      {alert.reasons.map((reason, i) => (
                        <span
                          key={i}
                          className="px-2 py-1 rounded text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pre-Setups */}
        <div>
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">
            Pré-Setups (Ficar de Olho)
          </h2>
          {preSetups.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700">
              <p className="text-gray-600 dark:text-gray-400">
                Nenhum pré-setup encontrado.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {preSetups.map((alert, index) => (
                <div
                  key={`presetup-${alert.symbol}-${alert.timestamp}-${index}`}
                  className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 border border-gray-200 dark:border-gray-700 opacity-75"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="flex items-center space-x-3 mb-2">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                          {alert.symbol}
                        </h3>
                        <DirectionTag direction={alert.side} />
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                          PRE-SETUP
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {alert.timeframe} • {formatDate(alert.timestamp)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Razões:</p>
                    <div className="flex flex-wrap gap-2">
                      {alert.reasons.map((reason, i) => (
                        <span
                          key={i}
                          className="px-2 py-1 rounded text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Disclaimer />
      </main>
    </div>
  );
}

