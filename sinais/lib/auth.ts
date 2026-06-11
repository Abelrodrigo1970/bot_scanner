/**
 * Autenticação simples com código de acesso
 */

import { cookies } from 'next/headers';

const SESSION_COOKIE_NAME = 'crypto-sinais-session';
const SESSION_VALUE = 'authenticated';

/** Login desactivado explicitamente ou sem ACCESS_CODE configurado. */
export function isAuthDisabled(): boolean {
  if (process.env.AUTH_DISABLED === 'true') return true;
  if (process.env.AUTH_DISABLED === 'false') return false;
  return !process.env.ACCESS_CODE?.trim();
}

/**
 * Verifica se o código de acesso está correto
 */
export function validateAccessCode(code: string): boolean {
  const correctCode = process.env.ACCESS_CODE?.trim();
  if (!correctCode) {
    console.warn('ACCESS_CODE não configurado no .env');
    return false;
  }
  return code.trim() === correctCode;
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
 * Verifica se o usuário está autenticado.
 * Se AUTH_DISABLED=true, considera sempre autenticado (acesso sem login).
 */
export async function isAuthenticated(): Promise<boolean> {
  if (isAuthDisabled()) {
    return true;
  }
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






