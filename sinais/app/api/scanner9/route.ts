import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  runScanner9Range6m,
  SCANNER_9_CACHE_KEY,
  type Scanner9Result,
} from '@/lib/scanner9Range6m';

export const runtime = 'nodejs';
export const maxDuration = 300;

const activeJob = { promise: null as Promise<Scanner9Result> | null };

async function readCache(): Promise<Scanner9Result | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: SCANNER_9_CACHE_KEY } });
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as Scanner9Result;
  } catch {
    return null;
  }
}

async function writeCache(result: Scanner9Result): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: SCANNER_9_CACHE_KEY },
    create: { key: SCANNER_9_CACHE_KEY, value: JSON.stringify(result) },
    update: { value: JSON.stringify(result) },
  });
}

async function runAndCache(source: string): Promise<Scanner9Result> {
  const result = await runScanner9Range6m({ source });
  await writeCache(result);
  return result;
}

/** GET: último scan em cache (rápido). */
export async function GET() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const cached = await readCache();
    return NextResponse.json({
      success: true,
      cached: Boolean(cached),
      busy: Boolean(activeJob.promise),
      ...(cached ?? { scannedAt: null, source: null, count: 0, items: [] }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[scanner9 GET]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * POST: inicia scan em background (202) ou espera se ?wait=1.
 * Demora ~1–3 min (velas 1D de todos os perps USDT com turnover ≥ mínimo).
 */
export async function POST(request: NextRequest) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const wait = request.nextUrl.searchParams.get('wait') === '1';

    if (activeJob.promise) {
      if (wait) {
        const result = await activeJob.promise;
        return NextResponse.json({ success: true, ...result });
      }
      return NextResponse.json(
        {
          success: true,
          busy: true,
          message: 'Scan Scanner 9 já em execução. Aguarde e recarregue.',
        },
        { status: 202 }
      );
    }

    const job = runAndCache('ui/scanner9').finally(() => {
      if (activeJob.promise === job) activeJob.promise = null;
    });
    activeJob.promise = job;

    if (wait) {
      const result = await job;
      return NextResponse.json({ success: true, ...result });
    }

    return NextResponse.json(
      {
        success: true,
        background: true,
        message: 'Scanner 9 (amplitude 6 meses) iniciado em background. Recarregue em 1–3 minutos.',
      },
      { status: 202 }
    );
  } catch (err) {
    activeJob.promise = null;
    const message = err instanceof Error ? err.message : String(err);
    console.error('[scanner9 POST]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
