import '@/lib/env';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import {
  AuthProvider,
  darkColors,
  ErrorView,
  lightColors,
  OfflineBanner,
  QueryProvider,
  RealtimeProvider,
  registerPushToken,
  Screen,
  ToastProvider,
  unregisterPushToken,
  useAuth,
  useInvalidate,
  useNotificationTaps,
  useRealtimeEvent,
} from '@levoja/mobile-kit';
import { AddressProvider } from '@/lib/address';
import { openFromNotification } from '@/lib/navigation';

void SplashScreen.preventAutoHideAsync();

/** Canais do Android: promoções ficam num canal próprio (o cliente pode silenciá-lo no sistema). */
const PUSH_CHANNELS = [{ id: 'promotions', name: 'Promoções', importance: Notifications.AndroidImportance.DEFAULT }];

export default function RootLayout() {
  return (
    <QueryProvider>
      <ToastProvider>
        <AuthProvider onSignedIn={() => void registerPushToken(PUSH_CHANNELS)} onBeforeLogout={unregisterPushToken}>
          <Root />
        </AuthProvider>
      </ToastProvider>
    </QueryProvider>
  );
}

/** Atualiza as telas abertas quando pedidos/entregas mudam (tempo real) e abre a tela certa ao tocar no push. */
function LiveUpdates() {
  const invalidate = useInvalidate();
  useRealtimeEvent('order.updated', () => void invalidate('orders'));
  useRealtimeEvent('delivery.updated', () => void invalidate('deliveries', 'orders'));
  useRealtimeEvent('notification', () => void invalidate('me/notifications'));
  useNotificationTaps(openFromNotification);
  return null;
}

function Root() {
  const { status, retry } = useAuth();
  const scheme = useColorScheme();
  const colors = scheme === 'dark' ? darkColors : lightColors;
  const signedIn = status === 'signedIn';

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync();
  }, [status]);

  if (status === 'loading') return null;
  if (status === 'unavailable') {
    return (
      <Screen scroll={false}>
        <ErrorView error={new Error('Não foi possível conectar. Verifique sua internet.')} onRetry={retry} />
      </Screen>
    );
  }

  const navigationTheme = {
    ...(scheme === 'dark' ? DarkTheme : DefaultTheme),
    colors: { ...(scheme === 'dark' ? DarkTheme : DefaultTheme).colors, primary: colors.brand, background: colors.bg, card: colors.surface, text: colors.fg, border: colors.border },
  };

  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <RealtimeProvider enabled={signedIn}>
        {signedIn ? <LiveUpdates /> : null}
        <OfflineBanner message="Sem internet. Mostrando os últimos dados carregados." />
        <AddressGate signedIn={signedIn}>
          <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal', headerTintColor: colors.brand, headerTitleStyle: { color: colors.fg }, contentStyle: { backgroundColor: colors.bg } }}>
            <Stack.Protected guard={signedIn}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="loja/[id]" options={{ title: '' }} />
              <Stack.Screen name="sacola/[companyId]" options={{ title: 'Sacola' }} />
              <Stack.Screen name="pedido/[id]" options={{ title: 'Pedido' }} />
              <Stack.Screen name="entrega/[id]" options={{ title: 'Entrega' }} />
              <Stack.Screen name="enderecos/index" options={{ title: 'Endereços' }} />
              <Stack.Screen name="enderecos/editar" options={{ title: 'Endereço', presentation: 'modal' }} />
              <Stack.Screen name="conta/perfil" options={{ title: 'Meus dados' }} />
              <Stack.Screen name="conta/seguranca" options={{ title: 'Segurança' }} />
              <Stack.Screen name="conta/notificacoes" options={{ title: 'Notificações' }} />
              <Stack.Screen name="conta/privacidade" options={{ title: 'Privacidade' }} />
              <Stack.Screen name="conta/creditos" options={{ title: 'Créditos' }} />
              <Stack.Screen name="conversa/[id]" options={{ title: 'Conversa' }} />
              <Stack.Screen name="ajuda/index" options={{ title: 'Meus chamados' }} />
              <Stack.Screen name="ajuda/novo" options={{ title: 'Novo chamado', presentation: 'modal' }} />
              <Stack.Screen name="ajuda/[id]" options={{ title: 'Chamado' }} />
            </Stack.Protected>
            <Stack.Protected guard={!signedIn}>
              <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            </Stack.Protected>
          </Stack>
        </AddressGate>
      </RealtimeProvider>
    </ThemeProvider>
  );
}

function AddressGate({ signedIn, children }: { signedIn: boolean; children: React.ReactNode }) {
  return signedIn ? <AddressProvider>{children}</AddressProvider> : <>{children}</>;
}
