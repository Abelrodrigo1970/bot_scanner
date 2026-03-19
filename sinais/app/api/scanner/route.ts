import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { runScanner, type ScannerConfig } from '@/lib/scanner';

/**
 * Endpoint para executar o scanner de trades A+
 * GET: Retorna os alertas do scanner
 * POST: Executa o scanner com configurações customizadas
 */
export async function GET(request: NextRequest) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const config: ScannerConfig = {
      topSymbolsLimit: parseInt(searchParams.get('topSymbolsLimit') || '50'),
      minQuoteVolume: parseFloat(searchParams.get('minQuoteVolume') || '0'),
      minATRPercent: parseFloat(searchParams.get('minATRPercent') || '0.3'),
      maxATRPercent: parseFloat(searchParams.get('maxATRPercent') || '2.5'),
      minScore: parseInt(searchParams.get('minScore') || '7'),
      topResultsLimit: parseInt(searchParams.get('topResultsLimit') || '3'),
      enableBreakoutRetest: searchParams.get('enableBreakoutRetest') === 'true',
      breakoutLookback: parseInt(searchParams.get('breakoutLookback') || '48'),
      cooldownMinutes: parseInt(searchParams.get('cooldownMinutes') || '60'),
    };

    const result = await runScanner(config);

    return NextResponse.json({
      success: true,
      entries: result.entries,
      preSetups: result.preSetups,
      count: {
        entries: result.entries.length,
        preSetups: result.preSetups.length,
      },
      scannedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Erro ao executar scanner:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao executar scanner',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const body = await request.json();
    const config: ScannerConfig = {
      topSymbolsLimit: body.topSymbolsLimit || 50,
      minQuoteVolume: body.minQuoteVolume || 0,
      minATRPercent: body.minATRPercent || 0.3,
      maxATRPercent: body.maxATRPercent || 2.5,
      minScore: body.minScore || 7,
      topResultsLimit: body.topResultsLimit || 3,
      enableBreakoutRetest: body.enableBreakoutRetest || false,
      breakoutLookback: body.breakoutLookback || 48,
      cooldownMinutes: body.cooldownMinutes || 60,
    };

    const result = await runScanner(config);

    return NextResponse.json({
      success: true,
      entries: result.entries,
      preSetups: result.preSetups,
      count: {
        entries: result.entries.length,
        preSetups: result.preSetups.length,
      },
      scannedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Erro ao executar scanner:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao executar scanner',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

