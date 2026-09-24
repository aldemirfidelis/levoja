import type { DeliveryStatus } from '@levoja/shared';

export interface StopView {
  name: string | null;
  street: string;
  number: string;
  complement: string | null;
  district: string | null;
  city: string;
  state: string;
  lat: number;
  lng: number;
}

export interface DeliveryView {
  id: string;
  code: string;
  kind: 'ORDER' | 'ON_DEMAND';
  status: DeliveryStatus;
  scheduledFor: string | null;
  order: { id: string; number: number } | null;
  company: { id: string; tradeName: string } | null;
  pickup: StopView;
  dropoff: StopView;
  itemCategory: string;
  itemDescription: string | null;
  weightKg: number | null;
  vehicleType: string;
  distanceKm: number;
  durationMin: number;
  feeCents: number;
  tipCents: number;
  paymentMethod: string | null;
  proofMethod: 'CODE' | 'QR_CODE' | 'PHOTO' | 'SIGNATURE';
  notes: string | null;
  driver: { id: string; name: string; photoUrl: string | null; rating: number; vehicle: { type: string; plate: string | null; brand: string | null; model: string | null; color: string | null } | null } | null;
  driverLocation: { lat: number; lng: number; at: string } | null;
  estimatedArrivalAt: string | null;
  timeline: { status: DeliveryStatus; at: string; actorType: string; reason: string | null }[];
  proofs: { method: string; recipientName: string | null; codeVerified: boolean; at: string; hasFile: boolean }[];
  dropoffCode: string | null;
  qrCodePayload: string | null;
  trackingPath: string;
  cancelReason: string | null;
  failReason: string | null;
  createdAt: string;
  deliveredAt: string | null;
}
