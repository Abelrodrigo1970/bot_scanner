import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ensureDatabase } from '@/lib/db-init';
import {
  backfillMaCross5mSignalNames,
  MA_CROSS_15M_STRATEGY_DESCRIPTION,
  MA_CROSS_5M_DESC,
  MA_CROSS_5M_DISPLAY,
  RSI_15M_STRATEGY_DESCRIPTION,
  RSI_MA30_SCAN_UNIVERSE_DESCRIPTION,
  syncRsiMaVolatileUniverseDescriptions,
} from '@/lib/strategyMigrations';

const RSI_15M_DEFAULT_PARAMS = {
  period: 14,
  previousBelowThreshold: 28,
  buyThreshold: 32,
  stopPercent: 3,
  symbolLimit: 400,
  minQuoteVolume: 500000,
  allowBuy: true,
  allowSell: false,
  exchange: 'bybit',
};

/** RSI 1h: SMA sobre RSI vs nível 47 (TradingView: RSI 14 + Smoothing SMA 21). */
const RSI_MAIN_DEFAULT_PARAMS = {
  period: 14,
  rsiSmoothLength: 21,
  rsiRefLevel: 47,
  buyStopPercent: 5,
  sellStopPercent: 5,
  rsiBuyGainTpPct: 43,
  rsiBuyGainTpPositionPct: 50,
  rsiSellGainTpPct: 43,
  rsiSellGainTpPositionPct: 50,
  closeAfterHours: 24,
  allowBuy: true,
  allowSell: true,
  exchange: 'binance',
};

const RSI_BYBIT_15M_DEFAULT_PARAMS = {
  ...RSI_MAIN_DEFAULT_PARAMS,
  exchange: 'bybit' as const,
};

const RSI_BYBIT_15M_UNIVERSE_DESCRIPTION =
  'Mesma lógica que o RSI 1h (SMA sobre RSI vs nível, TradingView): velas 15m. Universo = tabela Ma30Above6Pct (MA30 > 9% da MA200 em 1h); actualiza o menu «MA30 > 9% MA200» antes de gerar sinais.';

const MA_CROSS_15M_DEFAULT_PARAMS = {
  ma30Period: 30,
  ma200Period: 200,
  maType: 'EMA' as const,
  /** Mesma filosofia MA12×MA30: entrada por spread, não só no cruzamento */
  useDiffMode: true,
  confirmationPct: 0,
  entryDiffPct: 0.9,
  exitDiffPct: 0.5,
  stopPercent: 5,
  sellBlockAbsCloseDistanceFromMa200Pct: 6,
  ma12x30RepeatWhileTrend: true,
  ma12x30RepeatMinSpreadDeltaPct: 0.06,
  ma12x30GainTpPct: 44,
  ma12x30GainTpPositionPct: 60,
  symbolLimit: 500,
  minQuoteVolume: 100000,
  allowBuy: true,
  allowSell: true,
  exchange: 'bybit' as const,
};

const MA_CROSS_5M_DEFAULT_PARAMS = {
  ...MA_CROSS_15M_DEFAULT_PARAMS,
  ma30Period: 12,
  ma200Period: 30,
  exchange: 'binance' as const,
  entryDiffPct: 0.9,
  exitDiffPct: 0.5,
  stopPercent: 5,
  ma12x30RepeatWhileTrend: true,
  ma12x30RepeatMinSpreadDeltaPct: 0.06,
  ma12x30GainTpPct: 44,
  ma12x30GainTpPositionPct: 60,
};

const MA_CROSS_1H_DEFAULT_PARAMS = {
  ...MA_CROSS_5M_DEFAULT_PARAMS,
  useDiffMode: true,
  entryDiffPct: 1.8,
  /** Fecho quando |MA12−MA30|/MA30×100 &lt; este valor */
  exitDiffPct: 0.8,
  stopPercent: 7,
  exchange: 'bybit' as const,
  /** true = entrada só por spread na vela fechada (sem exigir transição na vela anterior) */
  ma12x30RepeatWhileTrend: true,
};

const EMA_SCALPING_DEFAULT_PARAMS = {
  ribbonFastPeriod: 8,
  ribbonSlowPeriod: 55,
  atrPeriod: 14,
  slopeLookback: 5,
  minSlowEmaSlopePct: 0.85,
  consolidationLookback: 14,
  consolidationMaxRangePct: 1.35,
  pullbackMaxBars: 10,
  strongBodyOfRangeMin: 0.58,
  strongBodyMinAtrMult: 0.42,
  symbolLimit: 80,
  rewardRisk1: 1.65,
  rewardRisk2: 3.2,
  tp1PositionPct: 55,
  tp2PositionPct: 35,
  allowBuy: true,
  allowSell: false,
  exchange: 'binance' as const,
};

const EMA_SCALPING_DESCRIPTION =
  'Scalping 15m tipo «EMA Ribbon»: só COMPRA. Fita = EMA rápida × EMA lenta (ex.: 8/55): tendência com subida forte da EMA lenta nos últimos N candles; cenário «lateral»: consolidação estreita e rompimento com vela bull forte (corpo alto vs range, perto da máxima) a fechar acima da EMA rápida; cenário «pullback»: toque dentro da zona da fita e continuação com vela forte. SL = mínimo entre swing low − margem por ATR e EMA lenta com folga %. TP por múltiplos de R. Dados Binance Futures (mesmo endpoint que fetchCandles). Universo = Top movers 1h (limite parametrizável).';

const EMA_SCALPING_SELL_DEFAULT_PARAMS = {
  ribbonFastPeriod: 8,
  ribbonSlowPeriod: 55,
  atrPeriod: 14,
  slopeLookback: 5,
  minSlowEmaSlopePct: 0.85,
  consolidationLookback: 14,
  consolidationMaxRangePct: 1.35,
  pullbackMaxBars: 10,
  strongBodyOfRangeMin: 0.58,
  strongBodyMinAtrMult: 0.42,
  symbolLimit: 80,
  rewardRisk1: 1.65,
  rewardRisk2: 3.2,
  tp1PositionPct: 55,
  tp2PositionPct: 35,
  allowBuy: false,
  allowSell: true,
  exchange: 'binance' as const,
};

const EMA_SCALPING_SELL_DESCRIPTION =
  'Scalping 15m «EMA Ribbon» só VENDA: fita descendente (EMA lenta em queda forte), EMA rápida por baixo da lenta; preço sob a fita; consolidação com fechos maioritariamente acima da EMA rápida (pullback) ou pullback tocando a fita; entrada em vela bear forte que fecha por baixo da EMA rápida. SL = máximo entre swing high + margem ATR e EMA lenta + folga %. TP por R (igual filosofia ao lado BUY). Binance Futures. Universo = Top movers 1h (limite parametrizável).';

async function ensureMissingStrategies() {
  const existingRsi15m = await prisma.strategy.findUnique({
    where: { name: 'RSI_15M' },
    select: { id: true },
  });

  if (!existingRsi15m) {
    await prisma.strategy.create({
      data: {
        name: 'RSI_15M',
        displayName: 'RSI 15m Reversal (28->32)',
        description: RSI_15M_STRATEGY_DESCRIPTION,
        isActive: true,
        params: JSON.stringify(RSI_15M_DEFAULT_PARAMS),
      },
    });
  }

  const existingRsiMain = await prisma.strategy.findUnique({
    where: { name: 'RSI' },
    select: { id: true, params: true, displayName: true, description: true },
  });

  if (!existingRsiMain) {
    await prisma.strategy.create({
      data: {
        name: 'RSI',
        displayName: 'RSI Top Volatilidade (SMA21×47)',
        description: RSI_MA30_SCAN_UNIVERSE_DESCRIPTION,
        isActive: true,
        params: JSON.stringify(RSI_MAIN_DEFAULT_PARAMS),
      },
    });
  } else {
    try {
      const p = existingRsiMain.params ? JSON.parse(existingRsiMain.params) : {};
      const next: Record<string, unknown> = { ...p };
      next.period = 14;
      next.rsiSmoothLength = 21;
      next.rsiRefLevel = 47;
      delete next.maPeriod;
      next.buyStopPercent = 5;
      next.sellStopPercent = 5;
      if (next.rsiBuyGainTpPct == null || next.rsiBuyGainTpPct === '') {
        next.rsiBuyGainTpPct = 43;
      }
      if (next.rsiBuyGainTpPositionPct == null || next.rsiBuyGainTpPositionPct === '') {
        next.rsiBuyGainTpPositionPct = 50;
      }
      if (next.rsiSellGainTpPct == null || next.rsiSellGainTpPct === '') {
        next.rsiSellGainTpPct = 43;
      }
      if (next.rsiSellGainTpPositionPct == null || next.rsiSellGainTpPositionPct === '') {
        next.rsiSellGainTpPositionPct = 50;
      }
      next.closeAfterHours = 24;
      if (next.allowBuy === undefined) next.allowBuy = true;
      if (next.allowSell === undefined) next.allowSell = true;
      if (next.exchange === undefined) next.exchange = 'binance';
      delete next.buyThreshold;
      delete next.sellThreshold;
      const newDesc = RSI_MA30_SCAN_UNIVERSE_DESCRIPTION;
      const needParams = JSON.stringify(next) !== JSON.stringify(p);
      const needMeta =
        existingRsiMain.displayName !== 'RSI Top Volatilidade (SMA21×47)' ||
        existingRsiMain.description !== newDesc;
      if (needParams || needMeta) {
        await prisma.strategy.update({
          where: { name: 'RSI' },
          data: {
            params: JSON.stringify(next),
            displayName: 'RSI Top Volatilidade (SMA21×47)',
            description: newDesc,
          },
        });
      }
    } catch (e) {
      console.warn('⚠️ RSI: falha ao migrar params:', e);
    }
  }

  const existingRsiBybit15m = await prisma.strategy.findUnique({
    where: { name: 'RSI_BYBIT_15M' },
    select: { id: true },
  });

  if (!existingRsiBybit15m) {
    await prisma.strategy.create({
      data: {
        name: 'RSI_BYBIT_15M',
        displayName: 'RSI Bybit 15m (SMA21×47)',
        description: RSI_BYBIT_15M_UNIVERSE_DESCRIPTION,
        isActive: true,
        params: JSON.stringify(RSI_BYBIT_15M_DEFAULT_PARAMS),
      },
    });
  } else {
    try {
      const rb = await prisma.strategy.findUnique({
        where: { name: 'RSI_BYBIT_15M' },
        select: { params: true, displayName: true, description: true },
      });
      if (rb) {
        const p = rb.params ? JSON.parse(rb.params) : {};
        const next: Record<string, unknown> = { ...p, rsiRefLevel: 47 };
        const needParams = JSON.stringify(next) !== JSON.stringify(p);
        const needMeta =
          rb.displayName !== 'RSI Bybit 15m (SMA21×47)' ||
          rb.description !== RSI_BYBIT_15M_UNIVERSE_DESCRIPTION;
        if (needParams || needMeta) {
          await prisma.strategy.update({
            where: { name: 'RSI_BYBIT_15M' },
            data: {
              params: JSON.stringify(next),
              displayName: 'RSI Bybit 15m (SMA21×47)',
              description: RSI_BYBIT_15M_UNIVERSE_DESCRIPTION,
            },
          });
        }
      }
    } catch (e) {
      console.warn('⚠️ RSI_BYBIT_15M: falha ao migrar rsiRefLevel/displayName:', e);
    }
  }

  const existingMaCross15m = await prisma.strategy.findUnique({
    where: { name: 'MA_CROSS_15M' },
    select: { id: true, params: true, description: true },
  });

  if (!existingMaCross15m) {
    await prisma.strategy.create({
      data: {
        name: 'MA_CROSS_15M',
        displayName: 'MA Cross 15m (MA30/MA200)',
        description: MA_CROSS_15M_STRATEGY_DESCRIPTION,
        isActive: false,
        params: JSON.stringify(MA_CROSS_15M_DEFAULT_PARAMS),
      },
    });
  } else {
    // Migração: confirmationPct=2 impede qualquer sinal (fisicamente impossível num único candle).
    // Corrigir automaticamente para 0 (cruzamento simples).
    try {
      const p = existingMaCross15m.params ? JSON.parse(existingMaCross15m.params) : {};
      const next: Record<string, unknown> = { ...p };
      if (Number(p.confirmationPct) >= 1) {
        next.confirmationPct = 0;
        console.log('✅ MA_CROSS_15M: confirmationPct migrado de', p.confirmationPct, '→ 0');
      }
      if (p.maType !== 'SMA' && p.maType !== 'EMA') {
        next.maType = 'EMA';
        console.log('✅ MA_CROSS_15M: maType predefinido → EMA (TradingView)');
      }
      /** Alinhar com MA12×MA30: spread + repetir + TP parcial + compressão */
      if (next.useDiffMode === undefined) next.useDiffMode = true;
      if (next.entryDiffPct == null || next.entryDiffPct === '') next.entryDiffPct = 0.9;
      if (next.exitDiffPct == null || next.exitDiffPct === '') next.exitDiffPct = 0.5;
      if (next.ma12x30RepeatWhileTrend === undefined) next.ma12x30RepeatWhileTrend = true;
      if (next.ma12x30RepeatMinSpreadDeltaPct == null || next.ma12x30RepeatMinSpreadDeltaPct === '')
        next.ma12x30RepeatMinSpreadDeltaPct = 0.06;
      if (next.ma12x30GainTpPct == null || next.ma12x30GainTpPct === '') next.ma12x30GainTpPct = 44;
      if (next.ma12x30GainTpPositionPct == null || next.ma12x30GainTpPositionPct === '')
        next.ma12x30GainTpPositionPct = 60;
      if (Number(p.stopPercent) === 8) {
        next.stopPercent = 5;
        console.log('✅ MA_CROSS_15M: stopPercent legado 8% → 5% (alinhado MA12×MA30)');
      }
      if (next.stopPercent == null || next.stopPercent === '') next.stopPercent = 5;

      const metaDesc =
        existingMaCross15m.description?.includes('Golden Cross') ||
        existingMaCross15m.description?.includes('TP1 +85%')
          ? MA_CROSS_15M_STRATEGY_DESCRIPTION
          : undefined;

      if (JSON.stringify(next) !== JSON.stringify(p) || metaDesc) {
        await prisma.strategy.update({
          where: { name: 'MA_CROSS_15M' },
          data: {
            params: JSON.stringify(next),
            ...(metaDesc ? { description: metaDesc } : {}),
          },
        });
      }
    } catch (e) {
      console.warn('⚠️ MA_CROSS_15M: falha ao migrar params (confirmationPct/maType):', e);
    }
  }

  const existingMaCross5m = await prisma.strategy.findUnique({
    where: { name: 'MA_CROSS_5M' },
    select: { id: true, params: true, displayName: true, description: true },
  });

  if (!existingMaCross5m) {
    await prisma.strategy.create({
      data: {
        name: 'MA_CROSS_5M',
        displayName: 'MA Cross 15m (MA12/MA30)',
        description: MA_CROSS_5M_DESC,
        isActive: true,
        params: JSON.stringify(MA_CROSS_5M_DEFAULT_PARAMS),
      },
    });
  } else {
    try {
      const p = existingMaCross5m.params ? JSON.parse(existingMaCross5m.params) : {};
      const next: Record<string, unknown> = { ...p };
      if (p.maType !== 'SMA' && p.maType !== 'EMA') {
        next.maType = 'EMA';
        console.log('✅ MA_CROSS_5M: maType predefinido → EMA (TradingView)');
      }
      if (p.ma200Period === 200 || p.ma200Period == null || p.ma200Period === 60 || p.ma200Period === 120) {
        next.ma200Period = 30;
      }
      if (p.ma30Period == null || p.ma30Period === 30) {
        next.ma30Period = 12;
      }
      // Nova configuração MA_CROSS_5M: gatilho por diferença MA12/MA30 + saída por compressão.
      next.stopPercent = 5;
      next.entryDiffPct = 0.9;
      next.exitDiffPct = 0.5;
      // Limpar campos legados de TP único para evitar confusão na UI/params.
      delete next.tp1Percent;
      delete next.tp1Position;
      delete next.tp2Percent;
      delete next.tp2Position;
      delete next.buyTp1Percent;
      delete next.buyTp1Position;
      delete next.buyTp2Percent;
      delete next.buyTp2Position;
      delete next.sellTp1Percent;
      delete next.sellTp1Position;
      delete next.sellTp2Percent;
      delete next.sellTp2Position;
      if (next.ma12x30RepeatWhileTrend === undefined) {
        next.ma12x30RepeatWhileTrend = true;
      }
      if (next.ma12x30GainTpPct == null || next.ma12x30GainTpPct === '') {
        next.ma12x30GainTpPct = 44;
      }
      if (next.ma12x30GainTpPositionPct == null || next.ma12x30GainTpPositionPct === '') {
        next.ma12x30GainTpPositionPct = 60;
      }
      if (
        p.ma200Period === 200 ||
        p.ma200Period == null ||
        p.ma200Period === 60 ||
        p.ma200Period === 120 ||
        p.ma30Period == null ||
        p.ma30Period === 30
      ) {
        console.log('✅ MA_CROSS_5M: parâmetros migrados para MA12/MA30');
      }
      const needParams = JSON.stringify(next) !== JSON.stringify(p);
      const needMeta =
        existingMaCross5m.displayName !== 'MA Cross 15m (MA12/MA30)' ||
        existingMaCross5m.description !== MA_CROSS_5M_DESC;
      if (needParams || needMeta) {
        await prisma.strategy.update({
          where: { name: 'MA_CROSS_5M' },
          data: {
            params: needParams ? JSON.stringify(next) : existingMaCross5m.params!,
            displayName: 'MA Cross 15m (MA12/MA30)',
            description: MA_CROSS_5M_DESC,
          },
        });
      }
    } catch (e) {
      console.warn('⚠️ MA_CROSS_5M: falha ao migrar params:', e);
    }
  }

  const relabeled = await backfillMaCross5mSignalNames(prisma);
  if (relabeled > 0) {
    console.log(
      `✅ MA_CROSS_5M: ${relabeled} sinal(is) com strategyName actualizado → "${MA_CROSS_5M_DISPLAY}"`
    );
  }

  const existingMaCross1h = await prisma.strategy.findUnique({
    where: { name: 'MA_CROSS_1H' },
    select: { id: true, params: true, displayName: true, description: true },
  });

  if (!existingMaCross1h) {
    await prisma.strategy.create({
      data: {
        name: 'MA_CROSS_1H',
        displayName: 'MA Cross 1h (MA12/MA30)',
        description:
          'MA12/MA30 em 1h: entrada por spread (>1,8%). TP parcial: 60% da posição quando o preço valoriza ≥44% vs entrada. Restante: fecho se spread <0,8%. SL 7%. Filtro SELL se |preço−MA30|/MA30>6%. Universo = scan Bybit Volume 1h >500k e MA200 (1h).',
        isActive: true,
        params: JSON.stringify(MA_CROSS_1H_DEFAULT_PARAMS),
      },
    });
  } else {
    try {
      const p = existingMaCross1h.params ? JSON.parse(existingMaCross1h.params) : {};
      const next: Record<string, unknown> = { ...p };
      if (p.maType !== 'SMA' && p.maType !== 'EMA') {
        next.maType = 'EMA';
      }
      next.useDiffMode = true;
      next.ma30Period = 12;
      next.ma200Period = 30;
      next.entryDiffPct = 1.8;
      next.exitDiffPct = 0.8;
      next.ma12x30RepeatWhileTrend = true;
      if (next.ma12x30GainTpPct == null || next.ma12x30GainTpPct === '') {
        next.ma12x30GainTpPct = 44;
      }
      if (next.ma12x30GainTpPositionPct == null || next.ma12x30GainTpPositionPct === '') {
        next.ma12x30GainTpPositionPct = 60;
      }
      next.stopPercent = 7;
      delete next.entryDiffPctBuy;
      delete next.entryDiffPctSell;
      delete next.buyStopPercent;
      delete next.sellStopPercent;
      delete next.sellTp1Percent;
      delete next.sellTp1Position;
      delete next.sellTp2Percent;
      delete next.sellTp2Position;
      next.exchange = p.exchange === 'binance' ? 'binance' : 'bybit';
      const newDesc =
        'MA12/MA30 em 1h: entrada por spread (>1,8%). TP parcial: 60% da posição quando o preço valoriza ≥44% vs entrada. Restante: fecho se spread <0,8%. SL 7%. Filtro SELL se |preço−MA30|/MA30>6%. Universo = scan Bybit Volume 1h >500k e MA200 (1h).';
      const needParams = JSON.stringify(next) !== JSON.stringify(p);
      const needMeta =
        existingMaCross1h.displayName !== 'MA Cross 1h (MA12/MA30)' || existingMaCross1h.description !== newDesc;
      if (needParams || needMeta) {
        await prisma.strategy.update({
          where: { name: 'MA_CROSS_1H' },
          data: {
            params: needParams ? JSON.stringify(next) : existingMaCross1h.params!,
            displayName: 'MA Cross 1h (MA12/MA30)',
            description: newDesc,
          },
        });
      }
    } catch (e) {
      console.warn('⚠️ MA_CROSS_1H: falha ao migrar params:', e);
    }
  }

  const existingEmaScalping = await prisma.strategy.findUnique({
    where: { name: 'EMA_SCALPING' },
    select: { id: true },
  });
  if (!existingEmaScalping) {
    await prisma.strategy.create({
      data: {
        name: 'EMA_SCALPING',
        displayName: 'EMA Ribbon Scalping (15m)',
        description: EMA_SCALPING_DESCRIPTION,
        isActive: true,
        params: JSON.stringify(EMA_SCALPING_DEFAULT_PARAMS),
      },
    });
  }

  const existingEmaScalpingSell = await prisma.strategy.findUnique({
    where: { name: 'EMA_SCALPING_SELL' },
    select: { id: true },
  });
  if (!existingEmaScalpingSell) {
    await prisma.strategy.create({
      data: {
        name: 'EMA_SCALPING_SELL',
        displayName: 'EMA Ribbon Scalping SELL (15m)',
        description: EMA_SCALPING_SELL_DESCRIPTION,
        isActive: false,
        params: JSON.stringify(EMA_SCALPING_SELL_DEFAULT_PARAMS),
      },
    });
  }
}

export async function GET(request: NextRequest) {
  try {
    // Garantir que o banco está inicializado antes de consultar
    let dbReady = false;
    try {
      dbReady = await ensureDatabase();
    } catch (initErr: any) {
      console.error('ensureDatabase threw:', initErr?.message || initErr);
      return NextResponse.json(
        {
          error: 'Banco de dados não está pronto',
          hint: 'Verifique DATABASE_URL. Tente /api/init-db ou /api/health para diagnóstico.',
          details: initErr?.message,
        },
        { status: 503 }
      );
    }
    if (!dbReady) {
      return NextResponse.json(
        {
          error: 'Banco de dados não está pronto',
          hint: 'Verifique DATABASE_URL e tente /api/init-db ou aguarde a inicialização automática',
        },
        { status: 503 }
      );
    }

    await ensureMissingStrategies();
    await syncRsiMaVolatileUniverseDescriptions(prisma);

    // Listagem pública - necessário para o dropdown de filtros no dashboard
    const strategies = await prisma.strategy.findMany({
      where: {
        // Oculta estratégia legada para não confundir com MA_CROSS_5M.
        name: { not: 'VOLUME_SPIKE_15M' },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({ strategies });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('Erro ao buscar estratégias:', error);
    return NextResponse.json(
      { error: 'Erro ao buscar estratégias', details: msg },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const body = await request.json();
    const { id, isActive, params, allowBuy, allowSell } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'ID da estratégia é obrigatório' },
        { status: 400 }
      );
    }

    const updateData: any = {};
    if (typeof isActive === 'boolean') {
      updateData.isActive = isActive;
    }

    // allowBuy / allowSell podem vir directamente no body ou dentro de params
    if (params || typeof allowBuy === 'boolean' || typeof allowSell === 'boolean') {
      // Se vierem allowBuy/allowSell directamente, mergear com params existentes
      if (typeof allowBuy === 'boolean' || typeof allowSell === 'boolean') {
        const current = await prisma.strategy.findUnique({ where: { id } });
        const currentParams = current?.params ? JSON.parse(current.params) : {};
        const merged = {
          ...currentParams,
          ...(params ?? {}),
          ...(typeof allowBuy  === 'boolean' ? { allowBuy }  : {}),
          ...(typeof allowSell === 'boolean' ? { allowSell } : {}),
        };
        updateData.params = JSON.stringify(merged);
      } else {
        updateData.params = JSON.stringify(params);
      }
    }

    const strategy = await prisma.strategy.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ strategy });
  } catch (error) {
    console.error('Erro ao atualizar estratégia:', error);
    return NextResponse.json(
      { error: 'Erro ao atualizar estratégia' },
      { status: 500 }
    );
  }
}

