/** Central de atendimento: vocabulário compartilhado (API, portais e apps). */

export const TICKET_CATEGORIES = ['ORDER', 'PAYMENT', 'DELIVERY', 'PRODUCT', 'COMPANY', 'DRIVER', 'ACCOUNT', 'REFUND', 'OTHER'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  ORDER: 'Pedido',
  PAYMENT: 'Pagamento',
  DELIVERY: 'Entrega',
  PRODUCT: 'Produto',
  COMPANY: 'Empresa',
  DRIVER: 'Entregador',
  ACCOUNT: 'Cadastro e conta',
  REFUND: 'Reembolso',
  OTHER: 'Outros',
};

export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_REQUESTER', 'RESOLVED', 'CLOSED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: 'Aberto',
  IN_PROGRESS: 'Em atendimento',
  WAITING_REQUESTER: 'Aguardando você',
  RESOLVED: 'Resolvido',
  CLOSED: 'Encerrado',
};

/** Rótulos do ponto de vista da equipe (o "você" do solicitante vira "cliente"). */
export const TICKET_STATUS_STAFF_LABELS: Record<TicketStatus, string> = { ...TICKET_STATUS_LABELS, WAITING_REQUESTER: 'Aguardando solicitante' };

export const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = { LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta', URGENT: 'Urgente' };

export const CONVERSATION_TYPE_LABELS = {
  CUSTOMER_COMPANY: 'Cliente e loja',
  CUSTOMER_DRIVER: 'Cliente e entregador',
  COMPANY_DRIVER: 'Loja e entregador',
} as const;

/** Perfil de quem abriu o chamado. */
export const TICKET_REQUESTER_LABELS = { CUSTOMER: 'Cliente', DRIVER: 'Entregador', COMPANY: 'Empresa', STAFF: 'Equipe', SYSTEM: 'Sistema' } as const;

/** Histórico do chamado. */
export const TICKET_EVENT_LABELS: Record<string, string> = {
  CREATED: 'Chamado aberto',
  STATUS: 'Situação alterada',
  REOPENED: 'Chamado reaberto',
  ASSIGNED: 'Responsável definido',
  PRIORITY: 'Prioridade alterada',
  ATTACHMENT: 'Anexo enviado',
  SLA_BREACHED: 'Prazo de SLA estourado',
  RATED: 'Atendimento avaliado',
  AUTO_CLOSED: 'Encerrado automaticamente',
};

/** Situação do prazo (SLA) do chamado. */
export const SLA_STATE_LABELS = { ok: 'No prazo', risk: 'Em risco', breached: 'Estourado', done: 'Cumprido' } as const;

// -----------------------------------------------------------------------------
// Comunicados
// -----------------------------------------------------------------------------

export const BROADCAST_AUDIENCE_LABELS = { CUSTOMERS: 'Clientes', DRIVERS: 'Entregadores', COMPANY_USERS: 'Empresas (equipes)' } as const;
export const BROADCAST_KIND_LABELS = { MARKETING: 'Promoção', OPERATIONAL: 'Aviso operacional' } as const;
export const BROADCAST_STATUS_LABELS: Record<string, string> = { QUEUED: 'Na fila', SENDING: 'Enviando', SENT: 'Enviado', FAILED: 'Interrompido' };
export const BROADCAST_CHANNEL_LABELS = { inapp: 'No app/portal', push: 'Push', email: 'E-mail' } as const;
