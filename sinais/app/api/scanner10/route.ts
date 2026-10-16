import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  runScanner10RallyIgnition,
  SCANNER_10_CACHE_KEY,
  type Scanner10Result,
} from '@/lib/scanner10RallyIgnition';

export const runtime = 'nodejs';
export const maxDuration = 300;

const activeJob = { promise: null as Promise<Scanner10Result> | null };

async function readCache(): Promise<Scanner10Result | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: SCANNER_10_CACHE_KEY } });
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as Scanner10Result;
  } catch {
    return null;
  }
}

async function writeCache(result: Scanner10Result): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: SCANNER_10_CACHE_KEY },
    create: { key: SCANNER_10_CACHE_KEY, value: JSON.stringify(result) },
    update: { value: JSON.stringify(result) },
  });
}

async function runAndCache(source: string): Promise<Scanner10Result> {
  const result = await runScanner10RallyIgnition({ source });
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
    console.error('[scanner10 GET]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * POST: inicia scan em background (202) ou espera se ?wait=1.
 * 1D de todos os perps + 4H só nos pré-filtrados (~1–3 min).
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
          message: 'Scan Scanner 10 já em execução. Aguarde e recarregue.',
        },
        { status: 202 }
      );
    }

    const job = runAndCache('ui/scanner10').finally(() => {
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
        message: 'Scanner 10 (caça-rali) iniciado em background. Recarregue em 1–3 minutos.',
      },
      { status: 202 }
    );
  } catch (err) {
    activeJob.promise = null;
    const message = err instanceof Error ? err.message : String(err);
    console.error('[scanner10 POST]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
