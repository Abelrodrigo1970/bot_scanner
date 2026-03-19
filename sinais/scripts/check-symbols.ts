/**
 * Script para verificar quantos símbolos são retornados pela função fetchSymbolsWithMarketCap
 * e quais símbolos cada estratégia usa
 */

async function fetchSymbolsWithMarketCap(minMarketCap: number = 70000000): Promise<string[]> {
  try {
    // Buscar todos os símbolos USDT da Binance Futures
    const response = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
    if (!response.ok) {
      throw new Error(`Erro ao buscar símbolos: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Filtrar por quoteVolume alto (aproximação de market cap)
    // 70 milhões de market cap geralmente corresponde a ~10-50M de volume diário
    const minQuoteVolume = minMarketCap / 10; // Aproximação conservadora
    const filteredSymbols = data
      .filter((ticker: any) => {
        return ticker.symbol.endsWith('USDT') && 
               !ticker.symbol.includes('BUSD') &&
               parseFloat(ticker.quoteVolume) >= minQuoteVolume;
      })
      .map((ticker: any) => ticker.symbol);

    return filteredSymbols;
  } catch (error) {
    console.error('Erro ao buscar símbolos com market cap:', error);
    return [];
  }
}

async function main() {
  console.log('🔍 Verificando símbolos para cada estratégia...\n');

  // Lista fixa de símbolos usada por MACD_HISTOGRAM
  const fixedSymbols = [
    'LIGHTUSDT', 'FOLKSUSDT', 'BEATUSDT', 'RIVERUSDT', 'FHEUSDT',
    'BROCCOLI714USDT', 'TAKEUSDT', 'TRADOORUSDT', 'PIPPINUSDT', 'XNYUSDT',
    'TRUTHUSDT', 'RVVUSDT', 'PIEVERSEUSDT', 'JELLYJELLYUSDT', 'HUSDT',
    'PTBUSDT', 'STABLEUSDT', 'POWERUSDT', 'LUNA2USDT', 'BASUSDT',
    'MOODENGUSDT', 'CLOUSDT', '1000LUNCUSDT', 'AIOTUSDT', 'ICNTUSDT',
    'ATUSDT', 'BDXNUSDT', 'LYNUSDT', 'ZBTUSDT', 'BOBUSDT',
    'COMMONUSDT', 'ACTUSDT', 'LABUSDT', 'USTCUSDT', 'QUSDT',
    '4USDT', 'RLSUSDT', 'EVAAUSDT', 'USELESSUSDT', 'CCUSDT',
    'SQDUSDT', 'SWARMSUSDT', 'GUNUSDT', 'MYXUSDT', 'YALAUSDT',
    'ALCHUSDT', 'BUSDT', 'ARCUSDT', 'A2ZUSDT', 'BULLAUSDT',
    'UAIUSDT', 'TANSSIUSDT', 'XPINUSDT', 'CHESSUSDT', 'SKYAIUSDT',
    'MERLUSDT', 'ESPORTSUSDT', 'MONUSDT', 'SAPIENUSDT', 'B2USDT',
    'KGENUSDT', 'AVAAIUSDT', 'AINUSDT', 'APRUSDT', 'PROMPTUSDT',
    'STBLUSDT', 'FARTCOINUSDT', 'HMSTRUSDT', 'FLOWUSDT', 'ZRCUSDT',
    'COAIUSDT', 'BLUAIUSDT', 'IRYSUSDT', 'PLAYUSDT', 'AKEUSDT',
    'DAMUSDT', 'RECALLUSDT', 'ALLOUSDT', 'BRETTUSDT', 'GIGGLEUSDT',
    'JCTUSDT', 'HANAUSDT', 'DOODUSDT', 'GRIFFAINUSDT', 'ANIMEUSDT',
    'NAORISUSDT', 'AIXBTUSDT', 'ZEREBROUSDT', 'ACEUSDT', 'AVNTUSDT',
    'WIFUSDT', 'AXLUSDT', 'BLESSUSDT', 'TAUSDT', 'DOLOUSDT',
    'BRUSDT', 'BROCCOLIF3BUSDT', 'MUSDT', 'EPTUSDT', 'NILUSDT',
  ];

  console.log('═'.repeat(80));
  console.log('📊 ESTRATÉGIA: MACD_HISTOGRAM');
  console.log('─'.repeat(80));
  console.log(`   Tipo: Lista fixa de símbolos`);
  console.log(`   Total de símbolos: ${fixedSymbols.length}`);
  console.log(`   Primeiros 10: ${fixedSymbols.slice(0, 10).join(', ')}`);
  console.log(`   Últimos 10: ${fixedSymbols.slice(-10).join(', ')}\n`);

  console.log('═'.repeat(80));
  console.log('📊 ESTRATÉGIA: MA60_CROSSOVER');
  console.log('─'.repeat(80));
  console.log(`   Tipo: Símbolos com market cap > 70 milhões (baseado em volume)`);
  console.log(`   Buscando símbolos...\n`);

  const highMarketCapSymbols = await fetchSymbolsWithMarketCap(70000000);

  if (highMarketCapSymbols.length > 0) {
    console.log(`   ✅ Total de símbolos encontrados: ${highMarketCapSymbols.length}`);
    console.log(`   Primeiros 20: ${highMarketCapSymbols.slice(0, 20).join(', ')}`);
    if (highMarketCapSymbols.length > 20) {
      console.log(`   ... e mais ${highMarketCapSymbols.length - 20} símbolos`);
    }
  } else {
    console.log(`   ⚠️  Nenhum símbolo encontrado!`);
    console.log(`   Isso pode significar que a API da Binance não retornou dados ou o filtro está muito restritivo.`);
  }

  console.log('\n═'.repeat(80));
  console.log('📝 RESUMO');
  console.log('─'.repeat(80));
  console.log(`   MACD_HISTOGRAM: ${fixedSymbols.length} símbolos (lista fixa)`);
  console.log(`   MA60_CROSSOVER: ${highMarketCapSymbols.length} símbolos (market cap > 70M)`);
  console.log('═'.repeat(80));
}

main().catch(console.error);
