/** Evita open redirect: só aceita caminhos internos. */
export function safeNext(next: string | null | undefined, fallback: string): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}

export interface MeSummary {
  isStaff: boolean;
  customerId: string | null;
  driver: { id: string; status: string } | null;
  companies: { id: string }[];
}

/** Destino após o login conforme o perfil do usuário. */
export function homeFor(me: MeSummary): string {
  if (me.companies.length === 1) return `/empresa/${me.companies[0].id}`;
  if (me.companies.length > 1) return '/empresa';
  if (me.driver) return '/entregador';
  return '/conta';
}
