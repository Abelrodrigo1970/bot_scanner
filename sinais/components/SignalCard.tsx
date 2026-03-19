import Link from 'next/link';
import DirectionTag from './DirectionTag';
import StatusTag from './StatusTag';

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

interface SignalCardProps {
  signal: Signal;
}

export default function SignalCard({ signal }: SignalCardProps) {
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    }).format(price);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    // Formatar com fuso horário local
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  };

  return (
    <Link href={`/sinais/${signal.id}`}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 hover:shadow-lg transition-shadow cursor-pointer border border-gray-200 dark:border-gray-700">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {signal.symbol}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {signal.timeframe} • {signal.strategyName}
            </p>
          </div>
          <div className="flex flex-col items-end space-y-2">
            <DirectionTag direction={signal.direction} />
            <StatusTag status={signal.status} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Entrada</p>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              ${formatPrice(signal.entryPrice)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Stop Loss</p>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              ${formatPrice(signal.stopLoss)}
            </p>
          </div>
          {signal.target1 && (
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Target 1</p>
              <p className="text-sm font-medium text-green-600 dark:text-green-400">
                ${formatPrice(signal.target1)}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Força</p>
            <div className="flex items-center space-x-2">
              <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full"
                  style={{ width: `${signal.strength}%` }}
                />
              </div>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {signal.strength}
              </span>
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          {formatDate(signal.generatedAt)}
        </p>
      </div>
    </Link>
  );
}






