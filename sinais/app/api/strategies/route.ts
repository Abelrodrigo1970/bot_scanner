import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ensureDatabase } from '@/lib/db-init';
import {
  backfillMaCross5mSignalNames,
  MA_CROSS_5M_DISPLAY,
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

const MA_CROSS_15M_DEFAULT_PARAMS = {
  ma30Period: 30,
  ma200Period: 200,
  maType: 'EMA' as const,
  confirmationPct: 0,
  stopPercent: 8,
  /** SELL: bloquear se |close−MA200|/MA200 (%) > este valor; 0 = sem filtro */
  sellBlockAbsCloseDistanceFromMa200Pct: 6,
  symbolLimit: 500,
  minQuoteVolume: 100000,
  allowBuy: true,
  allowSell: true,
  exchange: 'bybit',
};

const MA_CROSS_5M_DEFAULT_PARAMS = {
  ...MA_CROSS_15M_DEFAULT_PARAMS,
  ma30Period: 12,
  ma200Period: 30,
  exchange: 'binance' as const,
  stopPercent: 4,
  buyTp1Percent: 18,
  buyTp1Position: 30,
  buyTp2Percent: 40,
  buyTp2Position: 30,
  sellTp1Percent: 7,
  sellTp1Position: 30,
  sellTp2Percent: 15,
  sellTp2Position: 30,
};

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
        description:
          'RSI 15m reversal. Compra apenas quando o RSI da vela anterior está abaixo de 28 e o RSI actual fecha acima de 32. Apenas BUY, SL -3%, universo = scan MA30 -5% a -10% vs MA200 (1h).',
        isActive: true,
        params: JSON.stringify(RSI_15M_DEFAULT_PARAMS),
      },
    });
  }

  const existingMaCross15m = await prisma.strategy.findUnique({
    where: { name: 'MA_CROSS_15M' },
    select: { id: true, params: true },
  });

  if (!existingMaCross15m) {
    await prisma.strategy.create({
      data: {
        name: 'MA_CROSS_15M',
        displayName: 'MA Cross 15m (MA30/MA200)',
        description:
          'Cruzamento da MA30 com a MA200 no timeframe de 15m. Golden Cross/Death Cross 15m. BUY quando MA30 cruza MA200 para cima. SELL quando MA30 cruza MA200 para baixo. SL de 8%.',
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
      if (JSON.stringify(next) !== JSON.stringify(p)) {
        await prisma.strategy.update({
          where: { name: 'MA_CROSS_15M' },
          data: { params: JSON.stringify(next) },
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
        description:
          'Cruzamento MA12/MA30 em 15m. Universo = scan MA30>9% MA200 (1h) no menu. Agendar cron 15m. SL 4%. BUY: TP1 +18% (30%) | TP2 +40% (30%). SELL: TP1 -7% (30%) | TP2 -15% (30%). Reversão: fecha posição oposta e abre nova no sinal contrário.',
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
      // Nova configuração MA_CROSS_5M solicitada: 15m, SL 4%, TPs distintos por direção.
      next.stopPercent = 4;
      next.buyTp1Percent = 18;
      next.buyTp1Position = 30;
      next.buyTp2Percent = 40;
      next.buyTp2Position = 30;
      next.sellTp1Percent = 7;
      next.sellTp1Position = 30;
      next.sellTp2Percent = 15;
      next.sellTp2Position = 30;
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
      const newDesc =
        'Cruzamento MA12/MA30 em 15m. Universo = scan MA30>9% MA200 (1h) no menu. Agendar cron 15m. SL 4%. BUY: TP1 +18% (30%) | TP2 +40% (30%). SELL: TP1 -7% (30%) | TP2 -15% (30%). Reversão: fecha posição oposta e abre nova no sinal contrário.';
      const needParams = JSON.stringify(next) !== JSON.stringify(p);
      const needMeta =
        existingMaCross5m.displayName !== 'MA Cross 15m (MA12/MA30)' || existingMaCross5m.description !== newDesc;
      if (needParams || needMeta) {
        await prisma.strategy.update({
          where: { name: 'MA_CROSS_5M' },
          data: {
            params: needParams ? JSON.stringify(next) : existingMaCross5m.params!,
            displayName: 'MA Cross 15m (MA12/MA30)',
            description: newDesc,
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
    const strategies = await prisma.strategy.findMany({
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

