import { NextRequest, NextResponse } from 'next/server';
import {
  BUILTIN_UNIVERSE_SCAN_LATERAL_12H,
  UNIVERSE_CODE_LATERAL_VOLATILE,
} from '@/lib/symbolUniverseDefaults';
import { scanSymbolUniverse } from '@/lib/universeScanner';
import { persistUniverseScan } from '@/lib/universeScanPersistence';

/**
 * Screener lateral EMA21/70 (4h) — só às 00:00 e 12:00 (Europe/Lisbon).
 * Agendar no Railway: a cada hora (ou 0 0,12 * * *) → este endpoint ignora fora dessas horas.
 */
let jobPromise: Promise<void> | null = null;

function lisbonHourNow(d = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const hour = parts.find((p) => p.type === 'hour')?.value;
  return Number(hour);
}

function isLateralCronWindow(d = new Date()): boolean {
  const h = lisbonHourNow(d);
  return h === 0 || h === 12;
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const force = request.nextUrl.searchParams.get('force') === '1';
    const hourLisbon = lisbonHourNow();

    if (!force && !isLateralCronWindow()) {
      return NextResponse.json({
        accepted: false,
        skipped: true,
        reason: 'Fora da janela 00h/12h Lisboa',
        hourLisbon,
        hint: 'Usa ?force=1 para forçar (ou Actualizar scan na UI).',
      });
    }

    if (jobPromise) {
      return NextResponse.json(
        {
          accepted: false,
          busy: true,
          message: 'Lateral EMA21/70 já em execução.',
          hourLisbon,
        },
        { status: 202 }
      );
    }

    const startedAt = new Date().toISOString();
    const def = BUILTIN_UNIVERSE_SCAN_LATERAL_12H[UNIVERSE_CODE_LATERAL_VOLATILE];
    if (!def) {
      return NextResponse.json({ error: 'Definição lateral em falta' }, { status: 500 });
    }

    jobPromise = (async () => {
      try {
        console.log(`[Lateral-12h] A executar ${UNIVERSE_CODE_LATERAL_VOLATILE} (Lisboa ${hourLisbon}h)…`);
        const rows = await scanSymbolUniverse(def);
        const persist = await persistUniverseScan({
          universeCode: UNIVERSE_CODE_LATERAL_VOLATILE,
          source: 'cron/run-lateral-volatile',
          rows,
        });
        console.log('[Lateral-12h] concluído', {
          startedAt,
          rowCount: rows.length,
          persist,
        });
      } catch (err) {
        console.error('[Lateral-12h] erro:', err);
      } finally {
        jobPromise = null;
      }
    })();

    return NextResponse.json(
      {
        accepted: true,
        background: true,
        message: 'Screener lateral EMA21/70 iniciado (00h/12h Lisboa).',
        startedAt,
        hourLisbon,
        forced: force,
      },
      { status: 202 }
    );
  } catch (error) {
    console.error('[Lateral-12h] Erro ao iniciar:', error);
    return NextResponse.json(
      {
        error: 'Erro ao iniciar screener lateral',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
