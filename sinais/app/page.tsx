'use client';

import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';
import SignalCard from '@/components/SignalCard';
import SignalFilters from '@/components/SignalFilters';

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
}

interface Strategy {
  id: string;
  name: string;
  displayName: string;
}

export default function DashboardPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState('');
  const [filters, setFilters] = useState({
    symbol: '',
    direction: '',
    timeframe: '',
    strategy: '',
    minStrength: '70',
  });

  const fetchSignals = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filters.symbol) params.append('symbol', filters.symbol);
      if (filters.direction) params.append('direction', filters.direction);
      if (filters.timeframe) params.append('timeframe', filters.timeframe);
      if (filters.strategy) params.append('strategy', filters.strategy);
      // Enviar minStrength apenas se especificado (removido padrão para teste)
      if (filters.minStrength && filters.minStrength !== '0') {
        params.append('minStrength', filters.minStrength);
      }

      const url = `/api/signals?${params.toString()}`;
      const response = await fetch(url);
      const data = await response.json();

      if (response.ok) {
        setSignals(data.signals);
      } else {
        console.error('❌ Erro na API:', data);
      }
    } catch (error) {
      console.error('Erro ao buscar sinais:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStrategies = async () => {
    try {
      const res = await fetch('/api/strategies');
      const data = await res.json();
      if (res.ok && data.strategies) {
        setStrategies(data.strategies);
      }
    } catch (e) {
      console.error('Erro ao buscar estratégias:', e);
    }
  };

  useEffect(() => {
    fetchStrategies();
  }, []);

  useEffect(() => {
    fetchSignals();
  }, [filters]);

  const handleUpdateSignals = async () => {
    try {
      setUpdating(true);
      setMessage('');
      const response = await fetch('/api/run-signals', { method: 'POST' });
      const data = await response.json();

      if (response.ok) {
        setMessage(data.message || 'Processamento iniciado. Os sinais aparecem em breve.');
        fetchSignals();
      } else {
        setMessage(data.error || data.details || 'Erro ao gerar sinais');
      }
    } catch (error) {
      setMessage('Erro de conexão. Tente novamente.');
    } finally {
      setUpdating(false);
    }
  };

  const handleFilterChange = (newFilters: typeof filters) => {
    setFilters(newFilters);
  };

  const handleResetFilters = () => {
    setFilters({
      symbol: '',
      direction: '',
      timeframe: '',
      strategy: '',
      minStrength: '70', // Padrão: apenas força >= 70
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
          <button
            onClick={handleUpdateSignals}
            disabled={updating}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg transition-colors"
          >
            {updating ? 'A processar...' : 'Atualizar sinais agora'}
          </button>
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

        <SignalFilters
          filters={filters}
          onFilterChange={handleFilterChange}
          onReset={handleResetFilters}
          strategies={strategies}
        />

        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">Carregando sinais...</p>
          </div>
        ) : signals.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">
              Nenhum sinal encontrado. Clique em "Atualizar sinais agora" para gerar novos sinais.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {signals.map((signal) => (
              <SignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        )}

        <Disclaimer />
      </main>
    </div>
  );
}



