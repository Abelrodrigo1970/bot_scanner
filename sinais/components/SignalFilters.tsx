'use client';

interface StrategyOption {
  id: string;
  name: string;
  displayName: string;
}

interface SignalFiltersProps {
  filters: {
    symbol: string;
    direction: string;
    timeframe: string;
    strategy: string;
    minStrength: string;
  };
  onFilterChange: (filters: any) => void;
  onReset: () => void;
  strategies?: StrategyOption[];
}

export default function SignalFilters({
  filters,
  onFilterChange,
  onReset,
  strategies = [],
}: SignalFiltersProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-6 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Filtros</h2>
        <button
          onClick={onReset}
          className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          Limpar
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Par
          </label>
          <input
            type="text"
            placeholder="BTC, ETH..."
            value={filters.symbol}
            onChange={(e) => onFilterChange({ ...filters, symbol: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Direção
          </label>
          <select
            value={filters.direction}
            onChange={(e) => onFilterChange({ ...filters, direction: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="">Todos</option>
            <option value="BUY">Compra</option>
            <option value="SELL">Venda</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Timeframe
          </label>
          <select
            value={filters.timeframe}
            onChange={(e) => onFilterChange({ ...filters, timeframe: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="">Todos</option>
            <option value="1m">1m</option>
            <option value="5m">5m</option>
            <option value="15m">15m</option>
            <option value="1h">1h</option>
            <option value="4h">4h</option>
            <option value="1d">1d</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Estratégia
          </label>
          {strategies.length > 0 ? (
            <select
              value={filters.strategy}
              onChange={(e) => onFilterChange({ ...filters, strategy: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">Todas</option>
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              placeholder="Volume Spike, MA60, RSI..."
              value={filters.strategy}
              onChange={(e) => onFilterChange({ ...filters, strategy: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Força Mínima
          </label>
          <input
            type="number"
            min="0"
            max="100"
            placeholder="0"
            value={filters.minStrength}
            onChange={(e) => onFilterChange({ ...filters, minStrength: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>
      </div>
    </div>
  );
}






