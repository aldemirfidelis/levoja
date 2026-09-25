import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import type * as NotificationsModule from 'expo-notifications';
import { api } from './api';
import { kitConfig } from './config';

/**
 * O Expo Go para Android não tem push (desde o SDK 53) e o `expo-notifications` lança erro já ao ser
 * importado lá. Por isso o módulo só é carregado onde funciona (build de desenvolvimento/produção e iOS);
 * no Expo Go para Android os avisos continuam chegando pela lista de notificações do app (tempo real).
 */
export const pushSupported = !(Platform.OS === 'android' && isRunningInExpoGo());

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Notifications: typeof NotificationsModule | null = pushSupported ? require('expo-notifications') : null;

// Notificações com o app aberto também aparecem (banner + lista).
Notifications?.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export interface PushChannel {
  id: string;
  name: string;
  importance?: 'DEFAULT' | 'HIGH' | 'MAX';
  vibrationPattern?: number[];
}

const storageKey = () => `levoja.push.${kitConfig().app.toLowerCase()}`;

export type PushRegistration = { token: string } | { skipped: 'expo-go' | 'simulator' | 'denied' | 'no-project' | 'error'; detail?: string };

/**
 * Registra o aparelho para push (Expo Push Service). Requer build de desenvolvimento/produção
 * com EAS projectId; no Expo Go (Android), no simulador ou sem permissão, apenas informa o motivo.
 */
export async function registerPushToken(channels: PushChannel[] = []): Promise<PushRegistration> {
  if (!Notifications) return { skipped: 'expo-go' };
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Avisos', importance: Notifications.AndroidImportance.HIGH });
      for (const channel of channels) {
        await Notifications.setNotificationChannelAsync(channel.id, {
          name: channel.name,
          importance: Notifications.AndroidImportance[channel.importance ?? 'MAX'],
          vibrationPattern: channel.vibrationPattern ?? [0, 400, 200, 400],
          sound: 'default',
        });
      }
    }
    if (!Device.isDevice) return { skipped: 'simulator' };
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return { skipped: 'denied' };
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return { skipped: 'no-project' };
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.post('me/devices', { token, platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID', app: kitConfig().app });
    await AsyncStorage.setItem(storageKey(), token);
    return { token };
  } catch (error) {
    return { skipped: 'error', detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Remove o aparelho do usuário atual (logout): o próximo usuário não recebe pushes do anterior. */
export async function unregisterPushToken(): Promise<void> {
  const token = await AsyncStorage.getItem(storageKey()).catch(() => null);
  if (!token) return;
  await api.delete(`me/devices/${encodeURIComponent(token)}`).catch(() => undefined);
  await AsyncStorage.removeItem(storageKey()).catch(() => undefined);
}

/** Última notificação tocada (o suporte a push não muda durante a execução, então a ordem dos hooks é estável). */
const useLastResponse: () => NotificationsModule.NotificationResponse | null | undefined = Notifications ? Notifications.useLastNotificationResponse : () => null;

/** Toque em uma notificação (inclusive com o app fechado) → navegação. */
export function useNotificationTaps(onTap: (data: Record<string, unknown>) => void) {
  const handled = useRef(new Set<string>());
  const last = useLastResponse();
  const ref = useRef(onTap);
  ref.current = onTap;
  useEffect(() => {
    if (!last) return;
    const id = last.notification.request.identifier;
    if (handled.current.has(id)) return;
    handled.current.add(id);
    ref.current((last.notification.request.content.data ?? {}) as Record<string, unknown>);
  }, [last]);
}

/** Notificação recebida com o app aberto (ex.: atualizar listas). */
export function useNotificationReceived(onReceive: (data: Record<string, unknown>) => void) {
  const ref = useRef(onReceive);
  ref.current = onReceive;
  useEffect(() => {
    if (!Notifications) return;
    const subscription = Notifications.addNotificationReceivedListener((notification) => ref.current((notification.request.content.data ?? {}) as Record<string, unknown>));
    return () => subscription.remove();
  }, []);
}
