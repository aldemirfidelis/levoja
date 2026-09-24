import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { Icon, useColors, type IconName } from '@levoja/mobile-kit';

const tab = (icon: IconName) => ({ color }: { color: ColorValue }) => <Icon name={icon} size={24} color={String(color)} />;

export default function TabsLayout() {
  const colors = useColors();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.fg },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Início', headerShown: false, tabBarIcon: tab('home') }} />
      <Tabs.Screen name="enviar" options={{ title: 'Enviar', tabBarIcon: tab('send') }} />
      <Tabs.Screen name="pedidos" options={{ title: 'Pedidos', tabBarIcon: tab('receipt') }} />
      <Tabs.Screen name="conta" options={{ title: 'Conta', tabBarIcon: tab('account') }} />
    </Tabs>
  );
}
