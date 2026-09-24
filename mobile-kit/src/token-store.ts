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
