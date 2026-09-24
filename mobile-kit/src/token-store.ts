import * as SecureStore from 'expo-secure-store';
import { kitConfig } from './config';

/**
 * Sessão persistida: somente o refresh token fica no armazenamento seguro do sistema
 * (Keychain/Keystore). O access token (15 min) vive apenas em memória.
 */
const key = () => `levoja.session.${kitConfig().app.toLowerCase()}`;

export const tokenStore = {
  async getRefreshToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key());
    } catch {
      return null;
    }
  },
  async setRefreshToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(key(), token, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(key()).catch(() => undefined);
  },
};

/**
 * Id de instalação do app (sinal antifraude: várias contas no mesmo aparelho). Não identifica a
 * pessoa nem autentica nada; some ao desinstalar o app. Não é segredo, então Math.random basta.
 */
let deviceId: string | null = null;
const DEVICE_KEY = 'levoja.device';

export async function getDeviceId(): Promise<string> {
  if (deviceId) return deviceId;
  try {
    const stored = await SecureStore.getItemAsync(DEVICE_KEY);
    if (stored && /^[A-Za-z0-9_-]{16,128}$/.test(stored)) return (deviceId = stored);
  } catch {
    // Armazenamento indisponível: gera um id só para esta sessão.
  }
  const random = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  deviceId = `${Date.now().toString(16)}${random}`;
  await SecureStore.setItemAsync(DEVICE_KEY, deviceId, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }).catch(() => undefined);
  return deviceId;
}
