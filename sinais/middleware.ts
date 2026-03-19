import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const session = request.cookies.get('crypto-sinais-session');
  const isAuthenticated = session?.value === 'authenticated';
  const isLoginPage = request.nextUrl.pathname === '/login';

  // Se não está autenticado e não está na página de login, redireciona para login
  if (!isAuthenticated && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Se está autenticado e está na página de login, redireciona para dashboard
  if (isAuthenticated && isLoginPage) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};






