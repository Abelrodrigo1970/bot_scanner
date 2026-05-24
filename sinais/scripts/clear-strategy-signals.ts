import { PrismaClient } from '@prisma/client';
import { clearStrategySignals } from '../lib/strategyMigrations';

const strategyName = process.argv[2]?.trim() || 'PIVOT_BOSS_BEAR_15M';

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
