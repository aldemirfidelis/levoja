import type { DeliveryStatus, ItemCategory, OrderStatus, PaymentMethod, PaymentStatus, ProofOfDeliveryMethod, VehicleType } from '@levoja/shared';

export interface Segment {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  kind: string;
}

export interface Address {
  id: string;
  label: string | null;
  zipCode: string;
  street: string;
  number: string;
  complement: string | null;
  district: string;
  city: string;
  state: string;
  reference: string | null;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
}

export interface StoreCard {
  id: string;
  slug: string;
  tradeName: string;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  segment: { slug: string; name: string };
  ratingAvg: number;
  ratingCount: number;
  isOpenNow: boolean;
  minimumOrderCents: number;
  distanceKm: number | null;
  estimatedMinutes: { min: number; max: number } | null;
  city: string | null;
  /** false = favorita que não atende o endereço selecionado. */
  covered?: boolean;
}

export interface ProductOption {
  id: string;
  name: string;
  priceDeltaCents: number;
  available: boolean;
}

export interface Product {
  id: string;
  companyId: string;
  categoryId: string | null;
  type: 'SIMPLE' | 'COMBO' | string;
  name: string;
  description: string | null;
  priceCents: number;
  promoPriceCents: number | null;
  effectivePriceCents: number;
  onSale: boolean;
  available: boolean;
  isRegulated: boolean;
  requiresPrescription: boolean;
  minimumAge: number | null;
  images: { id: string; url: string | null }[];
  optionGroups: { id: string; name: string; minSelect: number; maxSelect: number; options: ProductOption[] }[];
  comboItems: { productId: string; name: string; quantity: number }[];
}

export interface StoreDetail {
  id: string;
  slug: string;
  tradeName: string;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  segment: { slug: string; name: string; isRegulated: boolean; minimumAge: number | null };
  address: { district: string; city: string; state: string; lat: number | null; lng: number | null } | null;
  openingHours: { weekday: number; opensAt: string; closesAt: string }[];
  isOpenNow: boolean;
  averagePrepMinutes: number;
  minimumOrderCents: number;
  ratingAvg: number;
  ratingCount: number;
  categories: { id: string; parentId: string | null; name: string; description: string | null; products: Product[] }[];
  uncategorized: Product[];
}

export interface CartLine {
  id: string;
  productId: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  notes: string | null;
  optionIds: string[];
  options: { optionId: string; name: string; priceDeltaCents: number }[];
  unitPriceCents: number;
  totalCents: number;
  requiresPrescription: boolean;
  minimumAge: number | null;
  issues: string[];
}

export interface Cart {
  companyId: string;
  company?: { id: string; tradeName: string; slug: string; logoUrl: string | null };
  minimumOrderCents?: number;
  items: CartLine[];
  itemsCount: number;
  subtotalCents: number;
  hasIssues: boolean;
  requiresPrescription?: boolean;
}

export interface Quote {
  companyId: string;
  fulfillment: 'DELIVERY' | 'PICKUP';
  subtotalCents: number;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  tipCents: number;
  discountCents: number;
  coupon: { code: string; type: string; description: string | null } | null;
  totalCents: number;
  distanceKm: number | null;
  estimatedDeliveryAt: string | null;
  requiresPrescription: boolean;
  requiresIdCheck: boolean;
  canCheckout: boolean;
  issues: string[];
}

export interface OrderPayment {
  id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amountCents: number;
  refundedCents: number;
  pixCopyPaste: string | null;
  pixExpiresAt: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  failureReason: string | null;
}

export interface TimelineEntry {
  status: string;
  at: string;
  actorType: string;
  reason: string | null;
}

export interface Order {
  id: string;
  number: number;
  status: OrderStatus;
  fulfillment: 'DELIVERY' | 'PICKUP';
  company: { id: string; tradeName: string; slug: string };
  items: { id: string; productId: string; name: string; quantity: number; unitPriceCents: number; totalCents: number; options: { name: string }[] | null; notes: string | null }[];
  subtotalCents: number;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  tipCents: number;
  discountCents: number;
  totalCents: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  changeForCents: number | null;
  deliveryAddress: { street: string; number: string; district?: string; city: string; lat?: number | null; lng?: number | null } | null;
  scheduledFor: string | null;
  estimatedDeliveryAt: string | null;
  cancelReason: string | null;
  timeline: TimelineEntry[];
  delivery: {
    id: string;
    code: string;
    status: DeliveryStatus;
    driver: { name: string; rating: number; vehicle: { type: VehicleType; plate: string | null; model: string | null; color: string | null } | null; location: { lat: number; lng: number; at: string } | null } | null;
  } | null;
  deliveryCode: string | null;
  canCancel: boolean;
  createdAt: string;
  payment?: OrderPayment | null;
}

export interface OrderListItem extends Omit<Order, 'payment'> {}

export interface Stop {
  name?: string;
  phone?: string;
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

export interface Delivery {
  id: string;
  code: string;
  kind: 'ORDER' | 'ON_DEMAND';
  status: DeliveryStatus;
  scheduledFor: string | null;
  order: { id: string; number: number } | null;
  pickup: Stop;
  dropoff: Stop;
  itemCategory: ItemCategory;
  itemDescription: string | null;
  vehicleType: VehicleType;
  distanceKm: number;
  durationMin: number;
  feeCents: number;
  tipCents: number;
  paymentMethod: PaymentMethod | null;
  proofMethod: ProofOfDeliveryMethod;
  driver: { id: string; name: string; photoUrl: string | null; rating: number; vehicle: { type: VehicleType; plate: string | null; model: string | null; color: string | null } | null } | null;
  driverLocation: { lat: number; lng: number; at: string } | null;
  estimatedArrivalAt: string | null;
  timeline: TimelineEntry[];
  cancelReason: string | null;
  failReason: string | null;
  createdAt: string;
  deliveredAt: string | null;
  dropoffCode: string | null;
  qrCodePayload: string | null;
  trackingPath: string;
}

export interface DeliveryQuote {
  vehicleType: VehicleType;
  distanceKm: number;
  durationMin: number;
  feeCents: number;
  breakdown: { label: string; cents: number }[];
}

export interface PaymentMethodsInfo {
  orders: PaymentMethod[];
  deliveries: { customer: PaymentMethod[]; company: PaymentMethod[] };
  online: boolean;
  provider: string | null;
  cardTokenization: { provider: 'sandbox' } | { provider: 'mercadopago'; publicKey: string } | null;
  sandbox: { cardTokens: Record<string, string> } | null;
}

// --- Fase 10: Home, cupons, fidelidade e indicação ---

export interface AvailableCoupon {
  id: string;
  code: string;
  description: string | null;
  type: 'PERCENT' | 'FIXED' | 'FREE_DELIVERY';
  percentBps: number | null;
  amountCents: number | null;
  maxDiscountCents: number | null;
  minOrderCents: number;
  firstOrderOnly: boolean;
  endsAt: string | null;
  visibility: 'PUBLIC' | 'TIER';
  minTierName: string | null;
  usesLeft: number;
  /** Motivo do bloqueio (ex.: nível de fidelidade abaixo do exigido). */
  locked: string | null;
  store: { id: string; slug: string; tradeName: string; logoUrl: string | null } | null;
  segment: { id: string; name: string; slug: string } | null;
}

export interface RecentOrder {
  id: string;
  number: number;
  status: OrderStatus;
  totalCents: number;
  createdAt: string;
  store: { id: string; slug: string; tradeName: string; logoUrl: string | null };
  summary: string;
}

export interface HomeData {
  favorites: StoreCard[];
  promotions: { store: StoreCard; coupons: AvailableCoupon[] }[];
  coupons: AvailableCoupon[];
  recentOrders: RecentOrder[];
  loyalty: { points: number; tier: { key: string; name: string }; redeemableCents: number } | null;
  referral: { referrerRewardCents: number; referredRewardCents: number } | null;
}

export interface LoyaltyTier {
  key: string;
  name: string;
  minPoints: number;
  multiplierBps: number;
  cashbackBps: number;
}

export interface LoyaltyTransaction {
  id: string;
  type: 'EARN' | 'REDEEM' | 'EXPIRE' | 'ADJUST';
  points: number;
  description: string;
  createdAt: string;
}

export type LoyaltySummary =
  | { enabled: false }
  | {
      enabled: true;
      points: number;
      lifetimePoints: number;
      yearPoints: number;
      redeemableCents: number;
      pointValueCents: number;
      pointsPerReal: number;
      minRedeemPoints: number;
      tier: LoyaltyTier;
      next: { tier: LoyaltyTier; missing: number } | null;
      tiers: LoyaltyTier[];
      expiresAt: string | null;
      recent: LoyaltyTransaction[];
    };
