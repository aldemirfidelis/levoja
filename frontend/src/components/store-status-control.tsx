'use client';

import { useState } from 'react';
import { Power } from 'lucide-react';
import { api, useApi } from '@levoja/web-kit/client';
import { Button, cn, ConfirmDialog, useToast } from '@levoja/web-kit/ui';
import type { CompanyView } from '@/lib/company';
import { usePortal } from '@/lib/portal-session';

type State = 'open' | 'outside' | 'paused';

const STYLE: Record<State, { box: string; dot: string; title: string; label: string; hint: string }> = {
  open: { box: 'border-success/40 bg-success/10', dot: 'bg-success', title: 'text-success', label: 'Loja aberta', hint: 'Recebendo pedidos' },
  outside: { box: 'border-warning/40 bg-warning/10', dot: 'bg-warning', title: 'text-warning', label: 'Fora do horário', hint: 'Abre conforme seus horários' },
  paused: { box: 'border-danger/40 bg-danger/10', dot: 'bg-danger', title: 'text-danger', label: 'Loja pausada', hint: 'Não está recebendo pedidos' },
};

/**
 * Situação da loja no topo do portal (sempre visível): aberta, fora do horário ou pausada,
 * com o botão de abrir/pausar. Usa a mesma consulta do layout da empresa, então as duas telas
 * mudam juntas. Pausar pede confirmação (um clique errado bloquearia os pedidos).
 */
export function StoreStatusControl({ companyId, className }: { companyId: string; className?: string }) {
  const { canInCompany } = usePortal();
  const toast = useToast();
  // Reconsulta a cada minuto: "fora do horário" muda sozinho conforme o relógio.
  const { data: company, refetch } = useApi<CompanyView>(`companies/${companyId}`, undefined, { refetchInterval: 60_000 });
  const [busy, setBusy] = useState(false);
  const [confirmPause, setConfirmPause] = useState(false);

  if (!company || company.status !== 'APPROVED' || !canInCompany(companyId, 'company.orders.read')) return null;
  const manage = canInCompany(companyId, 'company.orders.manage');
  const state: State = !company.isOpen ? 'paused' : company.isOpenNow ? 'open' : 'outside';
  const style = STYLE[state];

  const setOpen = async (isOpen: boolean) => {
    setBusy(true);
    try {
      await api.post(`companies/${companyId}/open`, { isOpen });
      toast.success(isOpen ? 'Loja aberta! Você já pode receber pedidos.' : 'Loja pausada. Novos pedidos estão bloqueados.');
      await refetch();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={cn('flex items-center gap-3 rounded-xl border py-1.5 pl-3 pr-1.5', style.box, className)} role="status" aria-live="polite" title={`${company.tradeName}: ${style.label}`}>
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          {state === 'open' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />}
          <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', style.dot)} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className={cn('truncate text-sm font-extrabold', style.title)}>{style.label}</span>
          <span className="truncate text-xs text-muted">{style.hint}</span>
        </span>
        {manage &&
          (company.isOpen ? (
            <Button size="sm" variant="secondary" loading={busy} onClick={() => setConfirmPause(true)} icon={<Power className="h-3.5 w-3.5" />}>
              Pausar
            </Button>
          ) : (
            <Button size="sm" variant="success" loading={busy} onClick={() => void setOpen(true)} icon={<Power className="h-3.5 w-3.5" />}>
              Abrir loja
            </Button>
          ))}
      </div>
      <ConfirmDialog
        open={confirmPause}
        onClose={() => setConfirmPause(false)}
        onConfirm={() => setOpen(false)}
        title={`Pausar ${company.tradeName}?`}
        description="Enquanto a loja estiver pausada, os clientes não conseguem fazer novos pedidos. Os pedidos em andamento continuam normalmente."
        confirmLabel="Pausar loja"
        tone="danger"
      />
    </>
  );
}
