import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  runScanner8BybitStocks,
  SCANNER_8_CACHE_KEY,
  type Scanner8Result,
} from '@/lib/scanner8BybitStocks';

export const runtime = 'nodejs';
export const maxDuration = 300;

const activeJob = { promise: null as Promise<Scanner8Result> | null };

async function readCache(): Promise<Scanner8Result | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: SCANNER_8_CACHE_KEY } });
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as Scanner8Result;
  } catch {
    return null;
  }
}

async function writeCache(result: Scanner8Result): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: SCANNER_8_CACHE_KEY },
    create: { key: SCANNER_8_CACHE_KEY, value: JSON.stringify(result) },
    update: { value: JSON.stringify(result) },
  });
}

async function runAndCache(source: string): Promise<Scanner8Result> {
  const result = await runScanner8BybitStocks({ source });
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
    console.error('[scanner8 GET]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * POST: inicia scan Bybit stocks em background (202) ou espera se ?wait=1.
 * Demora ~1–3 min para ~190 símbolos.
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
          message: 'Scan Scanner 8 já em execução. Aguarde e recarregue.',
        },
        { status: 202 }
      );
    }

    const job = runAndCache('ui/scanner8').finally(() => {
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
        message:
          'Scanner 8 (Bybit stocks) iniciado em background. Recarregue em 2–3 minutos.',
      },
      { status: 202 }
    );
  } catch (err) {
    activeJob.promise = null;
    const message = err instanceof Error ? err.message : String(err);
    console.error('[scanner8 POST]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
