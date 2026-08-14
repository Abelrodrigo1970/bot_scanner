import { NextRequest, NextResponse } from 'next/server';
import { runScanner3Rsi1hPipeline } from '@/lib/scanner3Rsi1hPipeline';

/**
 * Scanner 3 RSI 1h — actualiza universo RSI>75 (1h).
 * Flip descontinuado (Ago 2026); pipeline ainda corre mas salta se inactivo.
 * Agendar: opcional / obsoleto.
 */
let jobPromise: Promise<void> | null = null;

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    if (jobPromise) {
      return NextResponse.json(
        {
          accepted: false,
          busy: true,
          message: 'Scanner 3 RSI 1h já em execução.',
        },
        { status: 202 }
      );
    }

    const startedAt = new Date().toISOString();
    jobPromise = (async () => {
      try {
        const result = await runScanner3Rsi1hPipeline();
        console.log('[Scanner3 RSI 1h cron] concluído', { startedAt, result });
      } catch (err) {
        console.error('[Scanner3 RSI 1h cron] erro:', err);
      } finally {
        jobPromise = null;
      }
    })();

    return NextResponse.json(
      {
        accepted: true,
        background: true,
        message: 'Scanner 3 RSI 1h iniciado (scan + Flip).',
        startedAt,
      },
      { status: 202 }
    );
  } catch (error) {
    console.error('[Scanner3 RSI 1h cron] Erro ao iniciar:', error);
    return NextResponse.json(
      {
        error: 'Erro ao iniciar Scanner 3 RSI 1h',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
