import { NextRequest, NextResponse } from 'next/server';

/** Áreas autenticadas do portal. O restante é público (site institucional e cadastros). */
const PROTECTED = ['/empresa', '/conta', '/entregador', '/entregas'];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (!PROTECTED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return NextResponse.next();
  const hasSession = request.cookies.has('lj_web_at') || request.cookies.has('lj_web_rt');
  if (hasSession) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = '/entrar';
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/empresa/:path*', '/conta/:path*', '/entregador/:path*', '/entregas/:path*'],
};
