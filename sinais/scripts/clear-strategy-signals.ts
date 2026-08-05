import { PrismaClient } from '@prisma/client';
import { clearStrategySignals } from '../lib/strategyMigrations';

const strategyName = process.argv[2]?.trim() || 'PIVOT_BOSS_BEAR_15M';

/** Keys de “último run processado” a limpar para a estratégia recomeçar do zero. */
const LAST_RUN_KEYS: Record<string, string[]> = {
  SCANNER3_RSI_FLIP_1H: ['SCANNER3_RSI_FLIP_1H_LAST_RUN_ID'],
};

async function main() {
  const prisma = new PrismaClient();
  try {
    const before = await prisma.signal.count({
      where: { strategy: { name: strategyName } },
    });
    console.log(`Estratégia: ${strategyName} — sinais antes: ${before}`);

    const result = await clearStrategySignals(prisma, strategyName);
    console.log(
      `Apagados: ${result.deleted} sinal(is) (${result.displayName ?? strategyName})`
    );

    const keys = LAST_RUN_KEYS[strategyName] ?? [];
    if (keys.length) {
      const cleared = await prisma.appSetting.deleteMany({
        where: { key: { in: keys } },
      });
      console.log(`Reset last-run settings: ${cleared.count} (${keys.join(', ')})`);
    }

    const after = await prisma.signal.count({
      where: { strategy: { name: strategyName } },
    });
    console.log(`Sinais restantes: ${after}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
