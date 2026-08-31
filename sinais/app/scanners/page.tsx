'use client';

import Link from 'next/link';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';
import {
  BUILTIN_UNIVERSE_META,
  getBuiltinScanDefinition,
  isRsiRankUniverseScan,
  SCANNER_ROTATION_NOTES,
  SCANNER_UI_ROUTES,
} from '@/lib/symbolUniverseDefaults';

export default function ScannersIndexPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Scanners de universo</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-8 max-w-3xl">
          Filtros de símbolos Binance Futures (top volume). Actualização automática via cron{' '}
          <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">/api/cron/run-universe-scans</code> de 4
          em 4 horas (Scanner 3 RSI 1h: cron horário), ou manual em cada página.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {SCANNER_UI_ROUTES.map(({ scannerId, code }) => {
            const meta = BUILTIN_UNIVERSE_META[code];
            const def = getBuiltinScanDefinition(code);
            if (!meta) return null;

            const metricLabel = isRsiRankUniverseScan(code)
              ? `RSI${def?.rsiPeriod ?? 14} (${def?.timeframe ?? '—'})`
              : def?.maType === 'EMA'
                ? `EMA${def?.maPeriod}`
                : def?.ruleType === 'TOP_PRICE_CHANGE_24H'
                  ? 'Top subidas 24h'
                  : def?.ruleType === 'TOP_YTD_MCAP'
                    ? 'Top YTD'
                    : `SMA${def?.maPeriod ?? 200}`;

            return (
              <Link
                key={scannerId}
                href={`/scanners/${scannerId}`}
                className="block bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 shadow-sm hover:border-violet-400 dark:hover:border-violet-600 hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{meta.displayName}</h2>
                  <span className="text-xs font-medium text-violet-600 dark:text-violet-400 shrink-0">
                    #{scannerId}
                  </span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">{meta.description}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-400">
                    Velas {def?.timeframe ?? '—'}
                  </span>
                  <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-400">
                    {metricLabel}
                  </span>
                  {meta.strategyNames && meta.strategyNames !== '— (dados para análise)' ? (
                    <span className="px-2 py-1 rounded bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">
                      {meta.strategyNames}
                    </span>
                  ) : null}
                </div>
                {SCANNER_ROTATION_NOTES[scannerId] ? (
                  <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">{SCANNER_ROTATION_NOTES[scannerId]}</p>
                ) : null}
              </Link>
            );
          })}
        </div>

        <Disclaimer />
      </main>
    </div>
  );
}
