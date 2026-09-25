import { configureKit } from '@levoja/mobile-kit';

/** Configuração do kit a partir das variáveis públicas do app (embutidas no build). */
configureKit({
  app: 'CUSTOMER',
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
  webUrl: process.env.EXPO_PUBLIC_WEB_URL ?? 'https://levoja.com.br',
  tenant: process.env.EXPO_PUBLIC_TENANT || undefined,
  brandColor: process.env.EXPO_PUBLIC_BRAND_COLOR || undefined,
  mapTilesUrl: process.env.EXPO_PUBLIC_MAP_TILES_URL || undefined,
  mapAttribution: process.env.EXPO_PUBLIC_MAP_ATTRIBUTION || undefined,
});
