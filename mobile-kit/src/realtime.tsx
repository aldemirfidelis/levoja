import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { session } from './api';
import { kitConfig } from './config';

const RealtimeContext = createContext<{ socket: Socket | null; connected: boolean }>({ socket: null, connected: false });

/**
 * Canal em tempo real (Socket.IO, namespace /realtime) autenticado com o access token.
 * Reconecta sozinho; se o token expirar, renova e tenta de novo.
 */
export function RealtimeProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const client = io(`${kitConfig().apiUrl}/realtime`, {
      transports: ['websocket'],
      auth: (callback) => {
        void session.ensure().then(() => callback({ token: session.getAccessToken() }));
      },
      reconnectionDelayMax: 10_000,
    });
    client.on('connect', () => setConnected(true));
    client.on('disconnect', () => setConnected(false));
    client.on('connect_error', async (error) => {
      // Token expirado/inválido: renova e reconecta (o `auth` acima pega o token novo).
      if (/token|jwt|auth/i.test(error.message) && (await session.refresh())) client.connect();
    });
    setSocket(client);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !client.connected) client.connect();
    });
    return () => {
      subscription.remove();
      client.removeAllListeners();
      client.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [enabled]);

  return <RealtimeContext.Provider value={{ socket, connected }}>{children}</RealtimeContext.Provider>;
}

export function useRealtimeStatus(): boolean {
  return useContext(RealtimeContext).connected;
}

/** Assina um evento do canal em tempo real enquanto o componente estiver montado. */
export function useRealtimeEvent<T = unknown>(event: string, handler: (payload: T) => void) {
  const { socket } = useContext(RealtimeContext);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return;
    const listener = (payload: T) => ref.current(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [socket, event]);
}
