'use client';

import { useEffect, useMemo, useState } from 'react';
import Header from '@/components/Header';
import Disclaimer from '@/components/Disclaimer';
import {
  CRON_GROUPS,
  isDeprecatedStrategyName,
  REMOVED_STRATEGY_LABELS,
  sortActiveStrategies,
  STRATEGY_CATALOG,
} from '@/lib/strategyCatalog';

interface Strategy {
  id: string;
  name: string;
  displayName: string;
  description: string;
  isActive: boolean;
  params: string;
}

function parseStrategyParams(params: string | null | undefined): Record<string, any> {
  if (!params) return {};

  try {
    const parsed = JSON.parse(params);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.error('Erro ao parsear params da estratégia:', error, params);
    return {};
  }
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
        const active = (data.strategies as Strategy[]).filter((s) => !isDeprecatedStrategyName(s.name));
        setStrategies(sortActiveStrategies(active));
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

  const handleSetExchange = async (strategy: Strategy, ex: 'binance' | 'bybit') => {
    const params = parseStrategyParams(strategy.params);
    if (params.exchange === ex) return;
    try {
      setSaving(strategy.id + 'exchange');
      const response = await fetch('/api/strategies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: strategy.id, params: { ...params, exchange: ex } }),
      });
      if (response.ok) {
        await fetchStrategies();
        setMessage(`Exchange de ${strategy.displayName} alterada para ${ex === 'bybit' ? 'Bybit' : 'Binance'}`);
        setTimeout(() => setMessage(''), 3000);
      } else {
        setMessage('Erro ao atualizar exchange');
      }
    } catch {
      setMessage('Erro ao atualizar exchange');
    } finally {
      setSaving(null);
    }
  };

  const handleToggleDirection = async (strategy: Strategy, direction: 'BUY' | 'SELL') => {
    const params = parseStrategyParams(strategy.params);
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

  const numField = (
    label: string,
    value: number,
    onSave: (v: number) => void,
    step = 1,
  ) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      <input
        type="number"
        step={step}
        defaultValue={value}
        key={value}
        onBlur={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onSave(v);
        }}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
      />
    </div>
  );

  const activeCount = useMemo(() => strategies.filter((s) => s.isActive).length, [strategies]);

  const renderStrategyParams = (strategy: Strategy) => {
    const p = parseStrategyParams(strategy.params);
    const upd = (patch: object) => handleUpdateParams(strategy, { ...p, ...patch });

    switch (strategy.name) {
      case 'MA_CROSS_5M': {
        const maPairLabel = 'MA12 / MA30';
        const diffLabel = 'MA12 / MA30';
        return (
          <div className="space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Velas <strong>15m</strong> — <strong>{maPairLabel}</strong>. Mesma lógica de spread: rápida&gt;lenta (ou &lt;) e |rápida−lenta|/lenta &gt; limiar de entrada; fecho quando a diferença comprime abaixo do limiar de saída (compressão).
              <>
                {' O cron corre a cada 15 min.'} Símbolos ={' '}
                <strong>Scanner 1 top 20</strong> (maior |afastamento| vs SMA200 em 1h); actualize em Origem de dados → Scanner 1
                ou aguarde o cron <strong>run-universe-scans</strong> (cada 4 h).
              </>
            </p>
            <p className="text-xs text-amber-800 dark:text-amber-200/90 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-md px-3 py-2">
              <strong>Frequência:</strong> activo sáb/dom; turnover 3×1h ≥ $3M; cooldown 24h entre dias;
              máx. <strong>2 sinais/símbolo/dia</strong> — o 2.º só após o 1.º <strong>fechado e verde</strong> (mesma direção).
              Não abre posição nova se já existir trade aberto no mesmo sentido.
            </p>
            <div className="max-w-md">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo de média</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                value={p.maType === 'SMA' ? 'SMA' : 'EMA'}
                onChange={(e) => upd({ maType: e.target.value === 'SMA' ? 'SMA' : 'EMA' })}
              >
                <option value="EMA">EMA (alinhada com gráfico tipo TradingView)</option>
                <option value="SMA">SMA (média simples)</option>
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {numField('Período MA rápida (ex. 12)', p.ma30Period ?? 12, (v) => upd({ ma30Period: v }))}
              {numField('Período MA lenta (ex. 30)', p.ma200Period ?? 30, (v) => upd({ ma200Period: v }))}
              {numField(`Entrada: dif. mín. ${diffLabel} (%)`, p.entryDiffPct ?? 0.9, (v) => upd({ entryDiffPct: v }), 0.1)}
              {numField(`Entrada: dif. máx. ${diffLabel} (%)`, p.entryMaxDiffPct ?? 1.8, (v) => upd({ entryMaxDiffPct: v }), 0.1)}
              {numField(`Saída/fecho: dif. ${diffLabel} (%)`, p.exitDiffPct ?? 0.5, (v) => upd({ exitDiffPct: v }), 0.1)}
              {numField('SL (%)', p.stopPercent ?? 15, (v) => upd({ stopPercent: v }), 0.5)}
              {numField(
                'TP parcial: valorização vs entrada (%)',
                p.ma12x30GainTpPct ?? 44,
                (v) => upd({ ma12x30GainTpPct: v }),
                0.5
              )}
              {numField(
                'TP parcial: % da posição a fechar',
                p.ma12x30GainTpPositionPct ?? 60,
                (v) => upd({ ma12x30GainTpPositionPct: v }),
                1
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
              {numField(
                `BUY: máx. |preço − MA lenta| / MA lenta (${'MA30'}) (%)`,
                p.buyBlockAbsCloseDistanceFromMa200Pct ?? 0,
                (v) => upd({ buyBlockAbsCloseDistanceFromMa200Pct: v }),
                0.5
              )}
              {numField(
                `SELL: máx. |preço − MA lenta| / MA lenta (${'MA30'}) (%)`,
                p.sellBlockAbsCloseDistanceFromMa200Pct ?? 6,
                (v) => upd({ sellBlockAbsCloseDistanceFromMa200Pct: v }),
                0.5
              )}
            </div>
            <div className="max-w-md">
              {numField(
                'Entrada: máx. |MA30 − MA200| / MA200 (%)',
                p.entryMaxAbsPctMa30VsMa200 ?? 0,
                (v) => upd({ entryMaxAbsPctMa30VsMa200: v }),
                0.5
              )}
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                MA200 = período 200 nas mesmas velas que o par MA12/MA30. Só emite BUY/SELL se esta distância for ≤ ao limiar; 0 desactiva.
              </p>
            </div>
            <div className="max-w-md">
              {numField(
                'Entrada: máx. |MA80 − MA200| / MA200 (%)',
                p.entryMaxAbsPctMa80VsMa200 ?? 3,
                (v) => upd({ entryMaxAbsPctMa80VsMa200: v }),
                0.5
              )}
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                EMA80 e EMA200 em 15m. Só emite se |MA80−MA200|/MA200 ≤ limiar (ex. 3%); 0 desactiva.
              </p>
            </div>
            <label className="flex items-center gap-2 max-w-md text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-gray-300 dark:border-gray-600"
                checked={p.ma12x30RepeatWhileTrend !== false}
                onChange={(e) => upd({ ma12x30RepeatWhileTrend: e.target.checked })}
              />
              <span>
                Modo repetir tendência (sem exigir spread «frio» na vela anterior): só entra quando o spread atravessa o limiar, o alinhamento MAs muda face à vela anterior, ou o spread <strong>alarga</strong> vs a vela anterior (ver campo abaixo). Evita gerar um sinal <strong>nem todas</strong> as barras só por estar o par de MAs «aberto».
              </span>
            </label>
            <div className="max-w-md">
              {numField(
                'Repeat: Δ mínimo spread vs vela ant. (pts %)',
                p.ma12x30RepeatMinSpreadDeltaPct ?? 0.06,
                (v) => upd({ ma12x30RepeatMinSpreadDeltaPct: v }),
                0.01
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-500">
              Mesma unidade que «Entrada: dif.». Aumentar (ex.: 0,08–0,15) reduz falsos repetidos em tendência forte com spread já largo.
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500">
              Entrada: spread |MA12−MA30|/MA30 entre o mínimo e o máximo (ex. &gt;0,9% e &lt;1,8%). 0 no máximo desactiva o tecto.
              BUY / SELL (modo spread): se |preço − MA lenta|/MA lenta (%) for maior que o limite desse lado, não gera sinal.
              0 desactiva o filtro desse lado (ex.: BUY a 0 = sem filtro de distância à MA na compra).
              {' O campo «MA30 − MA200» limita o afastamento entre a MA lenta (30) e uma MA200 no mesmo timeframe.'}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500">
              O take profit parcial é quando o preço atinge a % indicada; o restante fecha por compressão do spread (cron 15m). O cron não abre segundo trade no mesmo sentido se já houver posição real nesse par.
            </p>
          </div>
        );
      }

      case 'RSI_OVERBOUGHT_DROP_1H':
        return (
          <div className="space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Timeframe <strong>1h</strong>; só <strong>VENDA</strong>. Universo = <strong>Scanner 2</strong> (-5% a
              +15% EMA80). Tendência bear: preço abaixo EMA80, stack 200&gt;80&gt;30&gt;12, EMA200 a descer. Entrada após
              pullback à EMA30, RSI ≥50 no rally e queda ≥3 pts, vela bear a fechar abaixo EMA12 (como nos breakdowns
              pós-rejeição nas EMAs).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {numField('Período RSI', p.rsiPeriod ?? 14, (v) => upd({ rsiPeriod: v }))}
              {numField('RSI mín. vela anterior', p.overboughtLevel ?? 55, (v) => upd({ overboughtLevel: v }))}
              {numField('Queda mín. RSI (pts)', p.minDropPoints ?? 3, (v) => upd({ minDropPoints: v }))}
              {numField('Pico RSI mín. no pullback', p.rsiPullbackMinPeak ?? 50, (v) => upd({ rsiPullbackMinPeak: v }))}
              {numField('Lookback pico RSI (velas)', p.rsiPullbackLookback ?? 10, (v) => upd({ rsiPullbackLookback: v }))}
              {numField('Pullback EMA30 (velas)', p.pullbackMaxBars ?? 8, (v) => upd({ pullbackMaxBars: v }))}
              {numField('Máx. abaixo EMA80 (%)', p.maxDistBelowEma80Pct ?? 10, (v) => upd({ maxDistBelowEma80Pct: v }), 0.5)}
              {numField('Inclinação mín. EMA200 (queda, %)', p.minEma200SlopeDownPct ?? 0.1, (v) => upd({ minEma200SlopeDownPct: v }), 0.05)}
            </div>
            <p className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wide">SELL — SL / TP</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {numField('SL (%) acima entrada', (p.stopLossPct ?? 0.08) * 100, (v) => upd({ stopLossPct: v / 100 }), 0.5)}
              {numField('TP1 (%) abaixo entrada', p.sellTp1Percent ?? 9, (v) => upd({ sellTp1Percent: v }), 0.5)}
              {numField('TP1 — % da posição', p.sellTp1Position ?? 50, (v) => upd({ sellTp1Position: v }))}
              {numField('TP2 (%) abaixo entrada', p.sellTp2Percent ?? 28, (v) => upd({ sellTp2Percent: v }), 0.5)}
              {numField('TP2 — % da posição', p.sellTp2Position ?? 30, (v) => upd({ sellTp2Position: v }))}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Restante da posição ({Math.max(0, 100 - Number(p.sellTp1Position ?? 50) - Number(p.sellTp2Position ?? 30))}
              %) — fecho manual.
            </p>
          </div>
        );

      case 'RSI_OVERBOUGHT_DROP_LEGACY_1H':
        return (
          <div className="space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Timeframe <strong>1h</strong>; só <strong>VENDA</strong>. Universo = <strong>Scanner 2</strong> (-5% a
              +15% EMA80). Entrada: RSI(14) cruza de ≥70 para baixo (queda ≥4 pts) com preço &gt;10% acima da
              EMA80 (mean-reversion short).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {numField('Período RSI', p.rsiPeriod ?? 14, (v) => upd({ rsiPeriod: v }))}
              {numField('Nível sobrecompra', p.overboughtLevel ?? 70, (v) => upd({ overboughtLevel: v }))}
              {numField('Queda mín. RSI (pts)', p.minDropPoints ?? 4, (v) => upd({ minDropPoints: v }))}
              {numField('Afastamento mín. EMA80 (%)', p.minDistancePct ?? 10, (v) => upd({ minDistancePct: v }), 0.5)}
              {numField('Período média', p.maPeriod ?? 80, (v) => upd({ maPeriod: v }))}
            </div>
            <p className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wide">SELL — SL / TP</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {numField('SL (%) acima entrada', (p.stopLossPct ?? 0.08) * 100, (v) => upd({ stopLossPct: v / 100 }), 0.5)}
              {numField('TP1 (%) abaixo entrada', p.sellTp1Percent ?? 9, (v) => upd({ sellTp1Percent: v }), 0.5)}
              {numField('TP1 — % da posição', p.sellTp1Position ?? 50, (v) => upd({ sellTp1Position: v }))}
              {numField('TP2 (%) abaixo entrada', p.sellTp2Percent ?? 28, (v) => upd({ sellTp2Percent: v }), 0.5)}
              {numField('TP2 — % da posição', p.sellTp2Position ?? 30, (v) => upd({ sellTp2Position: v }))}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Restante da posição ({Math.max(0, 100 - Number(p.sellTp1Position ?? 50) - Number(p.sellTp2Position ?? 30))}
              %) — fecho manual.
            </p>
          </div>
        );

      case 'SCANNER1_TOP5':
        return (
          <div className="space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Rotação <strong>total</strong> a cada scan do <strong>Scanner 2</strong> (top 30 subidas 24h, 4 h): fecha
              todas as posições e recompra as <strong>8 primeiras</strong> (ranks 1–8). SL -5% (Bybit). Corre
              automaticamente após <code className="text-[10px]">run-universe-scans</code>.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {numField('Posições (top N)', p.topN ?? 8, (v) => upd({ topN: v }))}
              {numField('Scan top N (fonte)', p.scanTopN ?? 8, (v) => upd({ scanTopN: v }))}
              {numField('SL (%) abaixo entrada', (p.stopLossPct ?? 0.05) * 100, (v) => upd({ stopLossPct: v / 100 }), 0.5)}
              {numField('Horas até rotação (ref.)', p.closeAfterHours ?? 4, (v) => upd({ closeAfterHours: v }))}
              {numField('Força mín. auto-exec', p.autoExecuteMinStrength ?? 80, (v) => upd({ autoExecuteMinStrength: v }))}
            </div>
          </div>
        );

      case 'EMA_SCALPING':
        return (
          <div className="space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Timeframe <strong>15m</strong>; dados <strong>Binance Futures</strong>. Tendência de alta: EMA55 a subir, EMA8 acima da EMA55; retração (pullback) ou consolidação junto à fita; vela <strong>bull</strong> forte a fechar acima da EMA8. Só <strong>COMPRA</strong>. Universo = <strong>Scanner 4</strong> (fecho acima SMA200 em 1d).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {numField('EMA rápida (base bull)', p.ribbonFastPeriod ?? 8, (v) => upd({ ribbonFastPeriod: v }))}
              {numField('EMA lenta (topo fita)', p.ribbonSlowPeriod ?? 55, (v) => upd({ ribbonSlowPeriod: v }))}
              {numField('ATR período', p.atrPeriod ?? 14, (v) => upd({ atrPeriod: v }))}
              {numField('Lookback inclinação (velas)', p.slopeLookback ?? 5, (v) => upd({ slopeLookback: v }))}
              {numField('Inclinação mín. EMA lenta (subida, %)', p.minSlowEmaSlopePct ?? 0.85, (v) => upd({ minSlowEmaSlopePct: v }), 0.05)}
              {numField('Barras lateral (consol.)', p.consolidationLookback ?? 14, (v) => upd({ consolidationLookback: v }))}
              {numField('Máx. range consolidação (%)', p.consolidationMaxRangePct ?? 1.35, (v) => upd({ consolidationMaxRangePct: v }), 0.05)}
              {numField('Mín. velas com close < EMA rápida (lateral)', p.minBarsBelowFastInConsolidation ?? Math.ceil((p.consolidationLookback ?? 14) * 0.55), (v) => upd({ minBarsBelowFastInConsolidation: v }))}
              {numField('Barras máx. pullback', p.pullbackMaxBars ?? 10, (v) => upd({ pullbackMaxBars: v }))}
              {numField('Corpo mínimo / range', p.strongBodyOfRangeMin ?? 0.58, (v) => upd({ strongBodyOfRangeMin: v }), 0.01)}
              {numField('Corpo mínimo × ATR', p.strongBodyMinAtrMult ?? 0.42, (v) => upd({ strongBodyMinAtrMult: v }), 0.02)}
              {numField('Máximo quartil superior (fecha perto do high)', p.closeUpperThirdMaxFrac ?? 0.32, (v) => upd({ closeUpperThirdMaxFrac: v }), 0.02)}
              {numField('Lookback swing SL (velas)', p.swingLookback ?? 6, (v) => upd({ swingLookback: v }))}
              {numField('Margem swing × ATR', p.swingBelowAtrMult ?? 0.14, (v) => upd({ swingBelowAtrMult: v }), 0.02)}
              {numField('Folga SL vs EMA lenta (%)', p.slowEmaStopBufferPct ?? 0.12, (v) => upd({ slowEmaStopBufferPct: v }), 0.02)}
              {numField('SL mínimo (% entrada)', p.minStopDistancePct ?? 0.22, (v) => upd({ minStopDistancePct: v }), 0.02)}
              {numField('SL máximo (% entrada)', p.maxStopDistancePct ?? 2.9, (v) => upd({ maxStopDistancePct: v }), 0.05)}
              {numField('Fresh break (× ATR)', p.freshBreakAtrFrac ?? 0.07, (v) => upd({ freshBreakAtrFrac: v }), 0.01)}
              {numField('Máximo símbolos', p.symbolLimit ?? 80, (v) => upd({ symbolLimit: v }))}
              {numField('Risk-reward TP1', p.rewardRisk1 ?? 1.65, (v) => upd({ rewardRisk1: v }), 0.05)}
              {numField('Risk-reward TP2', p.rewardRisk2 ?? 3.2, (v) => upd({ rewardRisk2: v }), 0.05)}
              {numField('TP1 — % da posição', p.tp1PositionPct ?? 55, (v) => upd({ tp1PositionPct: v }))}
              {numField('TP2 — % da posição', p.tp2PositionPct ?? 35, (v) => upd({ tp2PositionPct: v }))}
            </div>
          </div>
        );

      case 'PIVOT_BOSS_BEAR_15M':
      case 'PIVOT_BOSS_BEAR_1H':
        return (
          <div className="space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Só <strong>VENDA</strong>. Universo = <strong>Scanner 1 top {p.universeTopN ?? 30}</strong>.
              Pullback EMA30 + vela bear forte (sem exigir EMA12/30 abaixo EMA80). SL +{((p.stopLossPct ?? 0.07) * 100).toFixed(0)}%;
              TP1 −{((p.tp1Pct ?? 0.09) * 100).toFixed(0)}% ({p.tp1Position ?? 50}% pos.).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {numField('Top N Scanner 1', p.universeTopN ?? 30, (v) => upd({ universeTopN: v }))}
              {numField('Pullback EMA30 (velas)', p.pullbackMaxBars ?? 2, (v) => upd({ pullbackMaxBars: v }))}
              {numField('SL (%) acima entrada', (p.stopLossPct ?? 0.07) * 100, (v) => upd({ stopLossPct: v / 100 }), 0.5)}
              {numField('TP1 (%) abaixo entrada', (p.tp1Pct ?? 0.09) * 100, (v) => upd({ tp1Pct: v / 100 }), 0.5)}
              {numField('TP1 — % da posição', p.tp1Position ?? 50, (v) => upd({ tp1Position: v }))}
              {numField('Horas até fechar restante', p.closeAfterHours ?? 24, (v) => upd({ closeAfterHours: v }))}
            </div>
          </div>
        );

      case 'ACCUMULATION_BREAKOUT_15M':
        return (
          <div className="space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Velas <strong>15m</strong>; só <strong>COMPRA</strong>. Sinal quando o <strong>fecho</strong> da última
              vela rompe acima do <strong>máximo das últimas {p.breakoutLookback ?? 10} velas</strong> (rompimento de
              acumulação). Universo = <strong>Scanner 1 ranks {p.minScannerRank ?? 11}–{p.maxScannerRank ?? 40}</strong>{' '}
              (exclui top 10). Força máx. <strong>{p.maxStrength ?? 75}</strong>. SL -{((p.stopLossPct ?? 0.07) * 100).toFixed(0)}% fixo; TP1 = risco × {p.rewardRisk1 ?? 1.5}.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {numField('Velas de acumulação (lookback)', p.breakoutLookback ?? 10, (v) => upd({ breakoutLookback: v }))}
              {numField('Confirmação volume (× média)', p.volumeMultiplier ?? 1, (v) => upd({ volumeMultiplier: v }), 0.1)}
              {numField('SL (%) fixo abaixo entrada', (p.stopLossPct ?? 0.07) * 100, (v) => upd({ stopLossPct: v / 100 }), 0.5)}
              {numField('Risk-reward TP1', p.rewardRisk1 ?? 1.5, (v) => upd({ rewardRisk1: v }), 0.1)}
              {numField('TP1 — % da posição', p.tp1Position ?? 50, (v) => upd({ tp1Position: v }))}
              {numField('Horas até fechar restante', p.closeAfterHours ?? 24, (v) => upd({ closeAfterHours: v }))}
              {numField('Rank mín. Scanner 1', p.minScannerRank ?? 11, (v) => upd({ minScannerRank: v }))}
              {numField('Rank máx. Scanner 1', p.maxScannerRank ?? 40, (v) => upd({ maxScannerRank: v }))}
              {numField('Força máxima do sinal', p.maxStrength ?? 75, (v) => upd({ maxStrength: v }))}
            </div>
            <label className="flex items-center gap-2 max-w-md text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-gray-300 dark:border-gray-600"
                checked={p.requireBullishClose !== false}
                onChange={(e) => upd({ requireBullishClose: e.target.checked })}
              />
              <span>Exigir vela de fecho positivo (close &gt; open) no rompimento</span>
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-500">
              Confirmação de volume: 0 desactiva; 1 exige volume ≥ média das velas de acumulação. SL fixo em % abaixo
              da entrada; TP1 = (entrada − SL) × risk-reward.
            </p>
          </div>
        );

      case 'EMA80_SMA7_BREAKDOWN_15M':
        return (
          <div className="space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Velas <strong>15m</strong>; só <strong>VENDA</strong>. Universo = <strong>Scanner 1 top {p.universeTopN ?? 50}</strong>.
              Entrada: preço <strong>abaixo da EMA{p.emaPeriod ?? 80}</strong> com <strong>SMA({p.smaPeriod ?? 7}) &gt; EMA{p.emaPeriod ?? 80}</strong>
              {p.requireCrossDown !== false ? ' (rompimento na vela actual)' : ''}. SL +{((p.stopLossPct ?? 0.08) * 100).toFixed(0)}%;
              TP1 -{((p.tp1Pct ?? 0.2) * 100).toFixed(0)}% ({p.tp1Position ?? 50}% pos.).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {numField('EMA período', p.emaPeriod ?? 80, (v) => upd({ emaPeriod: v }))}
              {numField('SMA período', p.smaPeriod ?? 7, (v) => upd({ smaPeriod: v }))}
              {numField('Scanner 1 top N', p.universeTopN ?? 50, (v) => upd({ universeTopN: v }))}
              {numField('SL (%) acima entrada', (p.stopLossPct ?? 0.08) * 100, (v) => upd({ stopLossPct: v / 100 }), 0.5)}
              {numField('TP1 (%) abaixo entrada', (p.tp1Pct ?? 0.2) * 100, (v) => upd({ tp1Pct: v / 100 }), 0.5)}
              {numField('TP1 — % da posição', p.tp1Position ?? 50, (v) => upd({ tp1Position: v }))}
              {numField('Horas até fechar restante', p.closeAfterHours ?? 24, (v) => upd({ closeAfterHours: v }))}
            </div>
            <label className="flex items-center gap-2 max-w-md text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-gray-300 dark:border-gray-600"
                checked={p.requireCrossDown !== false}
                onChange={(e) => upd({ requireCrossDown: e.target.checked })}
              />
              <span>Exigir rompimento (vela anterior fechou ≥ EMA80)</span>
            </label>
          </div>
        );

      case 'SCANNER2_SHORT_LEADER_24H':
        return (
          <div className="space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              <strong>SHORT</strong> nos <strong>ranks #1–#2</strong> do Scanner 2 (top subidas 24h). Após cada scan
              4h; pump 24h ≥25%; <strong>bloqueia 10h–14h PT</strong>. Fecho automático <strong>24h</strong>. SL +40%.
              Até 2 posições em paralelo. Corre após{' '}
              <code className="text-[10px]">run-universe-scans</code>.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {numField('Rank mín.', p.rankMin ?? 1, (v) => upd({ rankMin: v }))}
              {numField('Rank máx.', p.rankMax ?? 2, (v) => upd({ rankMax: v }))}
              {numField('Pump 24h mín. (%)', p.minPumpPct24h ?? 25, (v) => upd({ minPumpPct24h: v }))}
              {numField('SL (%) acima entrada (short)', (p.stopLossPct ?? 0.4) * 100, (v) => upd({ stopLossPct: v / 100 }), 0.5)}
              {numField('Horas até fecho', p.closeAfterHours ?? 24, (v) => upd({ closeAfterHours: v }))}
              {numField('Força mín. auto-exec', p.autoExecuteMinStrength ?? 80, (v) => upd({ autoExecuteMinStrength: v }))}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-500">
              Horas PT bloqueadas: {(p.blockedEntryHoursPt ?? [10, 11, 12, 13, 14]).join('h, ')}h (editar JSON se precisar)
            </p>
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
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">Estratégias</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 max-w-3xl">
          Estratégia <strong>Ativa</strong> = o motor gera sinais quando as regras batem certo. Em cada cartão,{' '}
          <strong>COMPRA / VENDA</strong> controla só se ordens são enviadas à corretora (auto-execução no cron ou botão
          executar): OFF mantém o sinal na app mas não abre posição nessa direcção.
        </p>

        <div className="mb-8 bg-white dark:bg-gray-800 rounded-xl shadow p-6 border border-gray-200 dark:border-gray-700">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Estratégias activas</h2>
            {!loading && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {activeCount} de {strategies.length} activas
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {CRON_GROUPS.map((group) => (
              <div
                key={group.key}
                className="rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40 p-4"
              >
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{group.title}</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{group.description}</p>
                <ul className="mt-3 space-y-1.5">
                  {strategies
                    .filter((s) => STRATEGY_CATALOG[s.name]?.cron === group.key)
                    .map((s) => (
                      <li key={s.id} className="text-xs text-gray-700 dark:text-gray-300 flex items-center gap-2">
                        <span
                          className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                            s.isActive ? 'bg-green-500' : 'bg-gray-400'
                          }`}
                        />
                        <span>{s.displayName}</span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Rotações Scanner 5/6 estão no projeto <strong>bot_cripto</strong>.
            Scanner 1: menu <strong>Origem de dados</strong> ou cron <strong>run-universe-scans</strong> (4 h).
          </p>
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
            {strategies.map((strategy) => {
              const meta = STRATEGY_CATALOG[strategy.name];
              const sellOnly =
                strategy.name === 'PIVOT_BOSS_BEAR_15M' ||
                strategy.name === 'PIVOT_BOSS_BEAR_1H' ||
                strategy.name === 'EMA80_SMA7_BREAKDOWN_15M' ||
                strategy.name === 'SCANNER2_SHORT_LEADER_24H' ||
                strategy.name === 'RSI_OVERBOUGHT_DROP_1H' ||
                strategy.name === 'RSI_OVERBOUGHT_DROP_LEGACY_1H';
              const buyOnly =
                strategy.name === 'EMA_SCALPING' ||
                strategy.name === 'ACCUMULATION_BREAKOUT_15M' ||
                strategy.name === 'SCANNER1_TOP5';

              return (
              <div
                key={strategy.id}
                className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 border border-gray-200 dark:border-gray-700"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex-1">
                    <div className="flex items-center flex-wrap gap-2 mb-2">
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
                      {meta && (
                        <>
                          <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">
                            {meta.cronLabel}
                          </span>
                          <span className="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200">
                            Velas {meta.timeframe}
                          </span>
                        </>
                      )}
                    </div>
                    {meta?.universe && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                        Universo: {meta.universe}
                      </p>
                    )}
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

                {/* Toggles BUY / SELL — antes da exchange para ficar visível */}
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Auto-execução na corretora
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    Enviar ordens automáticas (cron) ou manualmente nesta direcção. OFF não impede sinais — só evita
                    abrir posição COMPRA ou VENDA na exchange seleccionada abaixo.
                    {sellOnly ? (
                      <span className="block mt-1 text-amber-700 dark:text-amber-300">
                        Nota: esta estratégia só gera <strong>VENDAS</strong>; activar COMPRA não produz longs.
                      </span>
                    ) : buyOnly ? (
                      <span className="block mt-1 text-amber-700 dark:text-amber-300">
                        Nota: esta estratégia só gera <strong>COMPRAS</strong> (tendência de alta + retração); activar VENDA não produz shorts.
                      </span>
                    ) : null}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {(['BUY', 'SELL'] as const).map((dir) => {
                      const params   = parseStrategyParams(strategy.params);
                      const field    = dir === 'BUY' ? 'allowBuy' : 'allowSell';
                      const enabled  = params[field] !== false;
                      const isSaving = saving === strategy.id + dir;
                      return (
                        <button
                          key={dir}
                          type="button"
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

                {/* Selector Exchange */}
                {(() => {
                  const params = parseStrategyParams(strategy.params);
                  const currentEx = params.exchange || 'binance';
                  return (
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Exchange</h3>
                      <div className="flex gap-2">
                        {(['binance', 'bybit'] as const).map((ex) => (
                          <button
                            key={ex}
                            type="button"
                            onClick={() => handleSetExchange(strategy, ex)}
                            disabled={saving === strategy.id + 'exchange'}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-all ${
                              currentEx === ex
                                ? ex === 'bybit'
                                  ? 'bg-yellow-400 border-yellow-500 text-yellow-900 dark:bg-yellow-500 dark:text-yellow-950'
                                  : 'bg-blue-500 border-blue-600 text-white dark:bg-blue-600'
                                : 'bg-gray-100 border-gray-300 text-gray-400 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                          >
                            {ex === 'bybit' ? '🟡 Bybit' : '🔵 Binance'}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
                    Parâmetros
                  </h3>
                  {renderStrategyParams(strategy)}
                </div>
              </div>
              );
            })}
          </div>
        )}

        <Disclaimer />
      </main>
    </div>
  );
}






