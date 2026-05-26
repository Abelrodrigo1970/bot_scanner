import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ensureDatabase } from '@/lib/db-init';
import { ensureMissingBuiltinStrategies } from '@/lib/ensureMissingBuiltinStrategies';
import {
  backfillMaCross5mSignalNames,
  MA_CROSS_5M_DESC,
  MA_CROSS_5M_DISPLAY,
  removeDeprecatedStrategies,
  syncAfastamentoMedio1hBuyThresholds,
  syncAfastamentoMedio1hScanner3Description,
  syncAfastamentoMedio30mBuyPrevMax,
  syncMacdHistogramPmoParams,
  syncMaCrossScanner1UniverseDescriptions,
  syncRsiMaVolatileUniverseDescriptions,
  syncRsiOverboughtDrop1hConfig,
} from '@/lib/strategyMigrations';

const MA_CROSS_5M_DEFAULT_PARAMS = {
  ma30Period: 12,
  ma200Period: 30,
  maType: 'EMA' as const,
  useDiffMode: true,
  confirmationPct: 0,
  entryDiffPct: 0.9,
  exitDiffPct: 0.5,
  stopPercent: 15,
  sellBlockAbsCloseDistanceFromMa200Pct: 6,
  ma80Period: 80,
  entryMaxAbsPctMa80VsMa200: 3,
  ma12x30RepeatWhileTrend: true,
  ma12x30RepeatMinSpreadDeltaPct: 0.06,
  ma12x30GainTpPct: 44,
  ma12x30GainTpPositionPct: 60,
  symbolLimit: 500,
  minQuoteVolume: 100000,
  allowBuy: true,
  allowSell: true,
  exchange: 'binance' as const,
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
  await removeDeprecatedStrategies(prisma);
  await ensureMissingBuiltinStrategies(prisma);
  await syncMacdHistogramPmoParams(prisma);
  await syncMaCrossScanner1UniverseDescriptions(prisma);
  await syncRsiOverboughtDrop1hConfig(prisma);
  await syncAfastamentoMedio1hScanner3Description(prisma);
  await syncAfastamentoMedio1hBuyThresholds(prisma);
  await syncAfastamentoMedio30mBuyPrevMax(prisma);

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
      next.stopPercent = 15;
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
      if (next.ma80Period == null) {
        next.ma80Period = 80;
      }
      if (next.entryMaxAbsPctMa80VsMa200 == null || next.entryMaxAbsPctMa80VsMa200 === '') {
        next.entryMaxAbsPctMa80VsMa200 = 3;
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

