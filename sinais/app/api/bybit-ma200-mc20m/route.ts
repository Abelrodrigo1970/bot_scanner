import { NextResponse } from 'next/server';

/** Scanner Bybit removido do bot_scanner. */
export async function GET() {
  return NextResponse.json(
    {
      success: false,
      removed: true,
      message: 'Scanner Bybit Vol1h/MA200 removido. Use /scanners/1 (Scanner 1).',
    },
    { status: 410 }
  );
}

export async function POST() {
  return GET();
}
