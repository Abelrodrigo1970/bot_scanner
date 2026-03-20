import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { getTradingEnabled, setTradingEnabled } from '@/lib/settings';

export const dynamic = 'force-dynamic';

/**
 * GET: Retorna se os trades na Binance estão ativados.
 */
export async function GET() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }
    const enabled = await getTradingEnabled();
    return NextResponse.json({ enabled });
  } catch (error) {
    console.error('Erro ao obter setting trading:', error);
    return NextResponse.json(
      { error: 'Erro ao obter configuração' },
      { status: 500 }
    );
  }
}

/**
 * PATCH: Ativa ou desativa trades na Binance.
 * Body: { enabled: boolean }
 * Os sinais continuam a ser gerados.
 */
export async function PATCH(request: NextRequest) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }
    const body = await request.json();
    const enabled = body?.enabled;
    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled deve ser true ou false' },
        { status: 400 }
      );
    }
    await setTradingEnabled(enabled);
    return NextResponse.json({
      success: true,
      enabled,
      message: enabled
        ? 'Trades na Binance ativados. Os sinais continuam a ser gerados.'
        : 'Trades na Binance desativados. Os sinais continuam a ser gerados.',
    });
  } catch (error) {
    console.error('Erro ao atualizar setting trading:', error);
    return NextResponse.json(
      { error: 'Erro ao atualizar configuração' },
      { status: 500 }
    );
  }
}
