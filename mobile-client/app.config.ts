import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * App do cliente. Variáveis públicas (EXPO_PUBLIC_*) são embutidas no bundle — nunca coloque segredos.
 * EAS_PROJECT_ID habilita o push (Expo Push Service) em builds de desenvolvimento/produção.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: process.env.APP_DISPLAY_NAME ?? 'LevoJá',
  slug: 'levoja-cliente',
  scheme: 'levoja',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: process.env.IOS_BUNDLE_ID ?? 'br.com.levoja.cliente',
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: process.env.ANDROID_PACKAGE ?? 'br.com.levoja.cliente',
    adaptiveIcon: {
      backgroundColor: '#FF5A1F',
      foregroundImage: './assets/adaptive-foreground.png',
      monochromeImage: './assets/adaptive-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-splash-screen', { backgroundColor: '#FF5A1F', image: './assets/splash-icon.png', imageWidth: 120 }],
    [
      'expo-location',
      { locationWhenInUsePermission: 'Usamos sua localização para mostrar lojas que entregam aí e preencher o endereço de entrega.' },
    ],
    ['expo-notifications', { icon: './assets/notification-icon.png', color: '#FF5A1F' }],
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
