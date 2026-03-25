import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ensureDatabase } from '@/lib/db-init';

/**
 * POST: Adiciona um ou mais símbolos manualmente à lista Top Voláteis.
 * Busca dados reais dos últimos 3 meses na Binance Futures e insere na BD.
 * Body: { symbols: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const dbReady = await ensureDatabase();
    if (!dbReady) {
      return NextResponse.json(
        { error: 'Banco de dados não está pronto', hint: 'Tente /api/init-db' },
        { status: 503 }
      );
    }

    const body = await request.json().catch(() => null);
    const symbolsRaw: unknown[] = Array.isArray(body?.symbols) ? body.symbols : [];

    const symbols = symbolsRaw
      .map((s) => String(s || '').trim().toUpperCase())
      .filter((s) => /^[A-Z0-9]+$/.test(s) && s.length > 0);

    if (symbols.length === 0) {
      return NextResponse.json(
        { error: 'Envie symbols como array não vazio com nomes válidos (ex: ["BTCUSDT"])' },
        { status: 400 }
      );
    }

    const threeMonthsAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const added: string[] = [];
    const skipped: { symbol: string; reason: string }[] = [];

    for (const symbol of symbols) {
      // Verificar se já existe
      const existing = await prisma.topVolatile.findFirst({ where: { symbol } });
      if (existing) {
        skipped.push({ symbol, reason: 'já existe na lista' });
        continue;
      }

      try {
        // Buscar dados históricos na Binance Futures
        const klinesRes = await fetch(
          `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=100&startTime=${threeMonthsAgo}`
        );

        if (!klinesRes.ok) {
          skipped.push({ symbol, reason: `símbolo não encontrado na Binance Futures (HTTP ${klinesRes.status})` });
          continue;
        }

        const klines = await klinesRes.json();
        if (!Array.isArray(klines) || klines.length < 3) {
          skipped.push({ symbol, reason: 'dados insuficientes (menos de 3 dias de histórico)' });
          continue;
        }

        let high3m = -Infinity;
        let low3m = Infinity;
        for (const k of klines) {
          const h = parseFloat(k[2]);
          const l = parseFloat(k[3]);
          if (h > high3m) high3m = h;
          if (l < low3m && l > 0) low3m = l;
        }

        if (low3m <= 0 || !isFinite(high3m)) {
          skipped.push({ symbol, reason: 'dados inválidos (high/low inválidos)' });
          continue;
        }

        const volatilityPercent = ((high3m - low3m) / low3m) * 100;
        const lastPrice = parseFloat(klines[klines.length - 1][4]);

        // Calcular próximo rank (adiciona no fim da lista)
        const maxRankRow = await prisma.topVolatile.findFirst({ orderBy: { rank: 'desc' } });
        const nextRank = (maxRankRow?.rank ?? 0) + 1;

        await prisma.topVolatile.create({
          data: {
            symbol,
            high3m,
            low3m,
            volatilityPercent,
            lastPrice,
            rank: nextRank,
          },
        });

        added.push(symbol);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        skipped.push({ symbol, reason: `erro ao processar: ${msg}` });
      }
    }

    const topVolatile = await prisma.topVolatile.findMany({
      orderBy: { rank: 'asc' },
    });

    return NextResponse.json({
      success: true,
      added,
      skipped,
      topVolatile,
      count: topVolatile.length,
      message: `${added.length} símbolo(s) adicionado(s)${skipped.length > 0 ? `, ${skipped.length} ignorado(s)` : ''}`,
    });
  } catch (error) {
    console.error('Erro ao adicionar símbolo Top Voláteis:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Ocorreu um erro ao adicionar símbolo',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
