import { NextRequest, NextResponse } from 'next/server';
import { bff } from '@/lib/bff';

/** Sessão do portal: /api/auth/login | mfa | logout | register/{customer|company|driver}. */
export async function POST(request: NextRequest, context: { params: Promise<{ action: string[] }> }) {
  const { action } = await context.params;
  const [first, second] = action;
  if (first === 'login' && !second) return bff.login(request);
  if (first === 'mfa' && !second) return bff.mfa(request);
  if (first === 'logout' && !second) return bff.logout(request);
  if (first === 'register' && second) return bff.register(request, second);
  return NextResponse.json({ message: 'Não encontrado.' }, { status: 404 });
}
