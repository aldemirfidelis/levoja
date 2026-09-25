import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import {
  AuthProvider,
  ErrorView,
  themeColors,
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
import { DriverProvider } from '@/lib/driver';
import { stopTracking } from '@/lib/location';
import { outbox } from '@/lib/outbox';
import { openFromNotification } from '@/lib/navigation';

void SplashScreen.preventAutoHideAsync();

const OFFER_CHANNEL = [{ id: 'offers', name: 'Ofertas de entrega', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 500, 250, 500, 250, 500] }];

export default function RootLayout() {
  return (
    <QueryProvider>
      <ToastProvider>
        <AuthProvider
          onSignedIn={() => void registerPushToken(OFFER_CHANNEL)}
          onBeforeLogout={async () => {
            await outbox.flush().catch(() => undefined);
            await stopTracking();
            await unregisterPushToken();
          }}
        >
          <Root />
        </AuthProvider>
      </ToastProvider>
    </QueryProvider>
  );
}

function LiveUpdates() {
  const invalidate = useInvalidate();
  const { reload } = useAuth();
  useRealtimeEvent<{ type: string }>('notification', (notification) => {
    void invalidate('me/notifications', 'drivers/me');
    // Aprovação/suspensão do cadastro muda as telas disponíveis.
    if (notification.type.startsWith('driver.status')) void reload().catch(() => undefined);
  });
  useNotificationTaps((data) => openFromNotification(data));
  return null;
}

function Root() {
  const { status, me, retry } = useAuth();
  const scheme = useColorScheme();
  const colors = themeColors(scheme === 'dark');
  const signedIn = status === 'signedIn';
  const driver = me?.driver ?? null;
  const approved = signedIn && driver?.status === 'APPROVED';

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

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, primary: colors.brand, background: colors.bg, card: colors.surface, text: colors.fg, border: colors.border } };
  const stack = (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal', headerTintColor: colors.brand, headerTitleStyle: { color: colors.fg }, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={approved}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="entrega/[id]" options={{ title: 'Entrega' }} />
        <Stack.Screen name="comprovante/[id]" options={{ title: 'Concluir entrega', presentation: 'modal' }} />
        <Stack.Screen name="conversa/[id]" options={{ title: 'Conversa' }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !driver}>
        <Stack.Screen name="ser-entregador" options={{ title: 'Seja entregador' }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !!driver && !approved}>
        <Stack.Screen name="cadastro/index" options={{ title: 'Seu cadastro' }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !!driver}>
        <Stack.Screen name="cadastro/documentos" options={{ title: 'Documentos' }} />
        <Stack.Screen name="cadastro/veiculo" options={{ title: 'Veículo' }} />
        <Stack.Screen name="cadastro/dados" options={{ title: 'Dados pessoais' }} />
        <Stack.Screen name="conta/dados-bancarios" options={{ title: 'Chave PIX' }} />
        <Stack.Screen name="ajuda/index" options={{ title: 'Meus chamados' }} />
        <Stack.Screen name="ajuda/novo" options={{ title: 'Novo chamado', presentation: 'modal' }} />
        <Stack.Screen name="ajuda/[id]" options={{ title: 'Chamado' }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="conta/perfil" options={{ title: 'Meus dados' }} />
        <Stack.Screen name="conta/seguranca" options={{ title: 'Segurança' }} />
        <Stack.Screen name="conta/notificacoes" options={{ title: 'Notificações' }} />
        <Stack.Screen name="conta/privacidade" options={{ title: 'Privacidade' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );

  return (
    <ThemeProvider value={theme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <RealtimeProvider enabled={signedIn}>
        {signedIn ? <LiveUpdates /> : null}
        <OfflineBanner message="Sem internet. Suas ações e o GPS ficam salvos e são enviados quando a conexão voltar." />
        {approved ? <DriverProvider>{stack}</DriverProvider> : stack}
      </RealtimeProvider>
    </ThemeProvider>
  );
}
