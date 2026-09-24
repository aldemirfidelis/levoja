'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ApiError } from '../client/api';
import { Button, cn } from './primitives';

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

type ToastTone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const push = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = ++counter.current;
    setToasts((current) => [...current.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 5000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:items-end" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={cn(
              'pointer-events-auto w-full max-w-sm rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg',
              toast.tone === 'success' && 'bg-success',
              toast.tone === 'error' && 'bg-danger',
              toast.tone === 'info' && 'bg-info',
            )}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  return {
    success: (message: string) => push(message, 'success'),
    info: (message: string) => push(message, 'info'),
    error: (error: unknown) => push(errorMessage(error), 'error'),
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.messages.join(' ');
  if (error instanceof Error) return error.message;
  return 'Ocorreu um erro inesperado.';
}

// ---------------------------------------------------------------------------
// Estados de carregamento, vazio e erro
// ---------------------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('lj-skeleton rounded-md', className ?? 'h-4 w-full')} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center">
      {icon && <div className="mb-1 text-muted">{icon}</div>}
      <p className="font-semibold text-fg">{title}</p>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-xl border border-danger/30 bg-danger/5 px-6 py-10 text-center">
      <p className="font-semibold text-danger">Não foi possível carregar</p>
      <p className="max-w-md text-sm text-muted">{errorMessage(error)}</p>
      {requestId && <p className="text-xs text-muted">Código de suporte: {requestId}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

/** Alterna entre claro, escuro e o padrão do sistema (preferência salva no navegador). */
export function useTheme() {
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>('system');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('lj-theme') as 'light' | 'dark' | null;
      if (saved) setThemeState(saved);
    } catch {
      /* armazenamento indisponível */
    }
  }, []);
  const setTheme = (next: 'light' | 'dark' | 'system') => {
    setThemeState(next);
    const root = document.documentElement;
    if (next === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', next);
    try {
      if (next === 'system') localStorage.removeItem('lj-theme');
      else localStorage.setItem('lj-theme', next);
    } catch {
      /* armazenamento indisponível */
    }
  };
  return { theme, setTheme };
}

