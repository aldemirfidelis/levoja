import { Stack } from 'expo-router';
import { useColors } from '@levoja/mobile-kit';

export default function AuthLayout() {
  const colors = useColors();
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal', headerTintColor: colors.brand, headerTitleStyle: { color: colors.fg }, headerShadowVisible: false, headerStyle: { backgroundColor: colors.bg }, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="entrar" options={{ headerShown: false }} />
      <Stack.Screen name="cadastro" options={{ title: 'Cadastro de entregador' }} />
      <Stack.Screen name="esqueci-senha" options={{ title: '' }} />
    </Stack>
  );
}
