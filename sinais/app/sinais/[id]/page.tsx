'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';
import DirectionTag from '@/components/DirectionTag';
import StatusTag from '@/components/StatusTag';

interface Signal {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  timeframe: string;
  strategyName: string;
  entryPrice: number;
  stopLoss: number;
  target1: number | null;
  target2: number | null;
  target3: number | null;
  strength: number;
  status: string;
  generatedAt: string;
  extraInfo: string | null;
  executedAt?: string | null;
  executionOrderId?: string | null;
}

export default function SignalDetailPage() {
  const params = useParams();
  const [signal, setSignal] = useState<Signal | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [tradingStatus, setTradingStatus] = useState<{
    canExecute: boolean;
    reason?: string;
    isTestnet?: boolean;
  } | null>(null);
  const [executing, setExecuting] = useState(false);
  const [executeResult, setExecuteResult] = useState<{
    success: boolean;
    message?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (params.id) {
      fetchSignal();
    }
  }, [params.id]);

  useEffect(() => {
    fetch('/api/execute-trade')
      .then((res) => res.json())
      .then((data) =>
        setTradingStatus({
          canExecute: data.canExecute ?? false,
          reason: data.reason,
          isTestnet: data.isTestnet,
        })
      )
      .catch(() => setTradingStatus({ canExecute: false }));
  }, []);

  const fetchSignal = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/signals/${params.id}`);
      const data = await response.json();

      if (response.ok) {
        setSignal(data.signal);
        setCurrentPrice(data.currentPrice);
      }
    } catch (error) {
      console.error('Erro ao buscar sinal:', error);
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
    return new Date(dateString).toLocaleString('pt-BR');
  };

  const handleExecuteTrade = async () => {
    if (!signal || !tradingStatus?.canExecute) return;
    setExecuting(true);
    setExecuteResult(null);
    try {
      const res = await fetch('/api/execute-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signalId: signal.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setExecuteResult({ success: true, message: data.message });
        fetchSignal();
      } else {
        setExecuteResult({ success: false, error: data.error || data.message || 'Erro ao executar' });
      }
    } catch (e) {
      setExecuteResult({ success: false, error: 'Erro de conexão' });
    } finally {
      setExecuting(false);
    }
  };

  const calculateDistance = (target: number, entry: number, direction: string) => {
    if (direction === 'BUY') {
      return ((target - entry) / entry) * 100;
    } else {
      return ((entry - target) / entry) * 100;
    }
  };

  const calculateCurrentDistance = (current: number, entry: number, direction: string) => {
    if (direction === 'BUY') {
      return ((current - entry) / entry) * 100;
    } else {
      return ((entry - current) / entry) * 100;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">Carregando detalhes do sinal...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!signal) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">Sinal não encontrado.</p>
            <Link
              href="/"
              className="mt-4 inline-block text-blue-600 dark:text-blue-400 hover:underline"
            >
              Voltar ao Dashboard
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const extraInfo = signal.extraInfo ? JSON.parse(signal.extraInfo) : null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          href="/"
          className="text-blue-600 dark:text-blue-400 hover:underline mb-4 inline-block"
        >
          ← Voltar ao Dashboard
        </Link>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-8 border border-gray-200 dark:border-gray-700">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                {signal.symbol}
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                {signal.timeframe} • {signal.strategyName}
              </p>
            </div>
            <div className="flex flex-col items-end space-y-2">
              <DirectionTag direction={signal.direction} />
              <StatusTag status={signal.status} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Preço de Entrada</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                ${formatPrice(signal.entryPrice)}
              </p>
            </div>

            {currentPrice !== null && (
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Preço Atual</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  ${formatPrice(currentPrice)}
                </p>
                <p
                  className={`text-sm mt-1 ${
                    calculateCurrentDistance(currentPrice, signal.entryPrice, signal.direction) >= 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {calculateCurrentDistance(currentPrice, signal.entryPrice, signal.direction) >= 0
                    ? '+'
                    : ''}
                  {calculateCurrentDistance(currentPrice, signal.entryPrice, signal.direction).toFixed(2)}%
                </p>
              </div>
            )}

            <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Stop Loss</p>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                ${formatPrice(signal.stopLoss)}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {calculateDistance(signal.stopLoss, signal.entryPrice, signal.direction).toFixed(2)}%
                {signal.direction === 'BUY' ? ' abaixo' : ' acima'} da entrada
              </p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Força do Sinal</p>
              <div className="flex items-center space-x-2">
                <div className="flex-1 bg-gray-200 dark:bg-gray-600 rounded-full h-3">
                  <div
                    className="bg-blue-600 h-3 rounded-full"
                    style={{ width: `${signal.strength}%` }}
                  />
                </div>
                <span className="text-lg font-bold text-gray-900 dark:text-white">
                  {signal.strength}
                </span>
              </div>
            </div>
          </div>

          {tradingStatus && (
            <div className="mb-8 p-4 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Bot de Trading
              </h2>
              {signal.executedAt && (
                <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                  ✅ Executado em {formatDate(signal.executedAt)}
                  {signal.executionOrderId && ` (order ${signal.executionOrderId})`}
                </p>
              )}
              {tradingStatus.canExecute && !signal.executedAt && signal.status === 'NEW' && (
                <>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                    Testnet ativo. Podes executar este sinal na Binance Futures Testnet.
                  </p>
                  <button
                    onClick={handleExecuteTrade}
                    disabled={executing || signal.strength < 70}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                  >
                    {executing ? 'A executar...' : 'Executar trade'}
                  </button>
                  {signal.strength < 70 && (
                    <p className="text-sm text-amber-600 dark:text-amber-400 mt-2">
                      Apenas sinais com força ≥ 70 podem ser executados.
                    </p>
                  )}
                </>
              )}
              {!tradingStatus.canExecute && !signal.executedAt && (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {tradingStatus.reason ?? 'Trading desativado ou não configurado.'}
                </p>
              )}
              {!signal.executedAt && signal.status !== 'NEW' && tradingStatus.canExecute && (
                <p className="text-sm text-gray-500">Este sinal já não está em estado NEW.</p>
              )}
              {executeResult && (
                <div
                  className={`mt-3 p-3 rounded text-sm ${
                    executeResult.success
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
                      : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
                  }`}
                >
                  {executeResult.success ? executeResult.message : executeResult.error}
                </div>
              )}
            </div>
          )}

          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Targets</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {signal.target1 && (
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Target 1</p>
                  <p className="text-xl font-bold text-green-600 dark:text-green-400">
                    ${formatPrice(signal.target1)}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    +{calculateDistance(signal.target1, signal.entryPrice, signal.direction).toFixed(2)}%
                  </p>
                </div>
              )}
              {signal.target2 && (
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Target 2</p>
                  <p className="text-xl font-bold text-green-600 dark:text-green-400">
                    ${formatPrice(signal.target2)}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    +{calculateDistance(signal.target2, signal.entryPrice, signal.direction).toFixed(2)}%
                  </p>
                </div>
              )}
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Target 3 (fechar 24h)</p>
                {signal.target3 ? (
                  <>
                    <p className="text-xl font-bold text-green-600 dark:text-green-400">
                      ${formatPrice(signal.target3)}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      +{calculateDistance(signal.target3, signal.entryPrice, signal.direction).toFixed(2)}% · Fechar às 24h
                    </p>
                  </>
                ) : (
                  <p className="text-lg font-medium text-green-600 dark:text-green-400">
                    Preço que estiver às 24h
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Informações Adicionais
            </h2>
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Data de Geração</p>
              <p className="text-gray-900 dark:text-white">{formatDate(signal.generatedAt)}</p>
              {extraInfo && (
                <div className="mt-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Detalhes do Cálculo</p>
                  <pre className="text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-600 overflow-x-auto">
                    {JSON.stringify(extraInfo, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>

          <Disclaimer />
        </div>
      </main>
    </div>
  );
}






