/**
 * Função para atualizar resultados após 24 horas dos sinais
 */

import { prisma } from './db';
import { fetchCandlesSafe, fetchFallbackPrice } from './marketData';
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
        const price24h =
          signal.price24h ??
          (await fetchFallbackPrice(signal.symbol, signal.entryPrice)).price;

        // Calcular preço máximo e mínimo durante as 24 horas
        let high24h: number | null = null;
        let low24h: number | null = null;

        const allCandles = await fetchCandlesSafe(signal.symbol, '1h', 48);
        if (allCandles && allCandles.length > 0) {
          const signalTimestamp = signal.generatedAt.getTime();
          const endTimestamp = signalTimestamp + 24 * 60 * 60 * 1000;

          const relevantCandles = allCandles.filter((candle) => {
            const candleStart = candle.timestamp;
            const candleEnd = candleStart + 60 * 60 * 1000;

            return (
              (candleStart >= signalTimestamp && candleStart <= endTimestamp) ||
              (candleStart < signalTimestamp && candleEnd > signalTimestamp) ||
              (candleStart < endTimestamp && candleEnd > endTimestamp)
            );
          });

          if (relevantCandles.length > 0) {
            high24h = Math.max(...relevantCandles.map((c) => c.high));
            low24h = Math.min(...relevantCandles.map((c) => c.low));
            high24h = Math.max(high24h, signal.entryPrice, price24h);
            low24h = Math.min(low24h, signal.entryPrice, price24h);
          } else {
            high24h = Math.max(price24h, signal.entryPrice);
            low24h = Math.min(price24h, signal.entryPrice);
          }
        } else {
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
        console.warn(`⚠️ Erro ao actualizar high/low sinal ${signal.id} (${signal.symbol}):`, error);
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
      include: {
        strategy: true,
      },
    });

    console.log(`📊 Encontrados ${signalsToUpdate.length} sinais para atualizar (24h)`);

    for (const signal of signalsToUpdate) {
      try {
        const { price: currentPrice, source: priceSource } = await fetchFallbackPrice(
          signal.symbol,
          signal.entryPrice
        );
        if (priceSource === 'entry') {
          console.warn(`⚠️ 24h ${signal.symbol}: preço de entrada (API indisponível nesta ronda)`);
        }

        // Calcular preço máximo e mínimo durante as 24 horas
        let high24h: number | null = null;
        let low24h: number | null = null;

        const allCandles = await fetchCandlesSafe(signal.symbol, '1h', 48);
        if (allCandles && allCandles.length > 0) {
          const signalTimestamp = signal.generatedAt.getTime();
          const endTimestamp = signalTimestamp + 24 * 60 * 60 * 1000;

          const relevantCandles = allCandles.filter((candle) => {
            const candleStart = candle.timestamp;
            const candleEnd = candleStart + 60 * 60 * 1000;

            return (
              (candleStart >= signalTimestamp && candleStart <= endTimestamp) ||
              (candleStart < signalTimestamp && candleEnd > signalTimestamp) ||
              (candleStart < endTimestamp && candleEnd > endTimestamp)
            );
          });

          if (relevantCandles.length > 0) {
            high24h = Math.max(...relevantCandles.map((c) => c.high));
            low24h = Math.min(...relevantCandles.map((c) => c.low));
            high24h = Math.max(high24h, signal.entryPrice, currentPrice);
            low24h = Math.min(low24h, signal.entryPrice, currentPrice);
          } else {
            high24h = Math.max(currentPrice, signal.entryPrice);
            low24h = Math.min(currentPrice, signal.entryPrice);
          }
        } else {
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

        // IN_PROGRESS mantém-se aberto — saída só por SL/TP na exchange.
        if (signal.status === 'IN_PROGRESS') {
          console.log(`⏭️  24h: ${signal.symbol} — posição mantida (saída só por SL/TP)`);
        }

        const shouldExpire = false;
        await prisma.signal.update({
          where: { id: signal.id },
          data: {
            price24h: currentPrice,
            result24h,
            status24h: 'CLOSED',
            high24h,
            low24h,
            ...(shouldExpire ? { status: 'EXPIRED' } : {}),
          },
        });

        updated++;
        const closedTag =
          signal.status === 'IN_PROGRESS' ? ' [posição mantida]' : '';
        console.log(
          `✅ Sinal ${signal.symbol} ${signal.direction} atualizado: Entrada ${signal.entryPrice.toFixed(4)}, 24h ${currentPrice.toFixed(4)}, High ${high24h?.toFixed(4) || 'N/A'}, Low ${low24h?.toFixed(4) || 'N/A'}, Resultado ${result24h >= 0 ? '+' : ''}${result24h.toFixed(4)}${closedTag}`
        );

        // Pequeno delay para não sobrecarregar API
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        errors++;
        console.warn(`⚠️ Erro ao actualizar sinal 24h ${signal.id} (${signal.symbol}):`, error);
      }
    }

    return { updated, errors };
  } catch (error) {
    console.error('Erro ao atualizar resultados 24h:', error);
    throw error;
  }
}

