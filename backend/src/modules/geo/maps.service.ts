import { Injectable, Logger } from '@nestjs/common';
import { haversineKm, LatLng } from '@levoja/shared';
import { AppConfig } from '../../config/config.module';
import { CacheService } from '../../infra/cache/cache.service';

export type TravelMode = 'BICYCLE' | 'MOTORCYCLE' | 'CAR' | 'VAN';

export interface RouteResult {
  distanceKm: number;
  durationMin: number;
  /** Provedor que respondeu (auditoria/depuração). */
  provider: string;
}

export interface GeocodeInput {
  street: string;
  number: string;
  district?: string;
  city: string;
  state: string;
  zipCode?: string;
}

/** Contrato de um provedor de mapas — trocar de provedor não exige mudar regras de negócio. */
export interface MapsProvider {
  readonly name: string;
  route(origin: LatLng, destination: LatLng, mode: TravelMode): Promise<RouteResult>;
  geocode?(address: GeocodeInput): Promise<LatLng | null>;
}

/** Velocidades médias urbanas (km/h) usadas na estimativa sem roteamento. */
const AVERAGE_SPEED: Record<TravelMode, number> = { BICYCLE: 14, MOTORCYCLE: 26, CAR: 22, VAN: 20 };
/** Fator de sinuosidade: distância real por ruas ≈ linha reta × 1,35. */
const DETOUR_FACTOR = 1.35;

/** Estimativa geométrica — modo de desenvolvimento e fallback quando o provedor falha. */
class HaversineProvider implements MapsProvider {
  readonly name = 'haversine';

  async route(origin: LatLng, destination: LatLng, mode: TravelMode): Promise<RouteResult> {
    const distanceKm = haversineKm(origin, destination) * DETOUR_FACTOR;
    return { distanceKm: round(distanceKm), durationMin: Math.max(1, Math.round((distanceKm / AVERAGE_SPEED[mode]) * 60)), provider: this.name };
  }
}

/** OSRM (Open Source Routing Machine) — auto-hospedado ou servidor compatível. */
class OsrmProvider implements MapsProvider {
  readonly name = 'osrm';

  constructor(private readonly baseUrl: string) {}

  async route(origin: LatLng, destination: LatLng, mode: TravelMode): Promise<RouteResult> {
    const profile = mode === 'BICYCLE' ? 'bike' : 'driving';
    const url = `${this.baseUrl.replace(/\/$/, '')}/route/v1/${profile}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=false`;
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`OSRM HTTP ${response.status}`);
    const data = (await response.json()) as { code: string; routes?: { distance: number; duration: number }[] };
    const best = data.routes?.[0];
    if (data.code !== 'Ok' || !best) throw new Error(`OSRM: ${data.code}`);
    // OSRM "driving" é calibrado para carros; motos costumam ser ~15% mais rápidas no trânsito urbano.
    const speedFactor = mode === 'MOTORCYCLE' ? 0.85 : 1;
    return { distanceKm: round(best.distance / 1000), durationMin: Math.max(1, Math.round((best.duration / 60) * speedFactor)), provider: this.name };
  }
}

/** Geocodificação via Nominatim (OpenStreetMap). Respeite a política de uso ou hospede sua instância. */
class NominatimGeocoder {
  constructor(
    private readonly baseUrl: string,
    private readonly userAgent: string,
  ) {}

  async geocode(address: GeocodeInput): Promise<LatLng | null> {
    const params = new URLSearchParams({
      street: `${address.number} ${address.street}`,
      city: address.city,
      state: address.state,
      country: 'Brasil',
      format: 'json',
      limit: '1',
    });
    if (address.zipCode) params.set('postalcode', address.zipCode);
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/search?${params}`, {
      headers: { 'User-Agent': this.userAgent, 'Accept-Language': 'pt-BR' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const results = (await response.json()) as { lat: string; lon: string }[];
    return results[0] ? { lat: Number(results[0].lat), lng: Number(results[0].lon) } : null;
  }
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Fachada de mapas: rotas (distância/tempo/ETA) e geocodificação.
 * MAPS_PROVIDER=haversine (dev) | osrm; GEOCODER=none | nominatim.
 */
@Injectable()
export class MapsService {
  private readonly logger = new Logger(MapsService.name);
  private readonly provider: MapsProvider;
  private readonly fallback = new HaversineProvider();
  private readonly geocoder?: NominatimGeocoder;

  constructor(
    config: AppConfig,
    private readonly cache: CacheService,
  ) {
    const env = config.env;
    this.provider = env.MAPS_PROVIDER === 'osrm' && env.OSRM_URL ? new OsrmProvider(env.OSRM_URL) : this.fallback;
    if (env.GEOCODER === 'nominatim') {
      this.geocoder = new NominatimGeocoder(env.NOMINATIM_URL, `${env.APP_NAME} (${env.API_PUBLIC_URL})`);
    }
  }

  get providerName(): string {
    return this.provider.name;
  }

  async route(origin: LatLng, destination: LatLng, mode: TravelMode = 'MOTORCYCLE'): Promise<RouteResult> {
    const key = `route:${mode}:${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}:${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}`;
    const cached = await this.cache.get<RouteResult>(key);
    if (cached) return cached;
    let result: RouteResult;
    try {
      result = await this.provider.route(origin, destination, mode);
    } catch (error) {
      this.logger.warn(`Provedor de rotas ${this.provider.name} falhou (${(error as Error).message}); usando estimativa.`);
      result = await this.fallback.route(origin, destination, mode);
    }
    await this.cache.set(key, result, 600);
    return result;
  }

  /** Distância em linha reta (sem custo) — para filtros e pré-seleção. */
  straightLineKm(origin: LatLng, destination: LatLng): number {
    return haversineKm(origin, destination);
  }

  /** Há geocodificador configurado (endereços sem coordenadas podem ser localizados). */
  get canGeocode(): boolean {
    return !!this.geocoder;
  }

  /**
   * Geocodificação com cache (30 dias) e fila serializada: no máximo 1 consulta por segundo ao
   * provedor (política de uso do Nominatim) — importante na validação de lotes grandes.
   */
  async geocode(address: GeocodeInput): Promise<LatLng | null> {
    if (!this.geocoder) return null;
    const key = `geocode:${[address.street, address.number, address.district, address.city, address.state, address.zipCode]
      .map((part) => (part ?? '').toString().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim().toLowerCase())
      .join('|')}`;
    const cached = await this.cache.get<LatLng | { miss: true }>(key);
    if (cached) return 'miss' in cached ? null : cached;
    const run = this.geocodeQueue.then(async () => {
      const wait = this.lastGeocodeAt + GEOCODE_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastGeocodeAt = Date.now();
      return this.geocoder!.geocode(address);
    });
    this.geocodeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    try {
      const point = await run;
      await this.cache.set(key, point ?? { miss: true }, point ? 30 * 86_400 : 3_600);
      return point;
    } catch (error) {
      this.logger.warn(`Geocodificação falhou: ${(error as Error).message}`);
      return null;
    }
  }

  private geocodeQueue: Promise<void> = Promise.resolve();
  private lastGeocodeAt = 0;
}

const GEOCODE_INTERVAL_MS = 1_100;
