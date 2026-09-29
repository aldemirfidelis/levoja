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
  /** Ícone no lugar do ponto (moto: entregador; loja: estabelecimento), pintado com `color`. */
  icon?: MapIcon;
  /** Cor do ícone (#RRGGBB). */
  color?: string;
}

export type MapIcon = 'motorbike' | 'store';

const COLORS: Record<NonNullable<MapMarker['kind']>, string> = {
  pickup: '#2563eb',
  dropoff: '#1FA36B',
  driver: '#FF5A1A',
  'driver-busy': '#d97706',
  point: '#6b7280',
  alert: '#d03b3b',
};

// Desenhos do Lucide (ISC): "motorbike" e "store", em grade 24×24.
const GLYPHS: Record<MapIcon, string> = {
  motorbike:
    '<path d="m18 14-1-3"/><path d="m3 9 6 2a2 2 0 0 1 2-2h2a2 2 0 0 1 1.99 1.81"/><path d="M8 17h3a1 1 0 0 0 1-1 6 6 0 0 1 6-6 1 1 0 0 0 1-1v-.75A5 5 0 0 0 17 5"/><circle cx="19" cy="17" r="3"/><circle cx="5" cy="17" r="3"/>',
  store:
    '<path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/><path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/>',
};

/** Traço do desenho: escuro sobre cores claras (ex.: amarelo), branco nas demais. */
function inkFor(hex: string): string {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.23 ? '#1f2937' : '#ffffff';
}

/** Entregador: círculo centrado na posição. Loja: marcador com ponta na posição. */
function iconHtml(icon: MapIcon, color: string): string {
  const ink = inkFor(color);
  const glyph = (x: number, y: number, scale: number) =>
    `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${ink}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[icon]}</g>`;
  const shadow = 'style="display:block;overflow:visible;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))"';
  if (icon === 'motorbike') {
    return `<svg width="32" height="32" viewBox="0 0 32 32" ${shadow}><circle cx="16" cy="16" r="14" fill="${color}" stroke="#fff" stroke-width="2"/>${glyph(6.5, 6.5, 0.79)}</svg>`;
  }
  return `<svg width="32" height="40" viewBox="0 0 32 40" ${shadow}><path d="M16 38 11 30H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4h20a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4h-5z" fill="${color}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>${glyph(7, 7, 0.75)}</svg>`;
}

const POINTS_PANE = 'lj-points';

/** Texto da dica como nó de texto (nunca HTML montado com dados: nomes vêm de usuários e empresas). */
function tooltipContent(label: string): HTMLElement {
  const tip = document.createElement('span');
  tip.textContent = label;
  return tip;
}

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
      // Pontos acima dos ícones: a coleta aguardando fica visível sobre a loja de onde sai.
      map.current.createPane(POINTS_PANE).style.zIndex = '620';
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
    if (path && path.length > 1) L.polyline(path, { color: '#FF5A1A', weight: 4, opacity: 0.7 }).addTo(layer.current);
    for (const marker of markers) {
      if (marker.icon) {
        const color = marker.color && /^#[0-9a-f]{6}$/i.test(marker.color) ? marker.color : COLORS.point;
        const moto = marker.icon === 'motorbike';
        const pin = L.marker([marker.lat, marker.lng], {
          icon: L.divIcon({
            html: iconHtml(marker.icon, color),
            className: 'lj-map-icon',
            iconSize: moto ? [32, 32] : [32, 40],
            iconAnchor: moto ? [16, 16] : [16, 38],
            tooltipAnchor: moto ? [0, -16] : [0, -36],
          }),
          // Entregadores por cima das lojas; fora da navegação por teclado (o mapa é uma imagem).
          zIndexOffset: moto ? 1000 : 0,
          keyboard: false,
        }).addTo(layer.current);
        if (marker.label) pin.bindTooltip(tooltipContent(marker.label), { direction: 'top' });
        continue;
      }
      const circle = L.circleMarker([marker.lat, marker.lng], {
        pane: POINTS_PANE,
        radius: marker.kind?.startsWith('driver') ? 9 : 7,
        color: '#ffffff',
        weight: 2,
        fillColor: COLORS[marker.kind ?? 'point'],
        fillOpacity: 1,
      }).addTo(layer.current);
      if (marker.label) circle.bindTooltip(tooltipContent(marker.label));
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
