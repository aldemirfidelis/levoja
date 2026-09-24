import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * App do entregador. Localização em segundo plano (serviço em primeiro plano no Android) apenas
 * enquanto o entregador está online — requer build de desenvolvimento/produção (não roda no Expo Go).
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: process.env.APP_DISPLAY_NAME ?? 'LevoJá Entregador',
  slug: 'levoja-entregador',
  scheme: 'levoja-entregador',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
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
      foregroundImage: './assets/adaptive-foreground.png',
      monochromeImage: './assets/adaptive-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-splash-screen', { backgroundColor: '#111827', image: './assets/splash-icon.png', imageWidth: 120 }],
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
    ['expo-notifications', { icon: './assets/notification-icon.png', color: '#FF5A1F' }],
  ],
  experiments: { typedRoutes: false, reactCompiler: true },
  extra: { eas: { projectId: process.env.EAS_PROJECT_ID } },
});
