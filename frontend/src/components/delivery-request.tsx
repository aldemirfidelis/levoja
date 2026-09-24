'use client';

import { FormEvent, useEffect, useState } from 'react';
import { formatBRL, ITEM_CATEGORIES, ITEM_CATEGORY_LABELS, VEHICLE_TYPE_LABELS, VEHICLE_TYPES } from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import { Button, Card, errorMessage, Input, Select, Textarea } from '@levoja/web-kit/ui';

interface SavedAddress {
  id: string;
  label: string | null;
  street: string;
  number: string;
  district: string;
  lat: number | null;
}

interface B2bOverview {
  canInvoice: boolean;
  availableCreditCents: number;
  contract: { number: number; requireCostCenter: boolean } | null;
}

interface CompanyLocation {
  id: string;
  name: string;
  street: string;
  number: string;
  city: string;
}

interface CostCenterOption {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  availableThisMonthCents: number | null;
}

interface Quote {
  vehicleType: string;
  distanceKm: number;
  durationMin: number;
  feeCents: number;
  breakdown: { label: string; cents: number }[];
}

interface StopForm {
  addressId: string;
  contactName: string;
  zipCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  lat: string;
  lng: string;
}

const emptyStop: StopForm = { addressId: '', contactName: '', zipCode: '', street: '', number: '', complement: '', district: '', city: '', state: '', lat: '', lng: '' };

function toStop(stop: StopForm) {
  if (stop.addressId) return { addressId: stop.addressId, contactName: stop.contactName || undefined };
  return {
    contactName: stop.contactName || undefined,
    zipCode: stop.zipCode || undefined,
    street: stop.street,
    number: stop.number,
    complement: stop.complement || undefined,
    district: stop.district || undefined,
    city: stop.city,
    state: stop.state.toUpperCase(),
    lat: stop.lat ? Number(stop.lat) : undefined,
    lng: stop.lng ? Number(stop.lng) : undefined,
  };
}

function StopFields({ title, value, onChange, addresses, allowSaved }: { title: string; value: StopForm; onChange: (value: StopForm) => void; addresses: SavedAddress[]; allowSaved: boolean }) {
  const set = (key: keyof StopForm) => (event: { target: { value: string } }) => onChange({ ...value, [key]: event.target.value });
  const lookupCep = async (cep: string) => {
    const digits = cep.replace(/\D/g, '');
    if (digits.length !== 8) return;
    try {
      const data = await (await fetch(`https://viacep.com.br/ws/${digits}/json/`)).json();
      if (!data.erro) onChange({ ...value, zipCode: cep, street: data.logradouro, district: data.bairro, city: data.localidade, state: data.uf });
    } catch {
      /* preenchimento manual */
    }
  };
  const useLocation = () =>
    navigator.geolocation?.getCurrentPosition((position) => onChange({ ...value, lat: String(position.coords.latitude), lng: String(position.coords.longitude) }));

  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-sm font-semibold">{title}</legend>
      {allowSaved && addresses.length > 0 && (
        <Select
          aria-label={`${title}: endereço salvo`}
          value={value.addressId}
          placeholder="Digitar outro endereço"
          options={addresses.filter((a) => a.lat != null).map((a) => ({ value: a.id, label: `${a.label ?? 'Endereço'} — ${a.street}, ${a.number}` }))}
          onChange={set('addressId')}
        />
      )}
      <Input label="Nome de contato" value={value.contactName} onChange={set('contactName')} />
      {!value.addressId && (
        <div className="grid gap-3 sm:grid-cols-6">
          <Input className="sm:col-span-2" label="CEP" value={value.zipCode} onChange={(e) => { set('zipCode')(e); void lookupCep(e.target.value); }} />
          <Input className="sm:col-span-4" label="Rua" required value={value.street} onChange={set('street')} />
          <Input className="sm:col-span-2" label="Número" required value={value.number} onChange={set('number')} />
          <Input className="sm:col-span-4" label="Complemento" value={value.complement} onChange={set('complement')} />
          <Input className="sm:col-span-2" label="Bairro" value={value.district} onChange={set('district')} />
          <Input className="sm:col-span-3" label="Cidade" required value={value.city} onChange={set('city')} />
          <Input className="sm:col-span-1" label="UF" required maxLength={2} value={value.state} onChange={set('state')} />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted sm:col-span-6">
            <Button type="button" size="sm" variant="secondary" onClick={useLocation}>
              Usar minha localização
            </Button>
            {value.lat ? `Localização: ${Number(value.lat).toFixed(5)}, ${Number(value.lng).toFixed(5)}` : 'Sem localização, tentaremos encontrar o endereço no mapa.'}
          </div>
        </div>
      )}
    </fieldset>
  );
}

/**
 * Solicitação de entrega avulsa (cotação → confirmação). `basePath` = "deliveries" (cliente)
 * ou "companies/<id>/deliveries" (empresa, coleta padrão no endereço da empresa).
 */
export function DeliveryRequestForm({ basePath, isCompany, companyId, onCreated }: { basePath: string; isCompany?: boolean; companyId?: string; onCreated: (id: string) => void }) {
  const { data: addresses } = useApi<SavedAddress[]>(isCompany ? null : 'me/addresses');
  const { data: methods } = useApi<{ deliveries: { customer: string[]; company: string[] } }>('payments/methods');
  const { data: credits } = useApi<{ availableCents: number }>(isCompany ? null : 'customers/me/wallet');
  // Empresas: contrato (faturado), unidades cadastradas e centros de custo.
  const { data: b2b } = useApi<B2bOverview>(companyId ? `companies/${companyId}/b2b` : null);
  const { data: locations } = useApi<CompanyLocation[]>(companyId ? `companies/${companyId}/b2b/locations` : null);
  const { data: costCenters } = useApi<CostCenterOption[]>(companyId ? `companies/${companyId}/b2b/cost-centers` : null);
  const baseMethods = methods ? (isCompany ? methods.deliveries.company : methods.deliveries.customer) : isCompany ? ['WALLET', 'CASH'] : ['CASH'];
  const allowedMethods = baseMethods.filter((method) => method !== 'INVOICE' || !isCompany || b2b?.canInvoice);
  const methodLabels: Record<string, string> = {
    INVOICE: b2b?.contract ? `Faturado — contrato #${b2b.contract.number} (crédito ${formatBRL(b2b.availableCreditCents)})` : 'Faturado (mensal)',
    CASH: 'Dinheiro na coleta',
    WALLET: isCompany ? 'Saldo de vendas da loja' : `Créditos da carteira${credits ? ` (${formatBRL(credits.availableCents)})` : ''}`,
  };
  const [pickup, setPickup] = useState<StopForm>(emptyStop);
  const [dropoff, setDropoff] = useState<StopForm>(emptyStop);
  // Empresa: "company" (endereço da empresa), "custom" ou o id de uma unidade cadastrada.
  const [pickupMode, setPickupMode] = useState('company');
  const [dropoffMode, setDropoffMode] = useState('custom');
  const [b2bFields, setB2bFields] = useState({ costCenterId: '', externalRef: '' });
  const [item, setItem] = useState({ itemCategory: 'PACKAGE', itemDescription: '', weightKg: '', lengthCm: '', widthCm: '', heightCm: '', vehicleType: '', scheduledFor: '', notes: '', paymentMethod: isCompany ? 'WALLET' : 'CASH' });
  // Com contrato ativo, o padrão da empresa passa a ser o faturado.
  useEffect(() => {
    if (isCompany && b2b?.canInvoice) setItem((current) => ({ ...current, paymentMethod: 'INVOICE' }));
  }, [isCompany, b2b?.canInvoice]);
  const pickupFromCompany = !isCompany || pickupMode === 'company';
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const payload = () => ({
    ...(isCompany && pickupMode === 'company' ? {} : isCompany && pickupMode !== 'custom' ? { pickup: { locationId: pickupMode } } : { pickup: toStop(pickup) }),
    dropoff: isCompany && dropoffMode !== 'custom' ? { locationId: dropoffMode } : toStop(dropoff),
    itemCategory: item.itemCategory,
    weightKg: item.weightKg ? Number(item.weightKg.replace(',', '.')) : undefined,
    lengthCm: item.lengthCm ? Number(item.lengthCm) : undefined,
    widthCm: item.widthCm ? Number(item.widthCm) : undefined,
    heightCm: item.heightCm ? Number(item.heightCm) : undefined,
    vehicleType: item.vehicleType || undefined,
    scheduledFor: item.scheduledFor ? new Date(item.scheduledFor).toISOString() : undefined,
  });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onQuote = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => setQuote(await api.post<Quote>(`${basePath}/quote`, payload())));
  };

  const onConfirm = () =>
    run(async () => {
      const created = await api.post<{ id: string }>(basePath, {
        ...payload(),
        itemDescription: item.itemDescription || undefined,
        notes: item.notes || undefined,
        paymentMethod: item.paymentMethod,
        ...(isCompany ? { costCenterId: b2bFields.costCenterId || undefined, externalRef: b2bFields.externalRef || undefined } : {}),
      });
      onCreated(created.id);
    });

  return (
    <form onSubmit={onQuote} className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-6">
        <Card title="Coleta e entrega">
          <div className="space-y-6">
            {isCompany && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label="Coleta"
                  value={pickupMode}
                  onChange={(e) => setPickupMode(e.target.value)}
                  options={[{ value: 'company', label: 'Endereço da empresa' }, ...(locations ?? []).map((location) => ({ value: location.id, label: `${location.name} — ${location.street}, ${location.number}` })), { value: 'custom', label: 'Outro endereço' }]}
                />
                <Select
                  label="Destino"
                  value={dropoffMode}
                  hint={dropoffMode !== 'custom' ? 'Transferência para uma unidade cadastrada.' : undefined}
                  onChange={(e) => setDropoffMode(e.target.value)}
                  options={[{ value: 'custom', label: 'Endereço do destinatário' }, ...(locations ?? []).map((location) => ({ value: location.id, label: `${location.name} — ${location.street}, ${location.number}` }))]}
                />
              </div>
            )}
            {!pickupFromCompany && (!isCompany || pickupMode === 'custom') && <StopFields title="Origem (coleta)" value={pickup} onChange={setPickup} addresses={addresses ?? []} allowSaved={!isCompany} />}
            {(!isCompany || dropoffMode === 'custom') && <StopFields title="Destino (entrega)" value={dropoff} onChange={setDropoff} addresses={addresses ?? []} allowSaved={!isCompany} />}
            {isCompany && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label={b2b?.contract?.requireCostCenter ? 'Centro de custo (obrigatório)' : 'Centro de custo'}
                  value={b2bFields.costCenterId}
                  placeholder={b2b?.contract?.requireCostCenter ? 'Escolha' : 'Nenhum'}
                  required={b2b?.contract?.requireCostCenter}
                  onChange={(e) => setB2bFields({ ...b2bFields, costCenterId: e.target.value })}
                  options={(costCenters ?? [])
                    .filter((center) => center.isActive)
                    .map((center) => ({ value: center.id, label: `${center.code} — ${center.name}${center.availableThisMonthCents != null ? ` (disponível ${formatBRL(center.availableThisMonthCents)})` : ''}` }))}
                />
                <Input label="Sua referência (pedido, nota)" maxLength={60} value={b2bFields.externalRef} onChange={(e) => setB2bFields({ ...b2bFields, externalRef: e.target.value })} />
              </div>
            )}
          </div>
        </Card>
        <Card title="O que será enviado">
          <div className="grid gap-4 sm:grid-cols-3">
            <Select label="Tipo de item" value={item.itemCategory} options={ITEM_CATEGORIES.map((c) => ({ value: c, label: ITEM_CATEGORY_LABELS[c] }))} onChange={(e) => setItem({ ...item, itemCategory: e.target.value })} />
            <Input className="sm:col-span-2" label="Descrição" value={item.itemDescription} onChange={(e) => setItem({ ...item, itemDescription: e.target.value })} />
            <Input label="Peso aproximado (kg)" inputMode="decimal" value={item.weightKg} onChange={(e) => setItem({ ...item, weightKg: e.target.value })} />
            <Input label="Comprimento (cm)" inputMode="numeric" value={item.lengthCm} onChange={(e) => setItem({ ...item, lengthCm: e.target.value })} />
            <Input label="Largura (cm)" inputMode="numeric" value={item.widthCm} onChange={(e) => setItem({ ...item, widthCm: e.target.value })} />
            <Input label="Altura (cm)" inputMode="numeric" value={item.heightCm} onChange={(e) => setItem({ ...item, heightCm: e.target.value })} />
            <Select label="Veículo" value={item.vehicleType} placeholder="Automático (pela carga)" options={VEHICLE_TYPES.map((t) => ({ value: t, label: VEHICLE_TYPE_LABELS[t] }))} onChange={(e) => setItem({ ...item, vehicleType: e.target.value })} />
            <Input label="Agendar para (opcional)" type="datetime-local" value={item.scheduledFor} onChange={(e) => setItem({ ...item, scheduledFor: e.target.value })} />
            <Textarea className="sm:col-span-3" label="Observações para o entregador" value={item.notes} onChange={(e) => setItem({ ...item, notes: e.target.value })} />
          </div>
        </Card>
      </div>
      <aside className="space-y-4">
        <Card title="Resumo">
          {!quote ? (
            <p className="text-sm text-muted">Preencha os dados e calcule o valor.</p>
          ) : (
            <div className="space-y-3 text-sm">
              <ul className="space-y-1">
                {quote.breakdown.map((line, index) => (
                  <li key={index} className="flex justify-between">
                    <span className="text-muted">{line.label}</span>
                    <span className="tabular-nums">{formatBRL(line.cents)}</span>
                  </li>
                ))}
              </ul>
              <p className="flex justify-between border-t border-border pt-2 text-base font-bold">
                <span>Total</span>
                <span className="tabular-nums">{formatBRL(quote.feeCents)}</span>
              </p>
              <p className="text-xs text-muted">
                {quote.distanceKm} km · cerca de {quote.durationMin} min · {VEHICLE_TYPE_LABELS[quote.vehicleType as keyof typeof VEHICLE_TYPE_LABELS]}
              </p>
              <Select
                label="Pagamento"
                value={item.paymentMethod}
                options={allowedMethods.map((method) => ({ value: method, label: methodLabels[method] ?? method }))}
                hint={item.paymentMethod === 'WALLET' ? 'O valor é debitado na confirmação e devolvido se a entrega for cancelada antes da coleta.' : undefined}
                onChange={(e) => setItem({ ...item, paymentMethod: e.target.value })}
              />
            </div>
          )}
          {error && (
            <p className="mt-3 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="mt-4 space-y-2">
            <Button type="submit" variant={quote ? 'secondary' : 'primary'} className="w-full" loading={busy && !quote}>
              {quote ? 'Recalcular' : 'Calcular valor'}
            </Button>
            {quote && (
              <Button type="button" className="w-full" loading={busy} onClick={onConfirm}>
                Solicitar entrega
              </Button>
            )}
          </div>
        </Card>
      </aside>
    </form>
  );
}
