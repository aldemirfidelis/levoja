/**
 * Status de domínio e suas máquinas de estado.
 *
 * Os valores são idênticos aos enums do Prisma (backend/prisma/schema.prisma).
 * As transições são a fonte da verdade para o backend (validação) e para as
 * interfaces (quais ações exibir).
 */

// ---------------------------------------------------------------------------
// Usuários
// ---------------------------------------------------------------------------
export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'BLOCKED', 'DEACTIVATED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: 'Ativo',
  SUSPENDED: 'Suspenso',
  BLOCKED: 'Bloqueado',
  DEACTIVATED: 'Desativado',
};

// ---------------------------------------------------------------------------
// Cadastro de parceiros (empresas e entregadores)
// ---------------------------------------------------------------------------
export const PARTNER_STATUSES = [
  'DRAFT',
  'PENDING_DOCUMENTS',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
  'BLOCKED',
] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export const PARTNER_STATUS_LABELS: Record<PartnerStatus, string> = {
  DRAFT: 'Cadastro iniciado',
  PENDING_DOCUMENTS: 'Documentação pendente',
  UNDER_REVIEW: 'Em análise',
  APPROVED: 'Aprovado',
  REJECTED: 'Reprovado',
  SUSPENDED: 'Suspenso',
  BLOCKED: 'Bloqueado',
};

/** Quem pode disparar a transição: o próprio parceiro ou a administração. */
export type PartnerActor = 'OWNER' | 'REVIEWER' | 'MANAGER';

export type PartnerAction = 'SUBMIT' | 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES' | 'SUSPEND' | 'BLOCK' | 'REACTIVATE';

export const PARTNER_ACTION_LABELS: Record<PartnerAction, string> = {
  SUBMIT: 'Enviar para análise',
  APPROVE: 'Aprovar',
  REJECT: 'Reprovar',
  REQUEST_CHANGES: 'Solicitar correção',
  SUSPEND: 'Suspender',
  BLOCK: 'Bloquear',
  REACTIVATE: 'Reativar',
};

interface PartnerTransition {
  from: readonly PartnerStatus[];
  to: PartnerStatus;
  actor: PartnerActor;
  requiresReason: boolean;
}

export const PARTNER_TRANSITIONS: Record<PartnerAction, PartnerTransition> = {
  SUBMIT: { from: ['DRAFT', 'PENDING_DOCUMENTS', 'REJECTED'], to: 'UNDER_REVIEW', actor: 'OWNER', requiresReason: false },
  APPROVE: { from: ['UNDER_REVIEW'], to: 'APPROVED', actor: 'REVIEWER', requiresReason: false },
  REJECT: { from: ['UNDER_REVIEW'], to: 'REJECTED', actor: 'REVIEWER', requiresReason: true },
  REQUEST_CHANGES: { from: ['UNDER_REVIEW'], to: 'PENDING_DOCUMENTS', actor: 'REVIEWER', requiresReason: true },
  SUSPEND: { from: ['APPROVED'], to: 'SUSPENDED', actor: 'MANAGER', requiresReason: true },
  BLOCK: { from: ['APPROVED', 'SUSPENDED', 'UNDER_REVIEW', 'PENDING_DOCUMENTS', 'REJECTED'], to: 'BLOCKED', actor: 'MANAGER', requiresReason: true },
  REACTIVATE: { from: ['SUSPENDED', 'BLOCKED'], to: 'APPROVED', actor: 'MANAGER', requiresReason: true },
};

export function partnerTransition(action: PartnerAction, current: PartnerStatus): PartnerTransition | null {
  const transition = PARTNER_TRANSITIONS[action];
  return transition.from.includes(current) ? transition : null;
}

export function availablePartnerActions(current: PartnerStatus, actor: PartnerActor): PartnerAction[] {
  return (Object.keys(PARTNER_TRANSITIONS) as PartnerAction[]).filter((action) => {
    const transition = PARTNER_TRANSITIONS[action];
    return transition.actor === actor && transition.from.includes(current);
  });
}

export const DOCUMENT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  PENDING: 'Aguardando análise',
  APPROVED: 'Aprovado',
  REJECTED: 'Reprovado',
};

export const COMPANY_DOCUMENT_TYPES = [
  'CNPJ_CARD',
  'SOCIAL_CONTRACT',
  'RESPONSIBLE_ID',
  'ADDRESS_PROOF',
  'OPERATING_LICENSE',
  'SANITARY_LICENSE',
  'PHARMACIST_REGISTRATION',
  'OTHER',
] as const;
export type CompanyDocumentType = (typeof COMPANY_DOCUMENT_TYPES)[number];

export const COMPANY_DOCUMENT_LABELS: Record<CompanyDocumentType, string> = {
  CNPJ_CARD: 'Cartão CNPJ',
  SOCIAL_CONTRACT: 'Contrato social',
  RESPONSIBLE_ID: 'Documento do responsável',
  ADDRESS_PROOF: 'Comprovante de endereço',
  OPERATING_LICENSE: 'Alvará de funcionamento',
  SANITARY_LICENSE: 'Licença sanitária',
  PHARMACIST_REGISTRATION: 'Registro do farmacêutico responsável (CRF)',
  OTHER: 'Outro',
};

export const DRIVER_DOCUMENT_TYPES = [
  'CNH',
  'VEHICLE_REGISTRATION',
  'ID_DOCUMENT',
  'SELFIE',
  'ADDRESS_PROOF',
  'CRIMINAL_RECORD',
  'OTHER',
] as const;
export type DriverDocumentType = (typeof DRIVER_DOCUMENT_TYPES)[number];

export const DRIVER_DOCUMENT_LABELS: Record<DriverDocumentType, string> = {
  CNH: 'CNH',
  VEHICLE_REGISTRATION: 'Documento do veículo (CRLV)',
  ID_DOCUMENT: 'Documento de identidade',
  SELFIE: 'Selfie com documento',
  ADDRESS_PROOF: 'Comprovante de endereço',
  CRIMINAL_RECORD: 'Certidão de antecedentes criminais',
  OTHER: 'Outro',
};

export const VEHICLE_TYPES = ['BICYCLE', 'MOTORCYCLE', 'CAR', 'VAN'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  BICYCLE: 'Bicicleta',
  MOTORCYCLE: 'Moto',
  CAR: 'Carro',
  VAN: 'Utilitário',
};

/** Veículos motorizados exigem CNH e documento do veículo. */
export function requiredDriverDocuments(vehicleType: VehicleType): DriverDocumentType[] {
  const base: DriverDocumentType[] = ['ID_DOCUMENT', 'SELFIE', 'ADDRESS_PROOF'];
  return vehicleType === 'BICYCLE' ? base : ['CNH', 'VEHICLE_REGISTRATION', ...base.filter((d) => d !== 'ID_DOCUMENT')];
}

// ---------------------------------------------------------------------------
// Pedidos (marketplace)
// ---------------------------------------------------------------------------
export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'NEW',
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'DRIVER_ASSIGNED',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
  'CANCELED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Aguardando pagamento',
  NEW: 'Novo',
  CONFIRMED: 'Confirmado',
  PREPARING: 'Em preparação',
  READY_FOR_PICKUP: 'Pronto para coleta',
  DRIVER_ASSIGNED: 'Entregador a caminho',
  PICKED_UP: 'Coletado',
  IN_TRANSIT: 'Em rota',
  DELIVERED: 'Entregue',
  CANCELED: 'Cancelado',
};

/** Transições válidas do pedido. As etapas logísticas são dirigidas pela entrega. */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_PAYMENT: ['NEW', 'CANCELED'],
  NEW: ['CONFIRMED', 'CANCELED'],
  CONFIRMED: ['PREPARING', 'CANCELED'],
  PREPARING: ['READY_FOR_PICKUP', 'CANCELED'],
  READY_FOR_PICKUP: ['DRIVER_ASSIGNED', 'PICKED_UP', 'CANCELED'],
  DRIVER_ASSIGNED: ['READY_FOR_PICKUP', 'PICKED_UP', 'CANCELED'],
  // Após a coleta, o cancelamento só ocorre por falha na entrega (cliente ausente, endereço incorreto...).
  PICKED_UP: ['IN_TRANSIT', 'DELIVERED', 'CANCELED'],
  IN_TRANSIT: ['DELIVERED', 'CANCELED'],
  DELIVERED: [],
  CANCELED: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export const ORDER_ACTIVE_STATUSES: readonly OrderStatus[] = [
  'NEW',
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'DRIVER_ASSIGNED',
  'PICKED_UP',
  'IN_TRANSIT',
];

/** O cliente só cancela sozinho antes do preparo começar. */
export const ORDER_CUSTOMER_CANCELABLE: readonly OrderStatus[] = ['PENDING_PAYMENT', 'NEW'];

// ---------------------------------------------------------------------------
// Entregas (logística)
// ---------------------------------------------------------------------------
export const DELIVERY_STATUSES = [
  'PENDING',
  'SCHEDULED',
  'SEARCHING_DRIVER',
  'DRIVER_ASSIGNED',
  'AT_PICKUP',
  'PICKED_UP',
  'IN_TRANSIT',
  'AT_DROPOFF',
  'DELIVERED',
  'FAILED',
  'CANCELED',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  PENDING: 'Aguardando liberação',
  SCHEDULED: 'Agendada',
  SEARCHING_DRIVER: 'Procurando entregador',
  DRIVER_ASSIGNED: 'Entregador a caminho da coleta',
  AT_PICKUP: 'Entregador no local de coleta',
  PICKED_UP: 'Coletado',
  IN_TRANSIT: 'Em rota de entrega',
  AT_DROPOFF: 'Entregador no destino',
  DELIVERED: 'Entregue',
  FAILED: 'Falha na entrega',
  CANCELED: 'Cancelada',
};

export const DELIVERY_TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  PENDING: ['SEARCHING_DRIVER', 'SCHEDULED', 'CANCELED'],
  SCHEDULED: ['SEARCHING_DRIVER', 'CANCELED'],
  SEARCHING_DRIVER: ['DRIVER_ASSIGNED', 'CANCELED', 'FAILED'],
  DRIVER_ASSIGNED: ['AT_PICKUP', 'PICKED_UP', 'SEARCHING_DRIVER', 'CANCELED'],
  AT_PICKUP: ['PICKED_UP', 'SEARCHING_DRIVER', 'CANCELED'],
  PICKED_UP: ['IN_TRANSIT', 'AT_DROPOFF', 'FAILED'],
  IN_TRANSIT: ['AT_DROPOFF', 'DELIVERED', 'FAILED'],
  AT_DROPOFF: ['DELIVERED', 'FAILED'],
  DELIVERED: [],
  FAILED: [],
  CANCELED: [],
};

export function canTransitionDelivery(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return DELIVERY_TRANSITIONS[from].includes(to);
}

export const DELIVERY_ACTIVE_STATUSES: readonly DeliveryStatus[] = [
  'DRIVER_ASSIGNED',
  'AT_PICKUP',
  'PICKED_UP',
  'IN_TRANSIT',
  'AT_DROPOFF',
];

export const DRIVER_AVAILABILITIES = ['OFFLINE', 'ONLINE', 'BUSY'] as const;
export type DriverAvailability = (typeof DRIVER_AVAILABILITIES)[number];

export const PROOF_OF_DELIVERY_METHODS = ['CODE', 'QR_CODE', 'PHOTO', 'SIGNATURE'] as const;
export type ProofOfDeliveryMethod = (typeof PROOF_OF_DELIVERY_METHODS)[number];

export const PROOF_METHOD_LABELS: Record<ProofOfDeliveryMethod, string> = {
  CODE: 'Código de entrega',
  QR_CODE: 'QR code',
  PHOTO: 'Foto',
  SIGNATURE: 'Assinatura digital',
};

export const ITEM_CATEGORIES = ['FOOD', 'DOCUMENT', 'PACKAGE', 'GIFT', 'MEDICINE', 'ELECTRONICS', 'CLOTHING', 'OTHER'] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const ITEM_CATEGORY_LABELS: Record<ItemCategory, string> = {
  FOOD: 'Alimentos',
  DOCUMENT: 'Documentos',
  PACKAGE: 'Encomenda',
  GIFT: 'Presente',
  MEDICINE: 'Medicamentos',
  ELECTRONICS: 'Eletrônicos',
  CLOTHING: 'Roupas',
  OTHER: 'Outros',
};

/** Ordem de porte dos veículos: um veículo maior pode levar a carga de um menor. */
export const VEHICLE_RANK: Record<VehicleType, number> = { BICYCLE: 0, MOTORCYCLE: 1, CAR: 2, VAN: 3 };

/** Capacidade de carga padrão (kg) por tipo de veículo. */
export const VEHICLE_CAPACITY_KG: Record<VehicleType, number> = { BICYCLE: 5, MOTORCYCLE: 20, CAR: 150, VAN: 1000 };

/** Menor veículo adequado para o peso informado. */
export function minimumVehicleFor(weightKg: number): VehicleType {
  if (weightKg <= VEHICLE_CAPACITY_KG.MOTORCYCLE) return 'MOTORCYCLE';
  if (weightKg <= VEHICLE_CAPACITY_KG.CAR) return 'CAR';
  return 'VAN';
}

// ---------------------------------------------------------------------------
// Pagamentos
// ---------------------------------------------------------------------------
export const PAYMENT_METHODS = ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'WALLET', 'CASH', 'INVOICE'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  PIX: 'PIX',
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
  WALLET: 'Carteira digital',
  CASH: 'Dinheiro na entrega',
  INVOICE: 'Faturado (B2B)',
};

export const PAYMENT_STATUSES = ['PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'CANCELED', 'REFUNDED', 'PARTIALLY_REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: 'Pendente',
  AUTHORIZED: 'Autorizado',
  PAID: 'Pago',
  FAILED: 'Falhou',
  CANCELED: 'Cancelado',
  REFUNDED: 'Estornado',
  PARTIALLY_REFUNDED: 'Estornado parcialmente',
};
