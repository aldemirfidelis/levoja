import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/definir-senha', '/redefinir-senha'];

/**
 * Protege as páginas do painel: sem sessão, redireciona para o login.
 * (A autorização real acontece na API; aqui é apenas navegação.)
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has('lj_admin_at') || request.cookies.has('lj_admin_rt');
  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
