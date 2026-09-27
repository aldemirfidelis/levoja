'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { formatBRL, PAYMENT_METHOD_LABELS, type OrderStatus } from '@levoja/shared';
import type { CompanyOrderView } from '@/components/order-types';

/**
 * Etiqueta do pedido para impressora térmica (80/58 mm) ou comum.
 *
 * A impressão é feita pelo navegador (a impressora térmica instalada no Windows como qualquer
 * outra). As preferências ficam NESTE computador (localStorage): cada ponto da loja pode ter uma
 * impressora diferente, e um computador sem impressora pode ficar em "só manualmente".
 */

export type PaperSize = '80mm' | '58mm' | 'A4';
/** Quando imprimir sozinho: ao sair para entrega (entregador aceitou), ao ficar pronto, ou só no botão. */
export type AutoPrint = 'dispatch' | 'ready' | 'manual';

export interface PrinterSettings {
  paper: PaperSize;
  autoPrint: AutoPrint;
  copies: number;
  showLogo: boolean;
}

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = { paper: '80mm', autoPrint: 'dispatch', copies: 1, showLogo: true };

/** Status em que o pedido está na coluna "Em entrega". */
export const DISPATCH_STATUSES: OrderStatus[] = ['DRIVER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'];

const settingsKey = (companyId: string) => `lj_printer_${companyId}`;
const printedKey = (companyId: string) => `lj_printed_${companyId}`;

export function loadPrinterSettings(companyId: string): PrinterSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey(companyId)) ?? 'null') as Partial<PrinterSettings> | null;
    return { ...DEFAULT_PRINTER_SETTINGS, ...(saved ?? {}) };
  } catch {
    return DEFAULT_PRINTER_SETTINGS;
  }
}

export function savePrinterSettings(companyId: string, settings: PrinterSettings) {
  try {
    localStorage.setItem(settingsKey(companyId), JSON.stringify(settings));
  } catch {
    // Armazenamento indisponível (aba anônima): vale só até fechar a página.
  }
}

// ---------------------------------------------------------------------------
// Etiquetas já impressas (evita imprimir de novo ao recarregar a página)
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();
const MAX_PRINTED = 300;

function readPrinted(companyId: string): string {
  try {
    return localStorage.getItem(printedKey(companyId)) ?? '';
  } catch {
    return '';
  }
}

export function isPrinted(companyId: string, orderId: string): boolean {
  return readPrinted(companyId).split(',').includes(orderId);
}

export function markPrinted(companyId: string, orderId: string) {
  const ids = readPrinted(companyId).split(',').filter((id) => id && id !== orderId);
  ids.push(orderId);
  try {
    localStorage.setItem(printedKey(companyId), ids.slice(-MAX_PRINTED).join(','));
  } catch {
    // sem armazenamento: só não lembra depois de recarregar
  }
  listeners.forEach((listener) => listener());
}

/** Pedidos cuja etiqueta já foi impressa neste computador (atualiza sozinho ao imprimir). */
export function usePrintedLabels(companyId: string): Set<string> {
  const raw = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => readPrinted(companyId),
    () => '',
  );
  return useMemo(() => new Set(raw.split(',').filter(Boolean)), [raw]);
}

// ---------------------------------------------------------------------------
// Conteúdo da etiqueta
// ---------------------------------------------------------------------------

export interface LabelCompany {
  tradeName: string;
  logoUrl: string | null;
  phone: string | null;
}

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const dateTime = (iso: string | Date) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Largura útil do conteúdo por papel (as térmicas imprimem ~72 mm no rolo de 80 e ~48 mm no de 58). */
const CONTENT_WIDTH: Record<PaperSize, string> = { '80mm': '72mm', '58mm': '48mm', A4: '100mm' };

function paymentBlock(order: CompanyOrderView): string {
  const method = PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod;
  if (order.paymentMethod === 'CASH') {
    const change = order.changeForCents && order.changeForCents > order.totalCents ? order.changeForCents - order.totalCents : 0;
    return `<div class="box">
      <div class="big">COBRAR NA ENTREGA: ${escapeHtml(formatBRL(order.totalCents))}</div>
      <div>${escapeHtml(method)}</div>
      ${order.changeForCents ? `<div>Troco para ${escapeHtml(formatBRL(order.changeForCents))} — <b>levar ${escapeHtml(formatBRL(change))}</b></div>` : '<div>Cliente não pediu troco</div>'}
    </div>`;
  }
  const paid = ['PAID', 'AUTHORIZED'].includes(order.paymentStatus);
  return `<div class="box"><div class="big">${paid ? 'PAGO ONLINE — NÃO COBRAR' : 'PAGAMENTO PENDENTE'}</div><div>${escapeHtml(method)}</div></div>`;
}

/** HTML completo (documento) de uma etiqueta — usado na impressão e na pré-visualização. */
export function buildLabelHtml(order: CompanyOrderView, company: LabelCompany, settings: PrinterSettings, brandName = 'LevoJá'): string {
  const address = order.deliveryAddress;
  const driver = order.delivery?.driver;
  const vehicle = driver?.vehicle ? [driver.vehicle.model, driver.vehicle.color, driver.vehicle.plate].filter(Boolean).join(' · ') : '';
  const unitCount = order.items.reduce((sum, item) => sum + item.quantity, 0);

  const items = order.items
    .map(
      (item) => `<tr class="item">
        <td class="qty">${item.quantity}x</td>
        <td>
          <b>${escapeHtml(item.name)}</b>
          ${(item.options ?? []).map((option) => `<div class="opt">${escapeHtml(option.group)}: ${escapeHtml(option.option)}</div>`).join('')}
          ${item.notes ? `<div class="note">&gt;&gt; OBS: ${escapeHtml(item.notes)}</div>` : ''}
        </td>
        <td class="price">${escapeHtml(formatBRL(item.totalCents))}</td>
      </tr>`,
    )
    .join('');

  const totals = [
    ['Subtotal', order.subtotalCents],
    ...(order.deliveryFeeCents ? [['Entrega', order.deliveryFeeCents] as const] : []),
    ...(order.serviceFeeCents ? [['Taxa de serviço', order.serviceFeeCents] as const] : []),
    ...(order.tipCents ? [['Gorjeta', order.tipCents] as const] : []),
    ...(order.discountCents ? [['Desconto', -order.discountCents] as const] : []),
  ]
    .map(([label, cents]) => `<tr><td>${label}</td><td class="price">${escapeHtml(formatBRL(Number(cents)))}</td></tr>`)
    .join('');

  const label = `<section class="label">
    ${settings.showLogo && company.logoUrl ? `<div class="center"><img class="logo" src="${escapeHtml(company.logoUrl)}" alt=""></div>` : ''}
    <div class="center store">${escapeHtml(company.tradeName)}</div>
    ${company.phone ? `<div class="center small">Dúvidas: ${escapeHtml(company.phone)}</div>` : ''}
    <hr class="double">
    <div class="center order">PEDIDO #${order.number}</div>
    <div class="center">${order.fulfillment === 'PICKUP' ? '<b>RETIRADA NO BALCÃO</b>' : `<b>ENTREGA</b>${order.delivery ? ` · cód. ${escapeHtml(order.delivery.code)}` : ''}`}</div>
    <div class="center small">Recebido em ${escapeHtml(dateTime(order.createdAt))}</div>
    ${order.scheduledFor ? `<div class="box center"><b>AGENDADO PARA ${escapeHtml(dateTime(order.scheduledFor))}</b></div>` : ''}
    ${order.requiresIdCheck ? '<div class="box center"><b>CONFERIR DOCUMENTO DO CLIENTE (IDADE MÍNIMA)</b></div>' : ''}
    <hr>
    <div class="section">CLIENTE</div>
    <div class="big">${escapeHtml(order.customer.firstName)}</div>
    ${order.customer.phoneMasked ? `<div class="small">Tel.: ${escapeHtml(order.customer.phoneMasked)} (ligue pelo app)</div>` : ''}
    ${
      address
        ? `<div class="address">
            <b>${escapeHtml(address.street)}, ${escapeHtml(address.number)}</b>${address.complement ? ` — ${escapeHtml(address.complement)}` : ''}<br>
            ${escapeHtml(address.district)} · ${escapeHtml(address.city)}/${escapeHtml(address.state)}
            ${address.reference ? `<div class="ref">Ref.: ${escapeHtml(address.reference)}</div>` : ''}
          </div>`
        : ''
    }
    <hr>
    <div class="section">ITENS (${unitCount})</div>
    <table class="items">${items}</table>
    <hr>
    <table class="totals">${totals}<tr class="total"><td>TOTAL</td><td class="price">${escapeHtml(formatBRL(order.totalCents))}</td></tr></table>
    ${paymentBlock(order)}
    ${order.notes ? `<div class="box"><b>OBS. DO PEDIDO:</b> ${escapeHtml(order.notes)}</div>` : ''}
    ${
      order.fulfillment === 'DELIVERY'
        ? `<hr><div class="section">ENTREGADOR</div><div>${driver ? `<b>${escapeHtml(driver.name)}</b>${vehicle ? `<br>${escapeHtml(vehicle)}` : ''}` : 'A definir'}</div>`
        : ''
    }
    <hr>
    <div class="center small">Impresso em ${escapeHtml(dateTime(new Date()))} · via ${escapeHtml(brandName)}</div>
  </section>`;

  const copies = Math.min(3, Math.max(1, settings.copies));
  const width = CONTENT_WIDTH[settings.paper];
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pedido #${order.number}</title><style>
    @page { ${settings.paper === 'A4' ? 'size: A4; margin: 12mm;' : `size: ${settings.paper} auto; margin: 0;`} }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: ${settings.paper === '58mm' ? '11px' : '12.5px'}; line-height: 1.3; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .label { width: ${width}; margin: 0 auto; padding: 3mm 0 6mm; ${settings.paper === 'A4' ? 'border: 1px dashed #000; padding: 5mm;' : ''} }
    .label + .label { page-break-before: always; break-before: page; }
    .center { text-align: center; }
    .logo { max-width: 60%; max-height: 22mm; object-fit: contain; filter: grayscale(1) contrast(1.4); }
    .store { font-size: 1.35em; font-weight: 800; margin-top: 1mm; }
    .order { font-size: 2.1em; font-weight: 900; letter-spacing: 0.02em; margin: 1mm 0; }
    .small { font-size: 0.85em; }
    .big { font-size: 1.2em; font-weight: 800; }
    .section { font-size: 0.8em; font-weight: 800; letter-spacing: 0.08em; margin-bottom: 1mm; }
    .address { font-size: 1.1em; margin-top: 1mm; }
    .ref { margin-top: 1mm; font-style: italic; }
    hr { border: 0; border-top: 1px dashed #000; margin: 2.5mm 0; }
    hr.double { border-top: 3px double #000; }
    table { width: 100%; border-collapse: collapse; }
    td { vertical-align: top; padding: 0.6mm 0; }
    .items .qty { width: 9mm; font-size: 1.25em; font-weight: 900; }
    .items b { font-size: 1.1em; }
    .opt { padding-left: 1mm; }
    .note { font-weight: 800; margin-top: 0.5mm; }
    .price { text-align: right; white-space: nowrap; padding-left: 2mm; }
    .totals .total td { font-size: 1.3em; font-weight: 900; border-top: 1px solid #000; padding-top: 1mm; }
    .box { border: 1.5px solid #000; padding: 1.5mm 2mm; margin: 2mm 0; }
  </style></head><body>${Array.from({ length: copies }, () => label).join('')}</body></html>`;
}

// ---------------------------------------------------------------------------
// Impressão
// ---------------------------------------------------------------------------

/**
 * Imprime um documento HTML por um iframe fora da tela (sem sair da página).
 * Espera o logo carregar (até 3 s) para ele não sair em branco.
 */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:420px;height:800px;border:0;';
    frame.onload = () => {
      const doc = frame.contentDocument;
      const win = frame.contentWindow;
      if (!doc || !win) return resolve();
      const images = Array.from(doc.images).map((image) => (image.complete ? Promise.resolve() : new Promise<void>((done) => ((image.onload = image.onerror = () => done())))));
      void Promise.race([Promise.all(images), new Promise((done) => setTimeout(done, 3000))]).then(() => {
        try {
          win.focus();
          win.print();
        } finally {
          // O diálogo de impressão bloqueia até fechar; depois disso o iframe pode sair.
          setTimeout(() => frame.remove(), 1500);
          resolve();
        }
      });
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

/** Imprime a etiqueta do pedido com as preferências deste computador e marca como impressa. */
export async function printOrderLabel(companyId: string, order: CompanyOrderView, company: LabelCompany, brandName?: string) {
  const settings = loadPrinterSettings(companyId);
  markPrinted(companyId, order.id);
  await printHtml(buildLabelHtml(order, company, settings, brandName));
}
