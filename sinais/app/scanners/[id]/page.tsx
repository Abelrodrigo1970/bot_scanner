'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';
import {
  BUILTIN_UNIVERSE_META,
  getBuiltinScanDefinition,
  getScannerByUiId,
  SCANNER_ROTATION_NOTES,
  SCANNER_UI_ROUTES,
} from '@/lib/symbolUniverseDefaults';

const VALID_SCANNER_PATHS = SCANNER_UI_ROUTES.map((s) => `/scanners/${s.scannerId}`).join(', ');

interface ScanRow {
  rank: number;
  symbol: string;
  close: number;
  ma: number;
  pctFromMa: number;
  closeChangePct: number | null;
  pctFromMaDelta: number | null;
  pctFromMaPrev: number | null;
  isNewInUniverse: boolean;
}

export default function UniverseScannerPage() {
  const params = useParams();
  const scannerId = String(params?.id ?? '');
  const scanner = getScannerByUiId(scannerId);
  const code = scanner?.code ?? '';
  const meta = code ? BUILTIN_UNIVERSE_META[code] : null;
  const scanDef = code ? getBuiltinScanDefinition(code) : null;
  const maLabel =
    scanDef?.maType === 'EMA' ? `EMA${scanDef.maPeriod}` : `SMA${scanDef?.maPeriod ?? 200}`;
  const timeframeLabel = scanDef?.timeframe ?? '1h';

  const [items, setItems] = useState<ScanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [scanSource, setScanSource] = useState<string | null>(null);
  const [previousScanAt, setPreviousScanAt] = useState<Date | null>(null);

  const fetchFromDb = useCallback(async () => {
    if (!code) return;
    try {
      setError('');
      const response = await fetch(`/api/universe-scans/${encodeURIComponent(code)}`);
      const data = await response.json();
      if (response.ok && data.success) {
        setItems(data.items || []);
        setScanSource(data.run?.source ?? null);
        if (data.run?.scannedAt) setLastUpdate(new Date(data.run.scannedAt));
        else setLastUpdate(null);
        if (data.previousRun?.scannedAt) setPreviousScanAt(new Date(data.previousRun.scannedAt));
        else setPreviousScanAt(null);
      } else {
        setError(data.error || data.details || 'Erro ao carregar dados');
        setItems([]);
      }
    } catch {
      setError('Erro ao carregar dados. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, [code]);

  const handleRefresh = async () => {
    if (!code) return;
    try {
      setRefreshing(true);
      setError('');
      const response = await fetch(`/api/universe-scans/${encodeURIComponent(code)}`, {
        method: 'POST',
      });
      const data = await response.json();
      if (response.status === 202 && data.background) {
        // Scan iniciado em background — avisar o utilizador para recarregar após 2-3 min
        setError(`⏳ ${data.message || 'Scan iniciado em background. Recarregue a página em 2–3 minutos.'}`);
      } else if (response.status === 202 && data.busy) {
        setError(`⏳ ${data.message || 'Scan já em execução. Aguarde e recarregue.'}`);
      } else if (response.ok && data.success) {
        setItems(data.items || []);
        setLastUpdate(new Date(data.scannedAt || Date.now()));
        setScanSource('ui/universe-scans');
        if (data.previousRun?.scannedAt) setPreviousScanAt(new Date(data.previousRun.scannedAt));
        else setPreviousScanAt(null);
      } else {
        setError(data.error || data.details || 'Erro ao atualizar scan');
      }
    } catch {
      setError('Erro ao atualizar. O scan pode demorar vários minutos.');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!scanner) {
      setLoading(false);
      setError(`Scanner inválido. Use ${VALID_SCANNER_PATHS}.`);
      return;
    }
    setLoading(true);
    fetchFromDb();
  }, [scanner, fetchFromDb]);

  const formatPrice = (price: number) => {
    if (price >= 1) return price.toFixed(4);
    if (price >= 0.01) return price.toFixed(5);
    return price.toFixed(8);
  };

  const formatDeltaPct = (value: number | null, decimals = 2) => {
    if (value === null || !Number.isFinite(value)) return null;
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(decimals)}%`;
  };

  if (!scanner || !meta) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Header />
        <main className="max-w-7xl mx-auto px-4 py-12 text-center text-red-600 dark:text-red-400">
          Scanner não encontrado. Use /scanners/1 a /scanners/6.
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-start gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{meta.displayName}</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-2xl">{meta.description}</p>
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              Estratégia: {meta.strategyNames}
            </p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-6 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-400 text-white font-medium rounded-lg transition-colors shrink-0"
          >
            {refreshing ? 'A processar… (vários min)' : 'Atualizar scan'}
          </button>
        </div>

        <div className="mb-6 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-violet-800 dark:text-violet-300 mb-1">
            Regra do scan
          </h2>
          <ul className="text-xs text-violet-700 dark:text-violet-400 space-y-1 list-disc list-inside">
            <li>Top 400 por volume 24h (mín. 500k USDT) — Binance Futures, velas {timeframeLabel}</li>
            <li>{meta.description}</li>
            <li>
              Estratégia: <strong>{meta.strategyNames}</strong>
            </li>
            <li>
              Actualização automática: cron{' '}
              <code className="text-[10px]">/api/cron/run-universe-scans</code> de{' '}
              <strong>4 em 4 horas</strong> (não faz parte do run-1h horário)
            </li>
            {SCANNER_ROTATION_NOTES[scannerId] ? (
              <li>
                <strong>Rotação:</strong> {SCANNER_ROTATION_NOTES[scannerId]}
              </li>
            ) : null}
          </ul>
        </div>

        {lastUpdate && (
          <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            Última atualização: {lastUpdate.toLocaleString('pt-PT')}
            {scanSource ? ` · origem: ${scanSource}` : ''}
            {items.length > 0 ? ` · ${items.length} símbolos` : ''}
            {previousScanAt
              ? ` · Δ vs scan anterior (${previousScanAt.toLocaleString('pt-PT')})`
              : ' · sem scan anterior (1.ª execução ou histórico único)'}
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-center py-12 text-gray-600 dark:text-gray-400">A carregar...</p>
        ) : items.length === 0 ? (
          <p className="text-center py-12 text-gray-600 dark:text-gray-400">
            Nenhum scan gravado. Clica em &quot;Atualizar scan&quot; (demora alguns minutos).
          </p>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {items.length} símbolos
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      #
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Símbolo
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Fecho
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      {maLabel}
                    </th>
                    <th
                      className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase"
                      title="Afastamento (% vs MA) no scan anterior"
                    >
                      Afast. anterior
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Afast. agora
                    </th>
                    <th
                      className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase"
                      title="Variação do fecho vs scan anterior"
                    >
                      Δ fecho
                    </th>
                    <th
                      className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase"
                      title="Mudança na distância à média vs scan anterior"
                    >
                      Δ afast.
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {items.map((item) => (
                    <tr
                      key={item.symbol}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <td className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {item.rank}
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-gray-900 dark:text-white">
                        {item.symbol}
                      </td>
                      <td className="px-6 py-4 text-right text-sm text-gray-900 dark:text-white">
                        ${formatPrice(item.close)}
                      </td>
                      <td className="px-6 py-4 text-right text-sm text-gray-600 dark:text-gray-400">
                        ${formatPrice(item.ma)}
                      </td>
                      <td className="px-6 py-4 text-right text-sm text-gray-600 dark:text-gray-400">
                        {item.isNewInUniverse || item.pctFromMaPrev === null ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <span>
                            {item.pctFromMaPrev >= 0 ? '+' : ''}
                            {item.pctFromMaPrev.toFixed(2)}%
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right text-sm font-semibold">
                        <span
                          className={
                            item.pctFromMa >= 0
                              ? 'text-green-600 dark:text-green-400'
                              : 'text-red-600 dark:text-red-400'
                          }
                        >
                          {item.pctFromMa >= 0 ? '+' : ''}
                          {item.pctFromMa.toFixed(2)}%
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right text-sm font-semibold">
                        {item.isNewInUniverse ? (
                          <span className="text-amber-600 dark:text-amber-400 text-xs">novo</span>
                        ) : item.closeChangePct === null ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <span
                            className={
                              item.closeChangePct >= 0
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-red-600 dark:text-red-400'
                            }
                          >
                            {formatDeltaPct(item.closeChangePct)}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right text-sm text-gray-600 dark:text-gray-400">
                        {item.isNewInUniverse || item.pctFromMaDelta === null ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <span
                            className={
                              item.pctFromMaDelta >= 0
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-red-600 dark:text-red-400'
                            }
                          >
                            {item.pctFromMaDelta >= 0 ? '+' : ''}
                            {item.pctFromMaDelta.toFixed(2)} pts
                          </span>
                        )}
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
