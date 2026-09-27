'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import type * as Leaflet from 'leaflet';

export interface LatLngValue {
  lat: number;
  lng: number;
}

const BRAZIL: [number, number] = [-14.235, -51.925];

/** Marcador em forma de pino, na cor da marca (divIcon: o ícone padrão do Leaflet quebra no bundler). */
function pinIcon(L: typeof Leaflet) {
  return L.divIcon({
    className: '',
    iconSize: [30, 42],
    iconAnchor: [15, 40],
    html: `<svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))"><path d="M15 1C7.3 1 1 7.2 1 14.9 1 25.3 15 41 15 41s14-15.7 14-26.1C29 7.2 22.7 1 15 1Z" fill="var(--color-brand-500,#FF5A1A)" stroke="#fff" stroke-width="2"/><circle cx="15" cy="15" r="5" fill="#fff"/></svg>`,
  });
}

/**
 * Mapa para marcar a localização de um endereço: clique no mapa ou arraste o marcador.
 * `zoom` é o nível usado ao centralizar em um novo valor (ex.: 17 para o endereço exato, 14 para a cidade).
 */
export default function LocationPicker({
  value,
  onChange,
  zoom = 17,
  height = 280,
}: {
  value: LatLngValue | null;
  onChange: (point: LatLngValue) => void;
  zoom?: number;
  height?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const marker = useRef<Leaflet.Marker | null>(null);
  const leaflet = useRef<typeof Leaflet | null>(null);
  const changeRef = useRef(onChange);
  const initial = useRef({ value, zoom });

  useEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);

  const place = (point: LatLngValue) => {
    const L = leaflet.current;
    if (!L || !map.current) return;
    if (marker.current) {
      marker.current.setLatLng([point.lat, point.lng]);
      return;
    }
    marker.current = L.marker([point.lat, point.lng], { draggable: true, icon: pinIcon(L), title: 'Localização (arraste para ajustar)' }).addTo(map.current);
    marker.current.on('dragend', () => {
      const position = marker.current!.getLatLng();
      changeRef.current({ lat: position.lat, lng: position.lng });
    });
  };

  useEffect(() => {
    let disposed = false;
    void import('leaflet').then((L) => {
      if (disposed || !container.current || map.current) return;
      leaflet.current = L;
      const start = initial.current;
      map.current = L.map(container.current, { zoomControl: true, attributionControl: true }).setView(
        start.value ? [start.value.lat, start.value.lng] : BRAZIL,
        start.value ? start.zoom : 4,
      );
      L.tileLayer(process.env.NEXT_PUBLIC_MAP_TILES_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? '&copy; OpenStreetMap',
      }).addTo(map.current);
      map.current.on('click', (event: Leaflet.LeafletMouseEvent) => {
        place({ lat: event.latlng.lat, lng: event.latlng.lng });
        changeRef.current({ lat: event.latlng.lat, lng: event.latlng.lng });
      });
      if (start.value) place(start.value);
    });
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  // Novo valor vindo de fora (busca pelo endereço, localização do aparelho): move o marcador e,
  // se ele estiver fora da área visível, centraliza.
  useEffect(() => {
    if (!value || !map.current) return;
    place(value);
    if (!map.current.getBounds().contains([value.lat, value.lng]) || map.current.getZoom() < 12) {
      map.current.setView([value.lat, value.lng], zoom);
    }
  }, [value?.lat, value?.lng, zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={container} style={{ height }} className="w-full overflow-hidden rounded-xl border border-border" role="application" aria-label="Mapa: clique ou arraste o marcador para ajustar a localização" />;
}
