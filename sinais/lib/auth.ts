/**
 * Autenticação simples com código de acesso
 */

import { cookies } from 'next/headers';

const SESSION_COOKIE_NAME = 'crypto-sinais-session';
const SESSION_VALUE = 'authenticated';

/**
 * Verifica se o código de acesso está correto
 */
export function validateAccessCode(code: string): boolean {
  const correctCode = process.env.ACCESS_CODE;
  if (!correctCode) {
    console.warn('ACCESS_CODE não configurado no .env');
    return false;
  }
  return code === correctCode;
}

/**
 * Cria uma sessão autenticada
 */
export async function createSession() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, SESSION_VALUE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 dias
  });
}

/**
 * Verifica se o usuário está autenticado
 */
export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE_NAME);
  return session?.value === SESSION_VALUE;
}

/**
 * Remove a sessão (logout)
 */
export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}






