import { NextRequest, NextResponse } from 'next/server';
import { validateAccessCode, createSession } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code } = body;

    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        { error: 'Código de acesso é obrigatório' },
        { status: 400 }
      );
    }

    if (validateAccessCode(code)) {
      await createSession();
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json(
        { error: 'Código de acesso incorreto' },
        { status: 401 }
      );
    }
  } catch (error) {
    console.error('Erro no login:', error);
    return NextResponse.json(
      { error: 'Erro ao processar login' },
      { status: 500 }
    );
  }
}






