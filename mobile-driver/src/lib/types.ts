import type { DeliveryStatus, DocumentStatus, ItemCategory, PartnerAction, PartnerStatus, PaymentMethod, ProofOfDeliveryMethod, VehicleType, WithdrawalStatus } from '@levoja/shared';

export interface Dashboard {
  availability: 'OFFLINE' | 'ONLINE' | 'BUSY';
  onlineSince: string | null;
  activeDeliveries: number;
  earnings: Record<'today' | 'week' | 'month', { cents: number; deliveries: number }>;
  completedDeliveries: number;
  rating: { average: number; count: number };
  acceptanceRate: number | null;
  cancellationRate: number | null;
}

export interface Offer {
  id: string;
  deliveryId?: string;
  expiresAt: string;
  secondsLeft: number;
  payoutCents: number;
  distanceToPickupKm: number;
  totalDistanceKm: number;
  estimatedMinutes: number;
  pickupArea: string;
  dropoffArea: string;
  itemCategory: ItemCategory;
  weightKg: number | null;
  vehicleType: VehicleType;
  paymentMethod: PaymentMethod | null;
  kind: 'ORDER' | 'ON_DEMAND';
  notes: string | null;
  /** Rota de lote: várias entregas com a mesma coleta, aceitas juntas. */
  route?: { stops: number; distanceKm: number; durationMin: number } | null;
}

export interface Stop {
  name?: string;
  phone?: string | null;
  street: string;
  number: string;
  complement?: string | null;
  district?: string;
  city: string;
  state: string;
  reference?: string | null;
  lat: number;
  lng: number;
}

export interface DriverDelivery {
  id: string;
  code: string;
  kind: 'ORDER' | 'ON_DEMAND';
  status: DeliveryStatus;
  scheduledFor: string | null;
  company: { id: string; tradeName: string } | null;
  pickup: Stop;
  dropoff: Stop;
  itemCategory: ItemCategory;
  itemDescription: string | null;
  weightKg: number | null;
  vehicleType: VehicleType;
  distanceKm: number;
  durationMin: number;
  feeCents: number;
  tipCents: number;
  payoutCents: number;
  paymentMethod: PaymentMethod | null;
  proofMethod: ProofOfDeliveryMethod;
  requiresIdCheck: boolean;
  notes: string | null;
  estimatedArrivalAt: string | null;
  order: { id: string; number: number; items: string[]; collectCents: number; changeForCents: number | null } | null;
  collectCents?: number;
  cancelReason: string | null;
  failReason: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface RouteStop {
  deliveryId: string;
  code: string;
  type: 'PICKUP' | 'DROPOFF';
  lat: number;
  lng: number;
  label: string;
}

export interface ActiveRoute {
  deliveries: DriverDelivery[];
  stops: RouteStop[];
}

export interface Vehicle {
  id: string;
  type: VehicleType;
  plate: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  status: string;
}

export interface DriverDoc {
  id: string;
  type: string;
  label: string;
  fileName: string;
  status: DocumentStatus;
  reviewNote: string | null;
  createdAt: string;
}

export interface DriverProfile {
  id: string;
  status: PartnerStatus;
  statusReason: string | null;
  user: { name: string; cpfMasked: string | null; birthDate: string | null };
  cnhNumberMasked: string | null;
  cnhCategory: string | null;
  cnhExpiresAt: string | null;
  activeVehicleId: string | null;
  vehicles: Vehicle[];
  documents: DriverDoc[];
  bankAccount: { holderName: string; bankCode: string; branch: string; accountLast4: string; accountType: string; pixKeyType: string | null; pixKeyMasked: string | null } | null;
  requirements: { key: string; label: string; done: boolean; detail?: string }[];
  ownerActions: PartnerAction[];
  address: Record<string, unknown> | null;
}

export interface WithdrawalView {
  id: string;
  amountCents: number;
  feeCents: number;
  status: WithdrawalStatus;
  statusLabel?: string;
  destination: string;
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface WalletOverview {
  id: string;
  availableCents: number;
  pendingCents: number;
  debtCents: number;
  monthTotals: Record<string, number>;
  cashLimitCents: number | null;
  cashLimitReached: boolean;
  canSettleDebtOnline: boolean;
  withdrawal: { mode: 'manual' | 'automatic'; minCents: number; feeCents: number; pixKey: string | null; open: WithdrawalView | null };
}
