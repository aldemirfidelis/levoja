import { NextRequest, NextResponse } from 'next/server';
import { bff } from '@/lib/bff';

/** Sessão do painel: POST /api/auth/login | mfa | logout (cookies httpOnly). */
export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  switch (action) {
    case 'login':
      return bff.login(request);
    case 'mfa':
      return bff.mfa(request);
    case 'logout':
      return bff.logout(request);
    default:
      return NextResponse.json({ message: 'Não encontrado.' }, { status: 404 });
  }
}
