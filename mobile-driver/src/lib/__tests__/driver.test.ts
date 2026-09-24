import type { OutboxItem } from '@levoja/mobile-kit';
import { effectiveStatus, pendingFor } from '../pending';

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-location', () => ({ Accuracy: { High: 4 }, ActivityType: { AutomotiveNavigation: 2 } }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { toPoints } from '../location';

const item = (kind: string, payload: object): OutboxItem => ({ id: Math.random().toString(36), kind, payload, createdAt: Date.now(), attempts: 0 });

describe('status com ações offline', () => {
  it('aplica as ações pendentes em ordem sobre o status do servidor', () => {
    const pending = [item('action', { deliveryId: 'd1', action: 'arrived-pickup' }), item('action', { deliveryId: 'd1', action: 'picked-up' })];
    expect(effectiveStatus('DRIVER_ASSIGNED', pending)).toBe('PICKED_UP');
    expect(effectiveStatus('AT_DROPOFF', [item('deliver', { deliveryId: 'd1', method: 'CODE' })])).toBe('DELIVERED');
    expect(effectiveStatus('IN_TRANSIT', [item('fail', { deliveryId: 'd1', reasonCode: 'RECIPIENT_ABSENT' })])).toBe('FAILED');
    expect(effectiveStatus('IN_TRANSIT', [])).toBe('IN_TRANSIT');
  });

  it('considera apenas as ações da entrega (e ignora pontos de GPS)', () => {
    const items = [item('locations', [{ lat: 1, lng: 1 }]), item('action', { deliveryId: 'd2', action: 'picked-up' }), item('action', { deliveryId: 'd1', action: 'arrived-pickup' })];
    expect(pendingFor(items, 'd1')).toHaveLength(1);
  });
});

describe('pontos de GPS', () => {
  const reading = (coords: Partial<{ latitude: number; longitude: number; accuracy: number | null; speed: number | null; heading: number | null }>, timestamp = 1_700_000_000_000) =>
    ({ coords: { latitude: -23.5, longitude: -46.6, accuracy: 10, speed: 5, heading: 90, altitude: null, altitudeAccuracy: null, ...coords }, timestamp }) as never;

  it('descarta leituras imprecisas e valores inválidos do sensor', () => {
    const points = toPoints([reading({ accuracy: 500 }), reading({ speed: -1, heading: -1, accuracy: 12.6 })]);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ lat: -23.5, lng: -46.6, accuracy: 13, speed: undefined, heading: undefined, recordedAt: new Date(1_700_000_000_000).toISOString() });
  });

  it('limita velocidade e direção aos intervalos aceitos pela API', () => {
    const [point] = toPoints([reading({ speed: 180, heading: 400 })]);
    expect(point.speed).toBe(100);
    expect(point.heading).toBe(360);
  });

  it('marca leituras de localização simulada (Android)', () => {
    const [mocked] = toPoints([{ ...(reading({}) as object), mocked: true } as never]);
    const [real] = toPoints([reading({})]);
    expect(mocked.mocked).toBe(true);
    expect(real).not.toHaveProperty('mocked');
  });
});
