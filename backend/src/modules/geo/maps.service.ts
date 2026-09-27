import { Injectable, Logger } from '@nestjs/common';
import { haversineKm, LatLng } from '@levoja/shared';
import { AppConfig } from '../../config/config.module';
import { CacheService } from '../../infra/cache/cache.service';
import { NavigationRoute, toNavigationRoute } from './navigation';

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
  /**
   * Servidor OSRM da navegação curva a curva: o configurado (OSRM_URL) ou, sem configuração, o servidor
   * público de demonstração do projeto OSRM — serve para testes; em produção hospede o seu (ou contrate).
   */
  private readonly navigationUrl: string;
  private readonly userAgent: string;

  constructor(
    config: AppConfig,
    private readonly cache: CacheService,
  ) {
    const env = config.env;
    this.provider = env.MAPS_PROVIDER === 'osrm' && env.OSRM_URL ? new OsrmProvider(env.OSRM_URL) : this.fallback;
    const navigationUrl = env.OSRM_URL ?? 'https://router.project-osrm.org';
    this.navigationUrl = navigationUrl.endsWith('/') ? navigationUrl.slice(0, -1) : navigationUrl;
    this.userAgent = `${env.APP_NAME} (${env.API_PUBLIC_URL})`;
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

  /**
   * Rota curva a curva para a navegação dentro do app do entregador (linha no mapa + manobras em
   * português). Cache curto por trecho (~10 m); se o serviço de rotas falhar, devolve a linha reta
   * até o destino (o app avisa que a rota é aproximada).
   */
  async navigation(origin: LatLng, destination: LatLng, mode: TravelMode = 'MOTORCYCLE'): Promise<NavigationRoute> {
    const key = `nav:${mode}:${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}:${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}`;
    const cached = await this.cache.get<NavigationRoute>(key);
    if (cached) return cached;
    try {
      const url = `${this.navigationUrl}/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=true`;
      const response = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': this.userAgent } });
      if (!response.ok) throw new Error(`OSRM HTTP ${response.status}`);
      const data = (await response.json()) as { code: string; routes?: Parameters<typeof toNavigationRoute>[0][] };
      const best = data.routes?.[0];
      if (data.code !== 'Ok' || !best) throw new Error(`OSRM: ${data.code}`);
      // Mesmo ajuste das estimativas: motos ~15% mais rápidas que o perfil de carro do OSRM.
      const result = toNavigationRoute(best, mode === 'MOTORCYCLE' ? 0.85 : 1);
      await this.cache.set(key, result, 120);
      return result;
    } catch (error) {
      this.logger.warn(`Navegação: serviço de rotas indisponível (${(error as Error).message}); usando linha reta.`);
      const estimate = await this.fallback.route(origin, destination, mode);
      const distanceM = Math.round(estimate.distanceKm * 1000);
      const durationS = estimate.durationMin * 60;
      return {
        distanceM,
        durationS,
        geometry: [
          [origin.lat, origin.lng],
          [destination.lat, destination.lng],
        ],
        steps: [
          { instruction: 'Siga em direção ao destino', type: 'depart', modifier: null, name: '', distanceM, durationS, location: [origin.lat, origin.lng] },
          { instruction: 'Você chegou ao destino', type: 'arrive', modifier: null, name: '', distanceM: 0, durationS: 0, location: [destination.lat, destination.lng] },
        ],
        provider: 'straight',
      };
    }
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
