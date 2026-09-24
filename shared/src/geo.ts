export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Distância em linha reta (grande círculo) em km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ponto dentro de polígono (ray casting). Polígono como lista de [lng, lat] (GeoJSON). */
export function pointInPolygon(point: LatLng, polygon: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = yi > point.lat !== yj > point.lat && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Aproxima coordenadas (privacidade): usado para mostrar "local aproximado" ao entregador. */
export function approximate(point: LatLng, decimals = 3): LatLng {
  const factor = 10 ** decimals;
  return { lat: Math.round(point.lat * factor) / factor, lng: Math.round(point.lng * factor) / factor };
}

/** Geohash simples (base32) para agregações de mapa de calor. */
export function geohash(point: LatLng, precision = 6): string {
  const base32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  let latRange: [number, number] = [-90, 90];
  let lngRange: [number, number] = [-180, 180];
  let hash = '';
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    const range = even ? lngRange : latRange;
    const value = even ? point.lng : point.lat;
    const mid = (range[0] + range[1]) / 2;
    if (value >= mid) {
      ch |= 1 << (4 - bit);
      range[0] = mid;
    } else {
      range[1] = mid;
    }
    if (even) lngRange = range;
    else latRange = range;
    even = !even;
    if (bit < 4) bit++;
    else {
      hash += base32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}
