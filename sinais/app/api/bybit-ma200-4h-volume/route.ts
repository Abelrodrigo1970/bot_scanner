import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    { success: false, removed: true, message: 'Scanner Bybit removido. Use /scanners/1.' },
    { status: 410 }
  );
}

export async function POST() {
  return GET();
}
