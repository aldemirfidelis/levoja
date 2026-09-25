import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * App do entregador. Localização em segundo plano (serviço em primeiro plano no Android) apenas
 * enquanto o entregador está online — requer build de desenvolvimento/produção (não roda no Expo Go).
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
  name: process.env.APP_DISPLAY_NAME ?? 'LevoJá Entregador',
  slug: process.env.APP_SLUG ?? 'levoja-entregador',
  scheme: process.env.APP_SCHEME ?? 'levoja-entregador',
  version: '0.1.0',
  orientation: 'portrait',
  icon: `${ASSETS}/icon.png`,
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: process.env.IOS_BUNDLE_ID ?? 'br.com.levoja.entregador',
    supportsTablet: false,
    infoPlist: { UIBackgroundModes: ['location', 'remote-notification'] },
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: process.env.ANDROID_PACKAGE ?? 'br.com.levoja.entregador',
    adaptiveIcon: {
      backgroundColor: '#111827',
      foregroundImage: `${ASSETS}/adaptive-foreground.png`,
      monochromeImage: `${ASSETS}/adaptive-monochrome.png`,
    },
    predictiveBackGestureEnabled: false,
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-splash-screen', { backgroundColor: '#111827', image: `${ASSETS}/splash-icon.png`, imageWidth: 120 }],
    [
      'expo-location',
      {
        locationWhenInUsePermission: 'Sua localização é usada para oferecer entregas próximas e acompanhar a rota enquanto você está online.',
        locationAlwaysAndWhenInUsePermission:
          'Enquanto você estiver online ou com uma entrega em andamento, a localização continua sendo enviada com o app em segundo plano, para ofertas e acompanhamento do cliente.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    ['expo-camera', { cameraPermission: 'A câmera é usada para ler o QR Code do cliente, fotografar a entrega e enviar seus documentos.', recordAudioAndroid: false, barcodeScannerEnabled: true }],
    ['expo-image-picker', { photosPermission: 'Permita o acesso às fotos para enviar seus documentos.', cameraPermission: 'Permita o uso da câmera para fotografar seus documentos.', microphonePermission: false }],
    ['expo-notifications', { icon: `${ASSETS}/notification-icon.png`, color: BRAND_COLOR }],
  ],
  experiments: { typedRoutes: false, reactCompiler: true },
  extra: { eas: { projectId: process.env.EAS_PROJECT_ID } },
});
