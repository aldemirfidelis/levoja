import type { OrderStatus, PaymentMethod } from '@levoja/shared';

export interface OrderItemView {
  id: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  options: { group: string; option: string; priceDeltaCents: number }[] | null;
  notes: string | null;
}

export interface CompanyOrderView {
  id: string;
  number: number;
  status: OrderStatus;
  fulfillment: 'DELIVERY' | 'PICKUP';
  items: OrderItemView[];
  subtotalCents: number;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  tipCents: number;
  discountCents: number;
  totalCents: number;
  paymentMethod: PaymentMethod;
  paymentStatus: string;
  changeForCents: number | null;
  notes: string | null;
  deliveryAddress: { street: string; number: string; complement?: string | null; district: string; city: string; state: string; reference?: string | null } | null;
  scheduledFor: string | null;
  estimatedReadyAt: string | null;
  estimatedDeliveryAt: string | null;
  requiresIdCheck: boolean;
  hasPrescription: boolean;
  cancelReason: string | null;
  canceledBy: string | null;
  timeline: { status: OrderStatus; at: string; actorType: string; reason: string | null }[];
  customer: { firstName: string; phoneMasked: string | null };
  delivery: {
    id: string;
    code: string;
    status: string;
    driver: { name: string; rating: number; vehicle: { type: string; plate: string | null; model: string | null; color: string | null } | null } | null;
  } | null;
  createdAt: string;
}
