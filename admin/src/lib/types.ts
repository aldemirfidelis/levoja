import type { DocumentStatus, PartnerAction, PartnerStatus, UserStatus, VehicleType } from '@levoja/shared';

export interface UserView {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  cpfMasked: string | null;
  birthDate: string | null;
  avatarUrl: string | null;
  status: UserStatus;
  statusReason: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Me {
  user: UserView;
  roles: string[];
  permissions: string[];
  isStaff: boolean;
}

export interface Address {
  id?: string;
  zipCode: string;
  street: string;
  number: string;
  complement?: string | null;
  district: string;
  city: string;
  state: string;
  lat?: number | null;
  lng?: number | null;
}

export interface PartnerDocument {
  id: string;
  type: string;
  label: string;
  fileName: string;
  mimeType: string;
  status: DocumentStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  vehicleId?: string | null;
}

export interface Requirement {
  key: string;
  label: string;
  done: boolean;
  detail?: string;
}

export interface HistoryEntry {
  id: string;
  fromStatus: PartnerStatus;
  toStatus: PartnerStatus;
  action: string;
  reason: string | null;
  changedByName: string | null;
  createdAt: string;
}

export interface BankAccountView {
  holderName: string;
  bankCode: string;
  branch: string;
  accountLast4: string;
  accountType: string;
  pixKeyType: string | null;
  pixKeyMasked: string | null;
}

export interface CompanyListItem {
  id: string;
  tradeName: string;
  legalName: string;
  cnpj: string;
  status: PartnerStatus;
  submittedAt: string | null;
  createdAt: string;
  logoUrl: string | null;
  isOpen: boolean;
  segment: { name: string; isRegulated: boolean };
  address: { city: string; state: string } | null;
  pendingDocuments: number;
}

export interface CompanyDetail {
  id: string;
  legalName: string;
  tradeName: string;
  cnpj: string;
  responsibleName: string;
  responsibleCpfMasked: string;
  email: string;
  phone: string;
  description: string | null;
  logoUrl: string | null;
  segment: { name: string; isRegulated: boolean };
  address: Address | null;
  openingHours: { weekday: number; opensAt: string; closesAt: string }[];
  status: PartnerStatus;
  statusReason: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  isOpen: boolean;
  fulfillmentMode: string;
  documents: PartnerDocument[];
  bankAccount: BankAccountView | null;
  requirements: Requirement[];
  adminActions: PartnerAction[];
  history: HistoryEntry[];
  members: { id: string; name: string; email: string; role: { key: string; name: string }; isActive: boolean }[];
  createdAt: string;
}

export interface Vehicle {
  id: string;
  type: VehicleType;
  plate: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  status: DocumentStatus;
}

export interface DriverListItem {
  id: string;
  status: PartnerStatus;
  submittedAt: string | null;
  createdAt: string;
  ratingAvg: number;
  fleetType: string;
  user: { id: string; name: string; email: string; phone: string | null; avatarUrl: string | null };
  activeVehicle: { type: VehicleType; plate: string | null; model: string | null } | null;
  address: { city: string; state: string } | null;
  pendingDocuments: number;
}

export interface DriverDetail {
  id: string;
  status: PartnerStatus;
  statusReason: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  user: { id: string; name: string; email: string; phone: string | null; cpfMasked: string | null; birthDate: string | null; avatarUrl: string | null };
  cnhNumberMasked: string | null;
  cnhCategory: string | null;
  cnhExpiresAt: string | null;
  address: Address | null;
  activeVehicleId: string | null;
  vehicles: Vehicle[];
  documents: PartnerDocument[];
  bankAccount: BankAccountView | null;
  requirements: Requirement[];
  adminActions: PartnerAction[];
  history: HistoryEntry[];
  ratingAvg: number;
  createdAt: string;
}

export interface AdminUserListItem extends UserView {
  roles: { key: string; name: string }[];
  isCustomer: boolean;
  driverStatus: PartnerStatus | null;
  companiesCount: number;
}

export interface AdminUserDetail extends UserView {
  roles: { key: string; name: string; isStaff: boolean }[];
  customer: { id: string; createdAt: string } | null;
  driver: { id: string; status: PartnerStatus; createdAt: string } | null;
  companies: { isActive: boolean; role: { key: string; name: string }; company: { id: string; tradeName: string; status: PartnerStatus } }[];
  activeSessions: { familyId: string; createdAt: string; ip: string | null; userAgent: string | null }[];
}

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  scope: 'PLATFORM' | 'COMPANY';
  isSystem: boolean;
  isStaff: boolean;
  permissionKeys: string[];
  assignedCount: number;
}

export interface Permission {
  id: string;
  key: string;
  group: string;
  description: string;
  scope: 'PLATFORM' | 'COMPANY';
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
}

export interface Dashboard {
  users: { total: number; newLast30Days: number; customers: number };
  companies: { total: number; byStatus: Record<string, number>; awaitingReview: number };
  drivers: { total: number; byStatus: Record<string, number>; awaitingReview: number };
  pendingDocuments: { companies: number; drivers: number };
  privacyRequestsOpen: number;
  recentActivity: { id: string; action: string; entityType: string | null; createdAt: string; actor: { name: string } | null }[];
  business: {
    timeZone: string;
    today: { orders: number; gmvCents: number; averageTicketCents: number | null; canceledOrders: number; deliveriesCompleted: number; deliveriesCanceled: number } | null;
    last30Days: { orders: number; gmvCents: number; cancellationRate: number | null; commissionCents?: number; feesCents?: number; netRevenueCents?: number } | null;
    driversNow: { online: number; busy: number };
    tickets: { open: number; slaBreached: number } | null;
    ratings: Record<'companies' | 'drivers' | 'customers', { average: number | null; count: number }>;
  };
}

// -----------------------------------------------------------------------------
// Central de atendimento
// -----------------------------------------------------------------------------

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_REQUESTER' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type SlaState = 'ok' | 'risk' | 'breached' | 'done';

export interface TicketListItem {
  id: string;
  number: number;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  subject: string;
  requesterName: string;
  assignee: string | null;
  sla: { state: SlaState; dueAt: string };
  slaBreached: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TicketAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  internal: boolean;
  createdAt: string;
}

export interface TicketDetail extends Omit<TicketListItem, 'requesterName' | 'assignee'> {
  description: string;
  requester: { id: string; name: string; email: string; phone: string | null };
  requesterRole: 'CUSTOMER' | 'DRIVER' | 'COMPANY';
  companyId: string | null;
  assignee: { id: string; name: string } | null;
  firstResponseDueAt: string;
  resolutionDueAt: string;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  rating: number | null;
  ratingComment: string | null;
  orderId: string | null;
  deliveryId: string | null;
  order: { id: string; number: number; status: string; totalCents: number; company: { tradeName: string } } | null;
  delivery: { id: string; code: string; status: string } | null;
  payment: { id: string; method: string; status: string; amountCents: number } | null;
  messages: { id: string; body: string; internal: boolean; authorRole: string; authorName: string; createdAt: string }[];
  attachments: TicketAttachment[];
  events: { id: string; type: string; fromValue: string | null; toValue: string | null; actorName: string; createdAt: string }[];
}

export interface TicketStats {
  byStatus: Partial<Record<TicketStatus, number>>;
  breachedOpen: number;
  unassigned: number;
  mine: number;
  last30Days: { opened: number; avgFirstResponseMinutes: number | null; avgResolutionMinutes: number | null; slaCompliance: number | null; csat: number | null; ratings: number };
}
