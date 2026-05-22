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

  const renderStrategyParams = (strategy: Strategy) => {
    const p = parseStrategyParams(strategy.params);
    const upd = (patch: object) => handleUpdateParams(strategy, { ...p, ...patch });

    switch (strategy.name) {
      case 'RSI':
        return (
          <div className="space-y-3">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Timeframe <strong>1h</strong>. Universo = scan <strong>MA30 entre −6% e +1% vs MA200 (1h)</strong> (só define quais pares analisar). Linha lenta = <strong>SMA sobre o RSI</strong> (TradingView: RSI + Smoothing).{' '}
              <strong>BUY</strong>: lenta cruza <strong>para cima</strong> do nível. <strong>SELL</strong>: lenta <strong>passa para baixo</strong> do nível (ex.: 47). Sem filtro MA200 no preço.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {numField('Período RSI', p.period ?? 14, (v) => upd({ period: v }))}
              {numField('Suavização: período SMA sobre o RSI', p.rsiSmoothLength ?? 21, (v) => upd({ rsiSmoothLength: v }))}
              {numField('Nível de referência (cruzamento)', p.rsiRefLevel ?? 47, (v) => upd({ rsiRefLevel: v }), 0.5)}
              {numField('SL compra (%)', p.buyStopPercent ?? 5, (v) => upd({ buyStopPercent: v }), 0.5)}
              {numField('TP compra: valorização vs entrada (%)', p.rsiBuyGainTpPct ?? 43, (v) => upd({ rsiBuyGainTpPct: v }), 0.5)}
              {numField('TP compra: % da posição', p.rsiBuyGainTpPositionPct ?? 50, (v) => upd({ rsiBuyGainTpPositionPct: v }), 1)}
              {numField('SL venda (%)', p.sellStopPercent ?? 5, (v) => upd({ sellStopPercent: v }), 0.5)}
              {numField('TP venda: valorização vs entrada (%)', p.rsiSellGainTpPct ?? 43, (v) => upd({ rsiSellGainTpPct: v }), 0.5)}
              {numField('TP venda: % da posição', p.rsiSellGainTpPositionPct ?? 50, (v) => upd({ rsiSellGainTpPositionPct: v }), 1)}
              {numField('Saída temporal (h)', p.closeAfterHours ?? 24, (v) => upd({ closeAfterHours: v }))}
            </div>
          </div>
        );

      case 'RSI_BYBIT_15M':
        return (
          <div className="space-y-3">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Timeframe <strong>15m</strong>. Universo = tabela <strong>Ma30Above6Pct</strong> (<strong>MA30 &gt; 9% da MA200</strong> em 1h); actualiza o scan &quot;MA30 &gt; 9% MA200&quot; antes de gerar sinais. Linha lenta = <strong>SMA sobre o RSI</strong>.{' '}
              <strong>BUY</strong>: lenta cruza <strong>para cima</strong> do nível. <strong>SELL</strong>: lenta <strong>passa para baixo</strong> do nível (ex.: 47). Mesmos SL/TP parciais que o RSI 1h.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {numField('Período RSI', p.period ?? 14, (v) => upd({ period: v }))}
              {numField('Suavização: período SMA sobre o RSI', p.rsiSmoothLength ?? 21, (v) => upd({ rsiSmoothLength: v }))}
              {numField('Nível de referência (cruzamento)', p.rsiRefLevel ?? 47, (v) => upd({ rsiRefLevel: v }), 0.5)}
              {numField('SL compra (%)', p.buyStopPercent ?? 5, (v) => upd({ buyStopPercent: v }), 0.5)}
              {numField('TP compra: valorização vs entrada (%)', p.rsiBuyGainTpPct ?? 43, (v) => upd({ rsiBuyGainTpPct: v }), 0.5)}
              {numField('TP compra: % da posição', p.rsiBuyGainTpPositionPct ?? 50, (v) => upd({ rsiBuyGainTpPositionPct: v }), 1)}
              {numField('SL venda (%)', p.sellStopPercent ?? 5, (v) => upd({ sellStopPercent: v }), 0.5)}
              {numField('TP venda: valorização vs entrada (%)', p.rsiSellGainTpPct ?? 43, (v) => upd({ rsiSellGainTpPct: v }), 0.5)}
              {numField('TP venda: % da posição', p.rsiSellGainTpPositionPct ?? 50, (v) => upd({ rsiSellGainTpPositionPct: v }), 1)}
              {numField('Saída temporal (h)', p.closeAfterHours ?? 24, (v) => upd({ closeAfterHours: v }))}
            </div>
          </div>
        );

      case 'RSI_15M':
        return (
          <div className="space-y-3">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Universo = scan <strong>MA30 entre −6% e +1% vs MA200 (1h)</strong> (menu &quot;MA30 −6%…+1% vs MA200&quot;). Actualiza esse scan antes de gerar sinais.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {numField('Período RSI', p.period ?? 14, (v) => upd({ period: v }))}
            {numField('RSI vela anterior abaixo de', p.previousBelowThreshold ?? 28, (v) => upd({ previousBelowThreshold: v }))}
            {numField('RSI atual fecha acima de', p.buyThreshold ?? 32, (v) => upd({ buyThreshold: v }))}
            {numField('SL (%)', p.stopPercent ?? 3, (v) => upd({ stopPercent: v }), 0.5)}
            {numField('Máx. símbolos', p.symbolLimit ?? 400, (v) => upd({ symbolLimit: v }))}
            </div>
          </div>
        );

      case 'VOLUME_SPIKE':
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {numField('Multiplicador de volume (×)', p.volumeMultiplier ?? 20, (v) => upd({ volumeMultiplier: v }))}
            {numField('Lookback (horas)', p.lookbackHours ?? 20, (v) => upd({ lookbackHours: v }))}
          </div>
        );

      case 'MA_CROSS_5M':
      case 'MA_CROSS_1H': {
        const is1h = strategy.name === 'MA_CROSS_1H';
        const defaultSlSpread = is1h ? 7 : 15;
        const maPairLabel = 'MA12 / MA30';
        const diffLabel = 'MA12 / MA30';
        return (
          <div className="space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Velas <strong>{is1h ? '1h' : '15m'}</strong> — <strong>{maPairLabel}</strong>. Mesma lógica de spread: rápida&gt;lenta (ou &lt;) e |rápida−lenta|/lenta &gt; limiar de entrada; fecho quando a diferença comprime abaixo do limiar de saída (compressão).
              <>
                {!is1h && ' O cron corre a cada 15 min.'} Símbolos ={' '}
                <strong>Scanner 1</strong> (fecho +2–10% acima SMA200 em 1h); actualize em Origem de dados → Scanner 1
                ou aguarde o cron <strong>run-universe-scans</strong> (cada 4 h).
              </>
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
              {numField(`Entrada: dif. ${diffLabel} (%)`, p.entryDiffPct ?? (is1h ? 1.2 : 0.9), (v) => upd({ entryDiffPct: v }), 0.1)}
              {numField(`Saída/fecho: dif. ${diffLabel} (%)`, p.exitDiffPct ?? (is1h ? 0.8 : 0.5), (v) => upd({ exitDiffPct: v }), 0.1)}
              {numField('SL (%)', p.stopPercent ?? defaultSlSpread, (v) => upd({ stopPercent: v }), 0.5)}
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
                p.buyBlockAbsCloseDistanceFromMa200Pct ?? (is1h ? 8 : 0),
                (v) => upd({ buyBlockAbsCloseDistanceFromMa200Pct: v }),
                0.5
              )}
              {numField(
                `SELL: máx. |preço − MA lenta| / MA lenta (${'MA30'}) (%)`,
                p.sellBlockAbsCloseDistanceFromMa200Pct ?? (is1h ? 8 : 6),
                (v) => upd({ sellBlockAbsCloseDistanceFromMa200Pct: v }),
                0.5
              )}
            </div>
            <div className="max-w-md">
              {numField(
                'Entrada: máx. |MA30 − MA200| / MA200 (%)',
                p.entryMaxAbsPctMa30VsMa200 ?? (is1h ? 8 : 0),
                (v) => upd({ entryMaxAbsPctMa30VsMa200: v }),
                0.5
              )}
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                MA200 = período 200 nas mesmas velas que o par MA12/MA30. Só emite BUY/SELL se esta distância for ≤ ao limiar; 0 desactiva.
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

      case 'MA_VOLATILE':
      case 'MA200_VOLATILE': {
        const isMa60 = strategy.name === 'MA_VOLATILE';
        const defaultBuyStop = isMa60 ? 15 : 4;
        const defaultSellStop = isMa60 ? 15 : 4;
        const defaultBuyTp1 = isMa60 ? 30 : 80;
        const defaultBuyTp1Position = isMa60 ? 40 : 70;
        const defaultBuyTp2 = isMa60 ? 60 : 0;
        const defaultBuyTp2Position = isMa60 ? 30 : 0;
        const defaultSellTp1 = isMa60 ? 30 : 80;
        const defaultSellTp1Position = isMa60 ? 40 : 70;
        const defaultSellTp2 = isMa60 ? 60 : 0;
        const defaultSellTp2Position = isMa60 ? 30 : 0;
        return (
          <div className="space-y-4">
            {isMa60 && (
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Universo = resultados do scan <strong>MA Cross Proximidade</strong> (menu). Actualiza esse scan antes de gerar sinais.
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {numField('Confirmação (%)', p.confirmationPct ?? 2, (v) => upd({ confirmationPct: v }), 0.5)}
              {isMa60
                ? numField('Período MA', p.ma60Period ?? 60, (v) => upd({ ma60Period: v }))
                : numField('Período MA', p.ma200Period ?? 200, (v) => upd({ ma200Period: v }))}
              {!isMa60 && numField('Distância máx. à MA (%)', p.maxDistancePct ?? 10, (v) => upd({ maxDistancePct: v }), 0.5)}
              {!isMa60 && numField('Máx. símbolos', p.symbolLimit ?? 500, (v) => upd({ symbolLimit: v }))}
              {!isMa60 && numField('Volume mínimo', p.minQuoteVolume ?? 100000, (v) => upd({ minQuoteVolume: v }))}
            </div>
            <p className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide">BUY</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {numField('SL (%)', p.buyStopPercent ?? defaultBuyStop, (v) => upd({ buyStopPercent: v }), 0.5)}
              {numField('TP1 (%) | Posição (%)', p.buyTp1Percent ?? defaultBuyTp1, (v) => upd({ buyTp1Percent: v }), 0.5)}
              {numField('TP1 Posição (%)', p.buyTp1Position ?? defaultBuyTp1Position, (v) => upd({ buyTp1Position: v }))}
              {numField('TP2 (%)', p.buyTp2Percent ?? defaultBuyTp2, (v) => upd({ buyTp2Percent: v }), 0.5)}
              {numField('TP2 Posição (%)', p.buyTp2Position ?? defaultBuyTp2Position, (v) => upd({ buyTp2Position: v }))}
            </div>
            <p className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wide">SELL</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {numField('SL (%)', p.sellStopPercent ?? defaultSellStop, (v) => upd({ sellStopPercent: v }), 0.5)}
              {numField('TP1 (%)', p.sellTp1Percent ?? defaultSellTp1, (v) => upd({ sellTp1Percent: v }), 0.5)}
              {numField('TP1 Posição (%)', p.sellTp1Position ?? defaultSellTp1Position, (v) => upd({ sellTp1Position: v }))}
              {numField('TP2 (%)', p.sellTp2Percent ?? defaultSellTp2, (v) => upd({ sellTp2Percent: v }), 0.5)}
              {numField('TP2 Posição (%)', p.sellTp2Position ?? defaultSellTp2Position, (v) => upd({ sellTp2Position: v }))}
            </div>
          </div>
        );
      }

      case 'EMA_SCALPING':
        return (
          <div className="space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Timeframe <strong>15m</strong>; dados <strong>Binance Futures</strong> (endpoint interno igual às restantes estratégias). Inspirado em cenários de scalp com fita de EMA: tendência com subida da EMA lenta; entrada em vela forte (SB) ou após pullback à zona da fita. Só existe lógica de <strong>COMPRA</strong>. Universo = Top movers por variação 1h, limitado pelo máximo abaixo.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {numField('EMA rápida (topo bullish)', p.ribbonFastPeriod ?? 8, (v) => upd({ ribbonFastPeriod: v }))}
              {numField('EMA lenta (base fita)', p.ribbonSlowPeriod ?? 55, (v) => upd({ ribbonSlowPeriod: v }))}
              {numField('ATR período', p.atrPeriod ?? 14, (v) => upd({ atrPeriod: v }))}
              {numField('Lookback inclinação (velas)', p.slopeLookback ?? 5, (v) => upd({ slopeLookback: v }))}
              {numField('Inclinação mín. EMA lenta (%)', p.minSlowEmaSlopePct ?? 0.85, (v) => upd({ minSlowEmaSlopePct: v }), 0.05)}
              {numField('Barras lateral (consol.)', p.consolidationLookback ?? 14, (v) => upd({ consolidationLookback: v }))}
              {numField('Máx. range consolidação (%)', p.consolidationMaxRangePct ?? 1.35, (v) => upd({ consolidationMaxRangePct: v }), 0.05)}
              {numField('Barras máx. pullback', p.pullbackMaxBars ?? 10, (v) => upd({ pullbackMaxBars: v }))}
              {numField('Corpo mínimo / range', p.strongBodyOfRangeMin ?? 0.58, (v) => upd({ strongBodyOfRangeMin: v }), 0.01)}
              {numField('Corpo mínimo × ATR', p.strongBodyMinAtrMult ?? 0.42, (v) => upd({ strongBodyMinAtrMult: v }), 0.02)}
              {numField('Máximo símbolos', p.symbolLimit ?? 80, (v) => upd({ symbolLimit: v }))}
              {numField('Risk-reward TP1', p.rewardRisk1 ?? 1.65, (v) => upd({ rewardRisk1: v }), 0.05)}
              {numField('Risk-reward TP2', p.rewardRisk2 ?? 3.2, (v) => upd({ rewardRisk2: v }), 0.05)}
              {numField('TP1 — % da posição', p.tp1PositionPct ?? 55, (v) => upd({ tp1PositionPct: v }))}
              {numField('TP2 — % da posição', p.tp2PositionPct ?? 35, (v) => upd({ tp2PositionPct: v }))}
            </div>
          </div>
        );

      case 'RSI_OVERBOUGHT_DROP_1H':
        return (
          <div className="space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Timeframe <strong>1h</strong>; só <strong>VENDA</strong>. Universo = <strong>Scanner 2</strong> (±10%
              EMA80). Entrada: RSI cruza de ≥70 para baixo (queda ≥4 pts) com preço &gt;12% acima da EMA80. SL/TP em
              % vs entrada (short).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {numField('Período RSI', p.rsiPeriod ?? 14, (v) => upd({ rsiPeriod: v }))}
              {numField('Nível sobrecompra', p.overboughtLevel ?? 70, (v) => upd({ overboughtLevel: v }))}
              {numField('Queda mín. RSI (pts)', p.minDropPoints ?? 4, (v) => upd({ minDropPoints: v }))}
              {numField('Afastamento mín. EMA80 (%)', p.minDistancePct ?? 12, (v) => upd({ minDistancePct: v }), 0.5)}
            </div>
            <p className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wide">SELL — SL / TP</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {numField('SL (%) acima entrada', (p.stopLossPct ?? 0.08) * 100, (v) => upd({ stopLossPct: v / 100 }), 0.5)}
              {numField('TP1 (%) abaixo entrada', p.sellTp1Percent ?? 9, (v) => upd({ sellTp1Percent: v }), 0.5)}
              {numField('TP1 — % da posição', p.sellTp1Position ?? 30, (v) => upd({ sellTp1Position: v }))}
              {numField('TP2 (%) abaixo entrada', p.sellTp2Percent ?? 19, (v) => upd({ sellTp2Percent: v }), 0.5)}
              {numField('TP2 — % da posição', p.sellTp2Position ?? 40, (v) => upd({ sellTp2Position: v }))}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Restante da posição ({Math.max(0, 100 - Number(p.sellTp1Position ?? 30) - Number(p.sellTp2Position ?? 40))}
              %) — fecho manual.
            </p>
          </div>
        );

      case 'EMA_SCALPING_SELL':
        return (
          <div className="space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Timeframe <strong>15m</strong>; dados <strong>Binance Futures</strong>. Espelho bearish do EMA Ribbon: fita em queda, EMA rápida abaixo da lenta; pullback ou consolidação junto à fita; vela <strong>bear</strong> forte a fechar por baixo da EMA rápida. Só <strong>VENDA</strong>. Universo = Top movers 1h (limite abaixo).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {numField('EMA rápida (base bear)', p.ribbonFastPeriod ?? 8, (v) => upd({ ribbonFastPeriod: v }))}
              {numField('EMA lenta (topo fita)', p.ribbonSlowPeriod ?? 55, (v) => upd({ ribbonSlowPeriod: v }))}
              {numField('ATR período', p.atrPeriod ?? 14, (v) => upd({ atrPeriod: v }))}
              {numField('Lookback inclinação (velas)', p.slopeLookback ?? 5, (v) => upd({ slopeLookback: v }))}
              {numField('Inclinação mín. EMA lenta (queda, %)', p.minSlowEmaSlopePct ?? 0.85, (v) => upd({ minSlowEmaSlopePct: v }), 0.05)}
              {numField('Barras lateral (consol.)', p.consolidationLookback ?? 14, (v) => upd({ consolidationLookback: v }))}
              {numField('Máx. range consolidação (%)', p.consolidationMaxRangePct ?? 1.35, (v) => upd({ consolidationMaxRangePct: v }), 0.05)}
              {numField('Mín. velas com close > EMA rápida (lateral)', p.minBarsAboveFastInConsolidation ?? Math.ceil((p.consolidationLookback ?? 14) * 0.55), (v) => upd({ minBarsAboveFastInConsolidation: v }))}
              {numField('Barras máx. pullback', p.pullbackMaxBars ?? 10, (v) => upd({ pullbackMaxBars: v }))}
              {numField('Corpo mínimo / range', p.strongBodyOfRangeMin ?? 0.58, (v) => upd({ strongBodyOfRangeMin: v }), 0.01)}
              {numField('Corpo mínimo × ATR', p.strongBodyMinAtrMult ?? 0.42, (v) => upd({ strongBodyMinAtrMult: v }), 0.02)}
              {numField('Máximo quartil inferior (fecha perto do low)', p.closeLowerThirdMaxFrac ?? 0.32, (v) => upd({ closeLowerThirdMaxFrac: v }), 0.02)}
              {numField('Lookback swing SL (velas)', p.swingLookback ?? 6, (v) => upd({ swingLookback: v }))}
              {numField('Margem swing × ATR', p.swingAboveAtrMult ?? 0.14, (v) => upd({ swingAboveAtrMult: v }), 0.02)}
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

      default:
        return <p className="text-sm text-gray-500 dark:text-gray-400">Sem parâmetros configuráveis</p>;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">Estratégias</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6 max-w-3xl">
          Estratégia <strong>Ativa</strong> = o motor gera sinais quando as regras batem certo. Em cada cartão,{' '}
          <strong>COMPRA / VENDA</strong> controla só se ordens são enviadas à corretora (auto-execução no cron ou botão
          executar): OFF mantém o sinal na app mas não abre posição nessa direcção. Valores em{' '}
          <code className="text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">params.allowBuy</code> e{' '}
          <code className="text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">params.allowSell</code>.
        </p>

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

                {/* Toggles BUY / SELL — antes da exchange para ficar visível */}
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Auto-execução na corretora
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    Enviar ordens automáticas (cron) ou manualmente nesta direcção. OFF não impede sinais — só evita
                    abrir posição COMPRA ou VENDA na exchange seleccionada abaixo.
                    {(strategy.name === 'RSI_15M' ||
                      strategy.name === 'EMA_SCALPING' ||
                      strategy.name === 'EMA_SCALPING_SELL') ? (
                      <span className="block mt-1 text-amber-700 dark:text-amber-300">
                        {strategy.name === 'RSI_15M' ? (
                          <>Nota: RSI_15M só gera compras na lógica actual; activar VENDA não produz shorts até a estratégia suportar SELL.</>
                        ) : strategy.name === 'EMA_SCALPING_SELL' ? (
                          <>Nota: EMA_SCALPING_SELL só gera VENDAS; activar COMPRA não produz longs.</>
                        ) : (
                          <>Nota: EMA_SCALPING só gera COMPRAS; activar VENDA não altera comportamento (use EMA_SCALPING_SELL para shorts).</>
                        )}
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
            ))}
          </div>
        )}

        <Disclaimer />
      </main>
    </div>
  );
}






