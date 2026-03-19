/**
 * Função para atualizar resultados após 24 horas dos sinais
 */

import { prisma } from './db';
import { fetchCurrentPrice, fetchCandles } from './marketData';

/**
 * Atualiza sinais já fechados que não têm high24h e low24h
 */
export async function updateMissingHighLow24h(): Promise<{
  updated: number;
  errors: number;
}> {
  let updated = 0;
  let errors = 0;

  try {
    // Buscar sinais fechados que não têm high24h ou low24h
    const signalsToUpdate = await prisma.signal.findMany({
      where: {
        status24h: 'CLOSED',
        OR: [
          { high24h: null },
          { low24h: null },
        ],
      },
      take: 500, // Aumentado para 500 por vez
      orderBy: { generatedAt: 'desc' }, // Processar os mais recentes primeiro
    });

    console.log(`📊 Encontrados ${signalsToUpdate.length} sinais fechados sem high24h/low24h para atualizar`);

    for (const signal of signalsToUpdate) {
      try {
        // Se já tem price24h, usar ele, senão buscar preço atual
        const price24h = signal.price24h || await fetchCurrentPrice(signal.symbol);

        // Calcular preço máximo e mínimo durante as 24 horas
        let high24h: number | null = null;
        let low24h: number | null = null;
        
        try {
          // Encontrar o timestamp do sinal e 24 horas depois
          const signalTimestamp = signal.generatedAt.getTime();
          const endTimestamp = signalTimestamp + (24 * 60 * 60 * 1000); // 24 horas depois
          
          // Buscar candles recentes (últimas 48 horas para garantir cobertura)
          const allCandles = await fetchCandles(signal.symbol, '1h', 48);
          
          // Filtrar candles que estão dentro do período de 24h após o sinal
          const relevantCandles = allCandles.filter((candle) => {
            const candleStart = candle.timestamp;
            const candleEnd = candleStart + (60 * 60 * 1000); // 1 hora depois
            
            return (candleStart >= signalTimestamp && candleStart <= endTimestamp) ||
                   (candleStart < signalTimestamp && candleEnd > signalTimestamp) ||
                   (candleStart < endTimestamp && candleEnd > endTimestamp);
          });
          
          if (relevantCandles.length > 0) {
            // Calcular high e low dos candles relevantes
            high24h = Math.max(...relevantCandles.map((c) => c.high));
            low24h = Math.min(...relevantCandles.map((c) => c.low));
            
            // Garantir que incluímos o preço de entrada e o preço 24h
            high24h = Math.max(high24h, signal.entryPrice, price24h);
            low24h = Math.min(low24h, signal.entryPrice, price24h);
          } else {
            // Se não houver candles relevantes, usar o preço 24h e o preço de entrada como fallback
            high24h = Math.max(price24h, signal.entryPrice);
            low24h = Math.min(price24h, signal.entryPrice);
          }
        } catch (error) {
          // Se houver erro ao buscar candles, usar o preço 24h e o preço de entrada
          console.warn(`⚠️  Erro ao buscar candles históricos para ${signal.symbol}, usando fallback:`, error);
          high24h = Math.max(price24h, signal.entryPrice);
          low24h = Math.min(price24h, signal.entryPrice);
        }

        // Atualizar sinal
        await prisma.signal.update({
          where: { id: signal.id },
          data: {
            high24h,
            low24h,
          },
        });

        updated++;
        console.log(
          `✅ Sinal ${signal.symbol} atualizado: High ${high24h?.toFixed(4) || 'N/A'}, Low ${low24h?.toFixed(4) || 'N/A'}`
        );

        // Pequeno delay para não sobrecarregar API
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        errors++;
        console.error(`❌ Erro ao atualizar sinal ${signal.id}:`, error);
      }
    }

    return { updated, errors };
  } catch (error) {
    console.error('Erro ao atualizar high24h/low24h:', error);
    throw error;
  }
}

/**
 * Atualiza sinais que já passaram 24 horas com o preço atual e resultado
 */
export async function update24hResults(): Promise<{
  updated: number;
  errors: number;
}> {
  let updated = 0;
  let errors = 0;

  try {
    // Buscar sinais que já passaram 24 horas mas ainda não foram fechados
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const signalsToUpdate = await prisma.signal.findMany({
      where: {
        generatedAt: {
          lte: twentyFourHoursAgo,
        },
        status24h: null, // Apenas os que ainda não foram processados
      },
    });

    console.log(`📊 Encontrados ${signalsToUpdate.length} sinais para atualizar (24h)`);

    for (const signal of signalsToUpdate) {
      try {
        // Buscar preço atual
        const currentPrice = await fetchCurrentPrice(signal.symbol);

        // Calcular preço máximo e mínimo durante as 24 horas
        let high24h: number | null = null;
        let low24h: number | null = null;
        
        try {
          // Encontrar o timestamp do sinal e 24 horas depois
          const signalTimestamp = signal.generatedAt.getTime();
          const endTimestamp = signalTimestamp + (24 * 60 * 60 * 1000); // 24 horas depois
          
          // Buscar candles recentes (últimas 48 horas para garantir cobertura)
          // A API da Binance retorna os candles mais recentes, então vamos buscar e filtrar
          const allCandles = await fetchCandles(signal.symbol, '1h', 48);
          
          // Filtrar candles que estão dentro do período de 24h após o sinal
          // Cada candle representa 1 hora, então o timestamp do candle é o início da hora
          const relevantCandles = allCandles.filter((candle) => {
            // O timestamp do candle é o início da hora, então incluímos se:
            // - O início do candle está dentro do período OU
            // - O candle cobre o período (início antes do fim do período e fim depois do início)
            const candleStart = candle.timestamp;
            const candleEnd = candleStart + (60 * 60 * 1000); // 1 hora depois
            
            return (candleStart >= signalTimestamp && candleStart <= endTimestamp) ||
                   (candleStart < signalTimestamp && candleEnd > signalTimestamp) ||
                   (candleStart < endTimestamp && candleEnd > endTimestamp);
          });
          
          if (relevantCandles.length > 0) {
            // Calcular high e low dos candles relevantes
            high24h = Math.max(...relevantCandles.map((c) => c.high));
            low24h = Math.min(...relevantCandles.map((c) => c.low));
            
            // Garantir que incluímos o preço de entrada e o preço atual
            high24h = Math.max(high24h, signal.entryPrice, currentPrice);
            low24h = Math.min(low24h, signal.entryPrice, currentPrice);
          } else {
            // Se não houver candles relevantes, usar o preço atual e o preço de entrada como fallback
            high24h = Math.max(currentPrice, signal.entryPrice);
            low24h = Math.min(currentPrice, signal.entryPrice);
          }
        } catch (error) {
          // Se houver erro ao buscar candles, usar o preço atual e o preço de entrada
          console.warn(`⚠️  Erro ao buscar candles históricos para ${signal.symbol}, usando fallback:`, error);
          high24h = Math.max(currentPrice, signal.entryPrice);
          low24h = Math.min(currentPrice, signal.entryPrice);
        }

        // Calcular resultado (diferença de preço)
        let result24h: number;
        if (signal.direction === 'BUY') {
          // Para compra: lucro se preço subiu
          result24h = currentPrice - signal.entryPrice;
        } else {
          // Para venda: lucro se preço desceu
          result24h = signal.entryPrice - currentPrice;
        }

        // Atualizar sinal
        await prisma.signal.update({
          where: { id: signal.id },
          data: {
            price24h: currentPrice,
            result24h,
            status24h: 'CLOSED',
            high24h,
            low24h,
          },
        });

        updated++;
        console.log(
          `✅ Sinal ${signal.symbol} ${signal.direction} atualizado: Entrada ${signal.entryPrice.toFixed(4)}, 24h ${currentPrice.toFixed(4)}, High ${high24h?.toFixed(4) || 'N/A'}, Low ${low24h?.toFixed(4) || 'N/A'}, Resultado ${result24h >= 0 ? '+' : ''}${result24h.toFixed(4)}`
        );

        // Pequeno delay para não sobrecarregar API
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        errors++;
        console.error(`❌ Erro ao atualizar sinal ${signal.id}:`, error);
      }
    }

    return { updated, errors };
  } catch (error) {
    console.error('Erro ao atualizar resultados 24h:', error);
    throw error;
  }
}

