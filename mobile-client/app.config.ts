import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * App do cliente. Variáveis públicas (EXPO_PUBLIC_*) são embutidas no bundle — nunca coloque segredos.
 * EAS_PROJECT_ID habilita o push (Expo Push Service) em builds de desenvolvimento/produção.
 */
/**
 * White label: cada marca gera seu próprio app com APP_DISPLAY_NAME, APP_SLUG, APP_SCHEME,
 * IOS_BUNDLE_ID, ANDROID_PACKAGE, APP_BRAND_COLOR (#RRGGBB), APP_ASSETS_DIR (ícones e splash da
 * marca) e EXPO_PUBLIC_TENANT/EXPO_PUBLIC_BRAND_COLOR (tenant e cor usados pelo app em execução).
 */
const BRAND_COLOR = process.env.APP_BRAND_COLOR ?? process.env.EXPO_PUBLIC_BRAND_COLOR ?? '#FF5A1F';
const ASSETS = (process.env.APP_ASSETS_DIR ?? './assets').replace(/\/+$/, '');

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: process.env.APP_DISPLAY_NAME ?? 'LevoJá',
  slug: process.env.APP_SLUG ?? 'levoja-cliente',
  scheme: process.env.APP_SCHEME ?? 'levoja',
  version: '0.1.0',
  orientation: 'portrait',
  icon: `${ASSETS}/icon.png`,
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: process.env.IOS_BUNDLE_ID ?? 'br.com.levoja.cliente',
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: process.env.ANDROID_PACKAGE ?? 'br.com.levoja.cliente',
    adaptiveIcon: {
      backgroundColor: BRAND_COLOR,
      foregroundImage: `${ASSETS}/adaptive-foreground.png`,
      monochromeImage: `${ASSETS}/adaptive-monochrome.png`,
    },
    predictiveBackGestureEnabled: false,
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-splash-screen', { backgroundColor: BRAND_COLOR, image: `${ASSETS}/splash-icon.png`, imageWidth: 120 }],
    [
      'expo-location',
      { locationWhenInUsePermission: 'Usamos sua localização para mostrar lojas que entregam aí e preencher o endereço de entrega.' },
    ],
    ['expo-notifications', { icon: `${ASSETS}/notification-icon.png`, color: BRAND_COLOR }],
    [
      'expo-image-picker',
      {
        photosPermission: 'Permita o acesso às fotos para enviar receitas e sua foto de perfil.',
        cameraPermission: 'Permita o uso da câmera para fotografar receitas.',
        microphonePermission: false,
      },
    ],
  ],
  experiments: { typedRoutes: false, reactCompiler: true },
  extra: { eas: { projectId: process.env.EAS_PROJECT_ID } },
});
