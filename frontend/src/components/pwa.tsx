'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useRealtime } from '@levoja/web-kit/client';
import { Button, useBrand } from '@levoja/web-kit/ui';

/** O service worker roda no build de produção (no `next dev` os arquivos mudam a cada edição). */
const PWA_ENABLED = process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_PWA_DEV === 'true';
const DISMISS_KEY = 'lj_pwa_install_dismissed';
const DISMISS_DAYS = 30;

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

/** Registra o service worker e oferece a instalação do app (quando o navegador permite). */
export function PwaSupport() {
  const brand = useBrand();
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    if (!PWA_ENABLED || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      if (!dismissedRecently()) setPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!prompt) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Armazenamento indisponível (aba anônima): só esconde agora.
    }
    setPrompt(null);
  };

  return (
    <div className="fixed inset-x-4 bottom-4 z-40 flex items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-lg sm:left-4 sm:right-auto sm:max-w-sm" role="dialog" aria-label="Instalar aplicativo">
      <Download className="h-6 w-6 shrink-0 text-brand-500" aria-hidden />
      <p className="flex-1 text-sm text-fg">Instale o {brand.appName} para abrir mais rápido, direto da tela inicial.</p>
      <Button
        size="sm"
        onClick={async () => {
          await prompt.prompt();
          await prompt.userChoice.catch(() => undefined);
          setPrompt(null);
        }}
      >
        Instalar
      </Button>
      <button type="button" onClick={dismiss} className="rounded p-1 text-muted hover:text-fg" aria-label="Agora não">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

type Permission = NotificationPermission | 'unsupported';

/** Permissão de notificações do navegador (usada para avisar com a aba em segundo plano). */
export function useBrowserNotifications() {
  const [permission, setPermission] = useState<Permission>('unsupported');
  useEffect(() => {
    if ('Notification' in window) setPermission(Notification.permission);
  }, []);
  const request = async () => {
    if (!('Notification' in window)) return 'unsupported' as const;
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  };
  return { permission, request };
}

interface RealtimeNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
}

/** Destino ao clicar numa notificação do navegador. */
function targetUrl(notification: RealtimeNotification): string {
  const data = notification.data ?? {};
  if (typeof data.deliveryId === 'string' && notification.type.startsWith('delivery')) return `/entregas/${data.deliveryId}`;
  if (typeof data.companyId === 'string' && notification.type.startsWith('fleet')) return `/empresa/${data.companyId}/frota`;
  if (typeof data.referralId === 'string') return '/conta?aba=indique';
  return '/conta?aba=notificacoes';
}

/**
 * Notificações em tempo real no portal: atualiza o sino na hora e, com a aba em segundo plano
 * e permissão concedida, mostra a notificação do sistema (via service worker quando disponível).
 */
export function PortalNotifications() {
  const client = useQueryClient();
  useRealtime({
    notification: (payload: RealtimeNotification) => {
      void client.invalidateQueries({ predicate: (query) => typeof query.queryKey[0] === 'string' && (query.queryKey[0] as string).startsWith('me/notifications') });
      if (document.visibilityState === 'visible' || !('Notification' in window) || Notification.permission !== 'granted') return;
      const options: NotificationOptions = { body: payload.body, icon: '/pwa-icon/192', tag: payload.id, data: { url: targetUrl(payload) } };
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        void navigator.serviceWorker.ready.then((registration) => registration.showNotification(payload.title, options)).catch(() => undefined);
      } else {
        const shown = new Notification(payload.title, options);
        shown.onclick = () => {
          window.focus();
          window.location.href = targetUrl(payload);
        };
      }
    },
  });
  return null;
}
