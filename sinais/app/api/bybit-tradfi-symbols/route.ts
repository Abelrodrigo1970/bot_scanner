import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { hasBybitCredentials } from '@/lib/bybitConfig';
import { fetchBybitAccountInstrumentsInfoAllPages } from '@/lib/bybitFuturesClient';
import {
  type BybitTradfiSymbolEntry,
  fetchBybitInstrumentsInfoAllPages,
  parseBybitTradfiSymbolUniverse,
} from '@/lib/marketData';

export const runtime = 'nodejs';

/**
 * Lista TradFi (linear stock + spot xstocks) via API pública, e opcionalmente
 * a lista permitida para a conta via `/v5/account/instruments-info` se
 * BYBIT_API_KEY / BYBIT_API_SECRET estiverem definidos no servidor.
 */
export async function GET() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const [linearList, spotList] = await Promise.all([
      fetchBybitInstrumentsInfoAllPages('linear'),
      fetchBybitInstrumentsInfoAllPages('spot'),
    ]);

    const { linearStocks, spotXstocks } = parseBybitTradfiSymbolUniverse(linearList, spotList);
    const symbols = [...linearStocks, ...spotXstocks].map((e) => e.symbol).sort();

    let fromBybitAccount: {
      meta: {
        linearInstrumentsFetched: number;
        spotInstrumentsFetched: number;
        linearStocksCount: number;
        spotXstocksCount: number;
        combinedSymbolCount: number;
      };
      linearStocks: BybitTradfiSymbolEntry[];
      spotXstocks: BybitTradfiSymbolEntry[];
      symbols: string[];
    } | null = null;
    let fromBybitAccountError: string | null = null;

    if (hasBybitCredentials()) {
      try {
        const [accLinear, accSpot] = await Promise.all([
          fetchBybitAccountInstrumentsInfoAllPages('linear'),
          fetchBybitAccountInstrumentsInfoAllPages('spot'),
        ]);
        const accParsed = parseBybitTradfiSymbolUniverse(accLinear, accSpot);
        const accSymbols = [...accParsed.linearStocks, ...accParsed.spotXstocks].map((e) => e.symbol).sort();
        fromBybitAccount = {
          meta: {
            linearInstrumentsFetched: accLinear.length,
            spotInstrumentsFetched: accSpot.length,
            linearStocksCount: accParsed.linearStocks.length,
            spotXstocksCount: accParsed.spotXstocks.length,
            combinedSymbolCount: accSymbols.length,
          },
          linearStocks: accParsed.linearStocks,
          spotXstocks: accParsed.spotXstocks,
          symbols: accSymbols,
        };
      } catch (e) {
        fromBybitAccountError = e instanceof Error ? e.message : String(e);
        console.warn('[bybit-tradfi-symbols] conta Bybit:', fromBybitAccountError);
      }
    }

    return NextResponse.json({
      success: true,
      fetchedAt: new Date().toISOString(),
      bybitCredentialsConfigured: hasBybitCredentials(),
      meta: {
        linearInstrumentsFetched: linearList.length,
        spotInstrumentsFetched: spotList.length,
        linearStocksCount: linearStocks.length,
        spotXstocksCount: spotXstocks.length,
        combinedSymbolCount: symbols.length,
      },
      linearStocks,
      spotXstocks,
      symbols,
      fromBybitAccount,
      fromBybitAccountError,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[bybit-tradfi-symbols]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
