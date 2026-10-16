import { writeFileSync } from 'fs';
import path from 'path';
import { runScanner10RallyIgnition } from '../lib/scanner10RallyIgnition';

const out = path.join(__dirname, 'out-scanner10-rally.json');

async function main() {
  const result = await runScanner10RallyIgnition({ source: 'cli/run-scanner10' });
  writeFileSync(out, JSON.stringify(result, null, 2));

  console.log(
    JSON.stringify(
      {
        scannedAt: result.scannedAt,
        btcDayPct: result.btcDayPct,
        btcOk: result.btcOk,
        candidates: result.candidates,
        prefiltered: result.prefiltered,
        count: result.count,
        top: result.items.slice(0, 15).map((r) => ({
          rank: r.rank,
          symbol: r.symbol,
          score: r.score,
          stage: r.stage,
          days: r.daysFromLow,
          pctFromLow: r.pctFromLow,
          h4Rsi: r.h4Rsi,
          d1Rsi: r.d1Rsi,
          volX: r.d1VolX,
          green: r.d1Green,
          kind: r.kind,
        })),
      },
      null,
      2
    )
  );
  console.log('wrote', out);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
