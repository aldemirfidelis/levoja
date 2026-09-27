'use client';

import { useEffect, useRef } from 'react';
import type { OrderStatus } from '@levoja/shared';
import { useBrand, useToast } from '@levoja/web-kit/ui';
import type { CompanyOrderView } from '@/components/order-types';
import { useOrderAlerts } from '@/components/order-alerts';
import { useCompany } from '@/lib/company';
import { DISPATCH_STATUSES, isPrinted, loadPrinterSettings, printOrderLabel, usePrintedLabels } from '@/lib/order-printing';

/** Imprimir a etiqueta de um pedido (botões do quadro e do detalhe) e saber quais já saíram. */
export function useOrderLabelPrinter() {
  const { company } = useCompany();
  const brand = useBrand();
  const toast = useToast();
  const printed = usePrintedLabels(company.id);
  const print = async (order: CompanyOrderView) => {
    try {
      await printOrderLabel(company.id, order, { tradeName: company.tradeName, logoUrl: company.logoUrl, phone: company.phone }, brand.appName);
    } catch {
      toast.error(new Error('Não foi possível abrir a impressão. Confira a impressora em "Impressora".'));
    }
  };
  return { print, printed };
}

/**
 * Impressão automática da etiqueta, conforme a preferência deste computador:
 * - "dispatch": quando o pedido de entrega vai para "Em entrega" (o entregador aceitou);
 * - "ready": quando o pedido fica pronto (botão "Marcar como pronto").
 * Só reage a mudanças vistas com a página aberta (recarregar não reimprime) e nunca imprime
 * o mesmo pedido duas vezes neste computador.
 */
export function OrderLabelAutoPrint() {
  const { company } = useCompany();
  const { orders } = useOrderAlerts();
  const { print } = useOrderLabelPrinter();
  const printRef = useRef(print);
  printRef.current = print;
  const previous = useRef<Map<string, OrderStatus> | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = new Map(orders.map((order) => [order.id, order.status]));
    if (!before) return;
    const { autoPrint } = loadPrinterSettings(company.id);
    if (autoPrint === 'manual') return;
    const due = orders.filter((order) => {
      const was = before.get(order.id);
      if (!was || was === order.status || isPrinted(company.id, order.id)) return false;
      if (autoPrint === 'ready') return order.status === 'READY_FOR_PICKUP';
      return order.fulfillment === 'DELIVERY' && DISPATCH_STATUSES.includes(order.status) && !DISPATCH_STATUSES.includes(was);
    });
    // Uma de cada vez: o diálogo de impressão bloqueia a página até fechar.
    void (async () => {
      for (const order of due) await printRef.current(order);
    })();
  }, [orders, company.id]);

  return null;
}
