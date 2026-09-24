'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from './api';

/**
 * Conexão em tempo real com a API (Socket.IO, namespace /realtime).
 * O navegador não possui os tokens de sessão (cookies httpOnly): antes de cada conexão
 * pede ao BFF um ticket de 60 s, válido apenas para o handshake do socket.
 */
export function useRealtime(handlers: Record<string, (payload: any) => void>, enabled = true) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const url = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';
    let socket: Socket | null = null;
    let cancelled = false;

    socket = io(`${url}/realtime`, {
      transports: ['websocket'],
      reconnectionDelayMax: 10_000,
      // Função: um novo ticket a cada (re)conexão.
      auth: (callback) => {
        api
          .post<{ ticket: string }>('realtime/ticket')
          .then(({ ticket }) => callback({ token: ticket }))
          .catch(() => callback({}));
      },
    });
    socket.on('ready', () => !cancelled && setConnected(true));
    socket.on('disconnect', () => !cancelled && setConnected(false));
    socket.onAny((event: string, payload: unknown) => handlersRef.current[event]?.(payload));

    return () => {
      cancelled = true;
      socket?.disconnect();
    };
  }, [enabled]);

  return { connected };
}
