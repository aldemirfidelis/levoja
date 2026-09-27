'use client';

import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BellRing } from 'lucide-react';
import { ApiError, Paginated, useApi, useRealtime } from '@levoja/web-kit/client';
import { cn, useToast } from '@levoja/web-kit/ui';
import type { CompanyOrderView } from '@/components/order-types';
import { orderChimeAllowed, playOrderChime, unlockOrderChime } from '@/lib/order-chime';

const SOUND_KEY = 'lj_order_sound';
/** Enquanto houver pedido novo sem confirmação, o toque se repete neste intervalo. */
const REPEAT_MS = 20_000;
const TITLE_PREFIX = /^(?:\(\d+\) |🔔 Novo pedido! · )/;

interface OrderAlertsValue {
  enabled: boolean;
  orders: CompanyOrderView[];
  isLoading: boolean;
  error: ApiError | null;
  refetch: () => Promise<unknown>;
  connected: boolean;
  /** Pedidos com status NEW (aguardando a loja confirmar). */
  pending: CompanyOrderView[];
  sound: boolean;
  setSound: (on: boolean) => void;
  /** O navegador já liberou o áudio (exige um clique na página). */
  audioReady: boolean;
  testSound: () => void;
}

const OrderAlertsContext = createContext<OrderAlertsValue | null>(null);

export function useOrderAlerts() {
  const value = useContext(OrderAlertsContext);
  if (!value) throw new Error('useOrderAlerts fora de OrderAlertsProvider');
  return value;
}

function readSoundPreference(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

/**
 * Pedidos em andamento da empresa + alertas de pedido novo (som, aviso e título da aba).
 * Fica no layout da empresa: o alerta toca em qualquer página do portal, não só no quadro.
 * Pedido novo = apareceu um pedido com status NEW que ainda não tínhamos visto, seja pelo
 * evento em tempo real (inclusive AWAITING_PAYMENT → NEW, que chega como `order.updated`)
 * ou pela atualização periódica da lista (rede de segurança se o tempo real cair).
 */
export function OrderAlertsProvider({ companyId, enabled, children }: { companyId: string; enabled: boolean; children: ReactNode }) {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const refetchRef = useRef<() => unknown>(() => undefined);
  const seen = useRef(new Set<string>());
  const primed = useRef(false);
  const lastRing = useRef(0);
  const [sound, setSoundState] = useState(true);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const [audioReady, setAudioReady] = useState(true);

  const ring = () => {
    lastRing.current = Date.now();
    playOrderChime();
  };
  const announce = (numbers: number[]) => {
    if (soundRef.current) ring();
    toastRef.current.info(numbers.length === 1 ? `Novo pedido #${numbers[0]}! Confirme para iniciar o preparo.` : `${numbers.length} pedidos novos! Confirme para iniciar o preparo.`);
  };

  const onOrderEvent = (payload: { orderId?: string; number?: number; status?: string }) => {
    if (payload?.status === 'NEW' && payload.orderId && !seen.current.has(payload.orderId)) {
      seen.current.add(payload.orderId);
      announce([payload.number ?? 0]);
    }
    void refetchRef.current();
  };
  const { connected } = useRealtime(
    {
      'order.new': onOrderEvent,
      'order.updated': onOrderEvent,
      'delivery.updated': () => void refetchRef.current(),
    },
    enabled,
  );

  const query = useApi<Paginated<CompanyOrderView>>(
    enabled ? `companies/${companyId}/orders` : null,
    { scope: 'active', pageSize: 100 },
    // Sem tempo real a lista é consultada com mais frequência; continua mesmo com a aba em segundo plano.
    { refetchInterval: connected ? 60_000 : 15_000, refetchIntervalInBackground: true },
  );
  refetchRef.current = query.refetch;
  const orders = useMemo(() => query.data?.data ?? [], [query.data]);
  const pending = useMemo(() => orders.filter((order) => order.status === 'NEW').sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [orders]);

  // Pedidos novos que chegaram pela lista (a primeira carga só registra o que já existia).
  useEffect(() => {
    if (!query.data) return;
    const arrived = pending.filter((order) => !seen.current.has(order.id));
    arrived.forEach((order) => seen.current.add(order.id));
    if (primed.current && arrived.length) announce(arrived.map((order) => order.number));
    primed.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, pending]);

  // Repete o toque até a loja confirmar (ou recusar) todos os pedidos novos.
  useEffect(() => {
    if (!enabled || !sound || pending.length === 0) return;
    const timer = setInterval(() => Date.now() - lastRing.current >= REPEAT_MS && ring(), 5_000);
    return () => clearInterval(timer);
  }, [enabled, sound, pending.length]);

  // Título da aba: "(2) LevoJá" e, com a aba em segundo plano, piscando "🔔 Novo pedido!".
  useEffect(() => {
    if (!pending.length) return;
    let flash = false;
    const tick = () => {
      const base = document.title.replace(TITLE_PREFIX, '');
      flash = !flash;
      document.title = document.hidden && flash ? `🔔 Novo pedido! · ${base}` : `(${pending.length}) ${base}`;
    };
    tick();
    const timer = setInterval(tick, 1_200);
    return () => {
      clearInterval(timer);
      document.title = document.title.replace(TITLE_PREFIX, '');
    };
  }, [pending.length]);

  // Preferência de som e liberação do áudio no primeiro clique/tecla.
  useEffect(() => {
    setSoundState(readSoundPreference());
    setAudioReady(orderChimeAllowed());
    const unlock = () => {
      unlockOrderChime();
      setAudioReady(true);
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', unlock, { capture: true });
      window.removeEventListener('keydown', unlock, { capture: true });
    };
  }, []);

  const setSound = (on: boolean) => {
    setSoundState(on);
    try {
      localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
    } catch {
      // Armazenamento indisponível (aba anônima): vale só nesta visita.
    }
    if (on) ring();
  };

  const value: OrderAlertsValue = {
    enabled,
    orders,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    connected,
    pending,
    sound,
    setSound,
    audioReady,
    testSound: ring,
  };
  return <OrderAlertsContext.Provider value={value}>{children}</OrderAlertsContext.Provider>;
}

/** Contador de pedidos novos no item "Pedidos" do menu. */
export function PendingOrdersBadge() {
  const { pending } = useOrderAlerts();
  if (!pending.length) return null;
  return (
    <span className="ml-auto flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-success px-1.5 text-[11px] font-black text-white" aria-label={`${pending.length} pedido(s) novo(s)`}>
      {pending.length}
    </span>
  );
}

/** Aviso nas outras páginas da empresa enquanto houver pedido esperando confirmação. */
export function PendingOrdersBanner({ href, className }: { href: string; className?: string }) {
  const { pending } = useOrderAlerts();
  if (!pending.length) return null;
  return (
    <Link href={href} className={cn('lj-new-order flex items-center gap-3 rounded-xl bg-success/10 px-4 py-3 text-sm text-fg hover:bg-success/15', className)} role="status">
      <BellRing className="h-5 w-5 shrink-0 text-success" aria-hidden />
      <span>
        <strong>{pending.length === 1 ? `Pedido novo #${pending[0].number}` : `${pending.length} pedidos novos`}</strong> aguardando confirmação.
      </span>
      <span className="ml-auto flex items-center gap-1 font-bold text-success">
        Ver pedidos <ArrowRight className="h-4 w-4" aria-hidden />
      </span>
    </Link>
  );
}
