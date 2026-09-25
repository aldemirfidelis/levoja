import { NextRequest, NextResponse } from 'next/server';

/** Áreas autenticadas do portal. O restante é público (site institucional e cadastros). */
const PROTECTED = ['/empresa', '/conta', '/entregador', '/entregas'];

/**
 * Endereços do próprio portal (vírgula). Qualquer outro domínio que chegue aqui é tratado como
 * domínio próprio de uma empresa (marca própria): a raiz exibe a página da loja.
 */
const PLATFORM_HOSTS = (process.env.PLATFORM_HOSTS ?? 'localhost,127.0.0.1')
  .split(',')
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const host = (request.headers.get('host') ?? '').split(':')[0].toLowerCase();

  if (pathname === '/' && host && !PLATFORM_HOSTS.includes(host)) {
    const url = request.nextUrl.clone();
    url.pathname = `/marca-propria/${encodeURIComponent(host)}`;
    return NextResponse.rewrite(url);
  }

  if (!PROTECTED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return NextResponse.next();
  const hasSession = request.cookies.has('lj_web_at') || request.cookies.has('lj_web_rt');
  if (hasSession) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = '/entrar';
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/', '/empresa/:path*', '/conta/:path*', '/entregador/:path*', '/entregas/:path*'],
};
