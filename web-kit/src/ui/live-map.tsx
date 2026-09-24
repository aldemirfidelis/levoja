'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import type * as Leaflet from 'leaflet';
import { HEAT_RAMP, heatStep } from './charts';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  /** Tipo visual do marcador. */
  kind?: 'pickup' | 'dropoff' | 'driver' | 'driver-busy' | 'point' | 'alert';
}

const COLORS: Record<NonNullable<MapMarker['kind']>, string> = {
  pickup: '#2563eb',
  dropoff: '#16a34a',
  driver: '#ff5a1f',
  'driver-busy': '#d97706',
  point: '#6b7280',
  alert: '#d03b3b',
};

/**
 * Mapa (Leaflet) com provedor de tiles configurável — NEXT_PUBLIC_MAP_TILES_URL
 * (padrão OpenStreetMap; em produção use um provedor contratado ou tiles próprios).
 * Carregado apenas no navegador.
 */
export function LiveMap({
  markers,
  path,
  height = 360,
  fit = true,
  className,
}: {
  markers: MapMarker[];
  /** Trajeto (histórico da rota). */
  path?: [number, number][];
  height?: number;
  fit?: boolean;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const leaflet = useRef<typeof Leaflet | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    let disposed = false;
    void import('leaflet').then((L) => {
      if (disposed || !container.current || map.current) return;
      leaflet.current = L;
      map.current = L.map(container.current, { zoomControl: true, attributionControl: true }).setView([-23.55, -46.63], 12);
      L.tileLayer(process.env.NEXT_PUBLIC_MAP_TILES_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? '&copy; OpenStreetMap',
      }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
      draw();
    });
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = () => {
    const L = leaflet.current;
    if (!L || !map.current || !layer.current) return;
    layer.current.clearLayers();
    if (path && path.length > 1) L.polyline(path, { color: '#ff5a1f', weight: 4, opacity: 0.7 }).addTo(layer.current);
    for (const marker of markers) {
      const color = COLORS[marker.kind ?? 'point'];
      const circle = L.circleMarker([marker.lat, marker.lng], {
        radius: marker.kind?.startsWith('driver') ? 9 : 7,
        color: '#ffffff',
        weight: 2,
        fillColor: color,
        fillOpacity: 1,
      }).addTo(layer.current);
      if (marker.label) circle.bindTooltip(marker.label);
    }
    const points: [number, number][] = [...markers.map((m) => [m.lat, m.lng] as [number, number]), ...(path ?? [])];
    if (fit && points.length && !fitted.current) {
      map.current.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
      fitted.current = true;
    }
  };

  useEffect(draw, [markers, path]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={container} className={className} style={{ height, width: '100%', borderRadius: 12, zIndex: 0 }} role="img" aria-label="Mapa" />;
}

/** Carrega o Leaflet e cria o mapa base (tiles configuráveis) no contêiner. */
function useBaseMap(container: React.RefObject<HTMLDivElement | null>, onReady: () => void) {
  const map = useRef<Leaflet.Map | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const leaflet = useRef<typeof Leaflet | null>(null);
  useEffect(() => {
    let disposed = false;
    void import('leaflet').then((L) => {
      if (disposed || !container.current || map.current) return;
      leaflet.current = L;
      map.current = L.map(container.current, { zoomControl: true, attributionControl: true }).setView([-23.55, -46.63], 11);
      L.tileLayer(process.env.NEXT_PUBLIC_MAP_TILES_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? '&copy; OpenStreetMap',
      }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
      onReady();
    });
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { map, layer, leaflet };
}

export interface HeatCell {
  bounds: [[number, number], [number, number]];
  value: number;
}

/**
 * Mapa de calor em grade: cada célula é pintada numa escala de um tom (claro → escuro).
 * `fitKey` muda quando o recorte deve ser reenquadrado (ex.: troca de camada ou cidade).
 */
export function HeatMap({
  cells,
  max,
  format,
  fitKey,
  height = 480,
  onBoundsChange,
}: {
  cells: HeatCell[];
  max: number;
  format: (value: number) => string;
  fitKey: string;
  height?: number;
  /** Recorte visível (sul, oeste, norte, leste) após mover o mapa. */
  onBoundsChange?: (bbox: [number, number, number, number]) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const fitted = useRef<string | null>(null);
  const boundsListener = useRef(onBoundsChange);
  boundsListener.current = onBoundsChange;
  const { map, layer, leaflet } = useBaseMap(container, () => {
    draw();
    map.current?.on('moveend', () => {
      const b = map.current?.getBounds();
      if (b) boundsListener.current?.([b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]);
    });
  });

  const draw = () => {
    const L = leaflet.current;
    if (!L || !map.current || !layer.current) return;
    layer.current.clearLayers();
    for (const cell of cells) {
      const rectangle = L.rectangle(cell.bounds, {
        stroke: false,
        fillColor: HEAT_RAMP[heatStep(cell.value, max)],
        fillOpacity: 0.72,
      }).addTo(layer.current);
      // Conteúdo como texto (nunca HTML montado com dados).
      const tip = document.createElement('span');
      tip.textContent = format(cell.value);
      rectangle.bindTooltip(tip, { sticky: true });
    }
    if (cells.length && fitted.current !== fitKey) {
      const bounds = L.latLngBounds(cells.flatMap((cell) => cell.bounds));
      map.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
      fitted.current = fitKey;
    }
  };

  useEffect(draw, [cells, max, fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={container} style={{ height, width: '100%', borderRadius: 12, zIndex: 0 }} role="img" aria-label="Mapa de calor" />;
}
