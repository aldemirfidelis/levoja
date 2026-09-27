'use client';

import { useEffect, useMemo, useState } from 'react';
import { Printer } from 'lucide-react';
import { Button, Card, Checkbox, cn, Select, useBrand } from '@levoja/web-kit/ui';
import type { CompanyOrderView } from '@/components/order-types';
import { useCompany } from '@/lib/company';
import { type AutoPrint, buildLabelHtml, DEFAULT_PRINTER_SETTINGS, loadPrinterSettings, type PaperSize, printHtml, type PrinterSettings, savePrinterSettings } from '@/lib/order-printing';

const PAPERS: { value: PaperSize; label: string; hint: string; previewPx: number }[] = [
  { value: '80mm', label: 'Térmica 80 mm', hint: 'A mais comum (Elgin i9, Epson TM-T20, Bematech MP-4200...)', previewPx: 302 },
  { value: '58mm', label: 'Térmica 58 mm', hint: 'Rolo estreito, impressoras compactas', previewPx: 219 },
  { value: 'A4', label: 'Impressora comum', hint: 'Folha A4 (jato de tinta ou laser)', previewPx: 420 },
];

const AUTO: { value: AutoPrint; label: string; hint: string }[] = [
  { value: 'dispatch', label: 'Quando o pedido sair para entrega', hint: 'Imprime sozinho quando o pedido vai para "Em entrega" (o entregador aceitou), já com o nome dele.' },
  { value: 'ready', label: 'Quando eu marcar o pedido como pronto', hint: 'Imprime ao clicar em "Marcar como pronto", para grampear no pacote antes do entregador chegar.' },
  { value: 'manual', label: 'Só quando eu clicar em "Imprimir etiqueta"', hint: 'Use neste computador se ele não tiver impressora.' },
];

/** Pedido de exemplo para a pré-visualização e a impressão de teste. */
function sampleOrder(): CompanyOrderView {
  const now = new Date().toISOString();
  return {
    id: 'exemplo',
    number: 1234,
    status: 'DRIVER_ASSIGNED',
    fulfillment: 'DELIVERY',
    items: [
      { id: '1', name: 'X-Burger Clássico', imageUrl: null, quantity: 2, unitPriceCents: 1990, totalCents: 3980, options: [{ group: 'Ponto da carne', option: 'Ao ponto', priceDeltaCents: 0 }], notes: 'Sem cebola' },
      { id: '2', name: 'Batata Frita Média', imageUrl: null, quantity: 1, unitPriceCents: 1200, totalCents: 1200, options: null, notes: null },
      { id: '3', name: 'Coca-Cola Lata 350ml', imageUrl: null, quantity: 2, unitPriceCents: 600, totalCents: 1200, options: null, notes: null },
    ],
    subtotalCents: 6380,
    deliveryFeeCents: 599,
    serviceFeeCents: 0,
    tipCents: 0,
    discountCents: 1000,
    totalCents: 5979,
    paymentMethod: 'CASH',
    paymentStatus: 'PENDING',
    changeForCents: 10000,
    notes: 'Tocar a campainha do portão azul',
    deliveryAddress: { street: 'Rua Santa Helena', number: '351', complement: 'Casa', district: 'Setor Alvorada', city: 'Bom Jesus de Goiás', state: 'GO', reference: 'Em frente à praça' },
    scheduledFor: null,
    estimatedReadyAt: null,
    estimatedDeliveryAt: null,
    requiresIdCheck: false,
    hasPrescription: false,
    cancelReason: null,
    canceledBy: null,
    timeline: [],
    customer: { firstName: 'Maria', phoneMasked: '(64) 9****-1234' },
    delivery: { id: 'd', code: 'K7M2Q9XA', status: 'DRIVER_ASSIGNED', driver: { name: 'João Pereira', rating: 4.9, vehicle: { type: 'MOTORCYCLE', plate: 'ABC1D23', model: 'Honda CG 160', color: 'vermelha' } } },
    createdAt: now,
  };
}

export default function PrinterPage() {
  const { company } = useCompany();
  const brand = useBrand();
  const [settings, setSettings] = useState<PrinterSettings>(DEFAULT_PRINTER_SETTINGS);
  const [saved, setSaved] = useState(false);

  // As preferências são deste computador (localStorage): carrega depois de montar.
  useEffect(() => setSettings(loadPrinterSettings(company.id)), [company.id]);

  const update = (patch: Partial<PrinterSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    savePrinterSettings(company.id, next);
    setSaved(true);
  };

  const labelCompany = { tradeName: company.tradeName, logoUrl: company.logoUrl, phone: company.phone };
  const preview = useMemo(() => buildLabelHtml(sampleOrder(), labelCompany, { ...settings, copies: 1 }, brand.appName), [settings, company.tradeName, company.logoUrl, company.phone, brand.appName]); // eslint-disable-line react-hooks/exhaustive-deps
  const paper = PAPERS.find((item) => item.value === settings.paper) ?? PAPERS[0];

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_auto]">
      <div className="space-y-6">
        <Card title="Impressora deste computador" actions={saved ? <span className="text-xs font-semibold text-success">Salvo neste computador</span> : undefined}>
          <div className="space-y-6">
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Tipo de impressora</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {PAPERS.map((item) => (
                  <label
                    key={item.value}
                    className={cn('cursor-pointer rounded-xl border-2 p-3 text-sm transition', settings.paper === item.value ? 'border-brand-500 bg-brand-500/5' : 'border-border hover:bg-surface-2')}
                  >
                    <input type="radio" name="paper" className="sr-only" checked={settings.paper === item.value} onChange={() => update({ paper: item.value })} />
                    <span className="block font-bold text-fg">{item.label}</span>
                    <span className="mt-0.5 block text-xs text-muted">{item.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Quando imprimir a etiqueta</legend>
              <div className="space-y-2">
                {AUTO.map((item) => (
                  <label key={item.value} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 text-sm', settings.autoPrint === item.value ? 'border-brand-500 bg-brand-500/5' : 'border-border hover:bg-surface-2')}>
                    <input type="radio" name="auto" className="mt-1 accent-brand-500" checked={settings.autoPrint === item.value} onChange={() => update({ autoPrint: item.value })} />
                    <span>
                      <span className="block font-bold text-fg">{item.label}</span>
                      <span className="block text-xs text-muted">{item.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">O botão "Imprimir etiqueta" continua nos pedidos das colunas Prontos e Em entrega e no detalhe do pedido, para reimprimir quando quiser.</p>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Vias por pedido"
                value={String(settings.copies)}
                options={[
                  { value: '1', label: '1 via (pacote)' },
                  { value: '2', label: '2 vias (pacote e cozinha)' },
                  { value: '3', label: '3 vias' },
                ]}
                onChange={(event) => update({ copies: Number(event.target.value) })}
              />
              <div className="flex items-end pb-2">
                <Checkbox label="Imprimir o logo da empresa no topo" checked={settings.showLogo} onChange={(event) => update({ showLogo: event.target.checked })} />
              </div>
            </div>

            <Button icon={<Printer className="h-4 w-4" />} onClick={() => void printHtml(buildLabelHtml(sampleOrder(), labelCompany, settings, brand.appName))}>
              Imprimir teste
            </Button>
          </div>
        </Card>

        <Card title="Como configurar a impressora térmica">
          <ol className="list-decimal space-y-3 pl-5 text-sm text-fg">
            <li>
              Instale o driver da impressora no Windows (site do fabricante: Elgin, Epson, Bematech, Daruma...) e confira se a página de teste do Windows sai
              normalmente.
            </li>
            <li>
              Clique em <strong>Imprimir teste</strong> acima. Na janela de impressão, escolha a impressora térmica em <em>Destino</em> e, em <em>Mais
              configurações</em>, deixe <em>Margens: Nenhuma</em> e desmarque <em>Cabeçalhos e rodapés</em>. O navegador lembra dessas escolhas.
            </li>
            <li>
              <strong>Para imprimir direto, sem a janela de confirmação</strong> (recomendado na correria): defina a térmica como impressora padrão do Windows e
              abra o portal por um atalho do Chrome com a opção de impressão direta. Clique com o botão direito no atalho do Chrome → <em>Propriedades</em> → no
              campo <em>Destino</em>, acrescente no final: <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">--kiosk-printing</code> → OK. Feche o Chrome e
              abra o portal por esse atalho.
            </li>
            <li>A impressão automática funciona com o portal aberto neste computador (pode ser em qualquer página da empresa).</li>
          </ol>
          <p className="mt-4 text-xs text-muted">As preferências desta página valem só para este computador e este navegador: cada caixa da loja pode ter a sua impressora.</p>
        </Card>
      </div>

      <Card title="Pré-visualização" className="h-fit">
        <div className="flex justify-center overflow-x-auto rounded-lg bg-surface-2 p-4">
          <iframe title="Pré-visualização da etiqueta" srcDoc={preview} className="h-[720px] rounded bg-white shadow-md" style={{ width: paper.previewPx }} sandbox="allow-same-origin" />
        </div>
        <p className="mt-2 text-center text-xs text-muted">Exemplo com dados fictícios · {paper.label}</p>
      </Card>
    </div>
  );
}
