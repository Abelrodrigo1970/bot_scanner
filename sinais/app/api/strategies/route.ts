import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ensureDatabase } from '@/lib/db-init';
import {
  ensureMissingBuiltinStrategies,
} from '@/lib/ensureMissingBuiltinStrategies';
import {
  ACTIVE_SCANNER_STRATEGY_NAMES,
  sortActiveStrategies,
} from '@/lib/strategyCatalog';
import {
  backfillMaCross5mSignalNames,
  MA_CROSS_5M_DESC,
  MA_CROSS_5M_DISPLAY,
  removeDeprecatedStrategies,
  syncAfastamentoMedio30mBuyPrevMax,
  syncEmaRibbonScalpingBuy15m,
  syncMaCrossScanner1UniverseDescriptions,
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
  entryMaxAbsPctMa80VsMa200: 0,
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

async function ensureMissingStrategies() {
  await removeDeprecatedStrategies(prisma);
  await ensureMissingBuiltinStrategies(prisma);
  await syncMaCrossScanner1UniverseDescriptions(prisma);
  await syncRsiOverboughtDrop1hConfig(prisma);
  await syncAfastamentoMedio30mBuyPrevMax(prisma);
  await syncEmaRibbonScalpingBuy15m(prisma);

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
      // Desactivar filtro MA80 vs MA200 — era demasiado restritivo (bloqueava tendências legítimas do Scanner 1)
      if (next.entryMaxAbsPctMa80VsMa200 == null || next.entryMaxAbsPctMa80VsMa200 === '' || Number(next.entryMaxAbsPctMa80VsMa200) > 0) {
        next.entryMaxAbsPctMa80VsMa200 = 0;
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

    // Listagem pública - necessário para o dropdown de filtros no dashboard
    const strategies = sortActiveStrategies(
      await prisma.strategy.findMany({
        where: {
          name: { in: [...ACTIVE_SCANNER_STRATEGY_NAMES] },
        },
      })
    );

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

