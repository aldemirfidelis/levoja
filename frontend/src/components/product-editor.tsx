'use client';

import { FormEvent, useRef, useState } from 'react';
import { Plus, Trash2, Upload, X } from 'lucide-react';
import { api } from '@levoja/web-kit/client';
import { Button, Checkbox, Dialog, errorMessage, Input, Select, Textarea, useToast } from '@levoja/web-kit/ui';
import { MoneyInput } from './money-input';

export interface ProductView {
  id: string;
  categoryId: string | null;
  type: 'SIMPLE' | 'COMBO';
  name: string;
  description: string | null;
  sku: string | null;
  barcode: string | null;
  priceCents: number;
  promoPriceCents: number | null;
  promoStartsAt: string | null;
  promoEndsAt: string | null;
  effectivePriceCents: number;
  onSale: boolean;
  trackStock: boolean;
  stockQuantity: number;
  weightGrams: number | null;
  status: 'ACTIVE' | 'INACTIVE';
  available: boolean;
  isRegulated: boolean;
  requiresPrescription: boolean;
  minimumAge: number | null;
  images: { id: string; url: string }[];
  optionGroups: { id: string; name: string; minSelect: number; maxSelect: number; options: { id: string; name: string; priceDeltaCents: number; isActive: boolean }[] }[];
  comboItems: { productId: string; name: string; quantity: number }[];
}

interface GroupDraft {
  name: string;
  minSelect: number;
  maxSelect: number;
  options: { name: string; priceDeltaCents: number | null; isActive: boolean }[];
}

const toLocalInput = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : '');

export function ProductEditor({
  companyId,
  product,
  categories,
  products,
  onClose,
  onSaved,
}: {
  companyId: string;
  product: ProductView | null;
  categories: { id: string; name: string }[];
  products: ProductView[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const imageInput = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: product?.name ?? '',
    categoryId: product?.categoryId ?? '',
    type: product?.type ?? 'SIMPLE',
    description: product?.description ?? '',
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    priceCents: product?.priceCents ?? null,
    promoPriceCents: product?.promoPriceCents ?? null,
    promoStartsAt: toLocalInput(product?.promoStartsAt ?? null),
    promoEndsAt: toLocalInput(product?.promoEndsAt ?? null),
    trackStock: product?.trackStock ?? false,
    stockQuantity: product?.stockQuantity ?? 0,
    weightGrams: product?.weightGrams ?? '',
    active: (product?.status ?? 'ACTIVE') === 'ACTIVE',
    isRegulated: product?.isRegulated ?? false,
    requiresPrescription: product?.requiresPrescription ?? false,
    minimumAge: product?.minimumAge ?? '',
  });
  const [groups, setGroups] = useState<GroupDraft[]>(
    product?.optionGroups.map((group) => ({
      name: group.name,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      options: group.options.map((option) => ({ name: option.name, priceDeltaCents: option.priceDeltaCents, isActive: option.isActive })),
    })) ?? [],
  );
  const [comboItems, setComboItems] = useState(product?.comboItems.map(({ productId, quantity }) => ({ productId, quantity })) ?? []);
  const [images, setImages] = useState(product?.images ?? []);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const base = `companies/${companyId}/products`;

  const updateGroup = (index: number, patch: Partial<GroupDraft>) => setGroups(groups.map((group, i) => (i === index ? { ...group, ...patch } : group)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (form.priceCents == null) return setError('Informe o preço.');
    setBusy(true);
    setError(undefined);
    try {
      const body = {
        name: form.name,
        categoryId: form.categoryId || undefined,
        type: form.type,
        description: form.description || undefined,
        sku: form.sku || undefined,
        barcode: form.barcode || undefined,
        priceCents: form.priceCents,
        promoPriceCents: form.promoPriceCents,
        promoStartsAt: form.promoStartsAt ? new Date(form.promoStartsAt).toISOString() : null,
        promoEndsAt: form.promoEndsAt ? new Date(form.promoEndsAt).toISOString() : null,
        trackStock: form.trackStock,
        ...(product ? {} : { stockQuantity: Number(form.stockQuantity) || 0 }),
        weightGrams: form.weightGrams === '' ? undefined : Number(form.weightGrams),
        status: form.active ? 'ACTIVE' : 'INACTIVE',
        isRegulated: form.isRegulated,
        requiresPrescription: form.requiresPrescription,
        minimumAge: form.minimumAge === '' ? null : Number(form.minimumAge),
        optionGroups: groups.map((group) => ({ ...group, options: group.options.map((option) => ({ ...option, priceDeltaCents: option.priceDeltaCents ?? 0 })) })),
        ...(form.type === 'COMBO' ? { comboItems } : {}),
      };
      if (product) await api.patch(`${base}/${product.id}`, body);
      else await api.post(base, body);
      toast.success('Produto salvo.');
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const uploadImage = async (file?: File) => {
    if (!file || !product) return;
    const data = new FormData();
    data.set('file', file);
    try {
      const updated = await api.upload<ProductView>(`${base}/${product.id}/images`, data);
      setImages(updated.images);
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      if (imageInput.current) imageInput.current.value = '';
    }
  };

  const removeImage = async (imageId: string) => {
    if (!product) return;
    try {
      const updated = await api.delete<ProductView>(`${base}/${product.id}/images/${imageId}`);
      setImages(updated.images);
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Dialog open onClose={onClose} size="lg" title={product ? `Editar: ${product.name}` : 'Novo produto'}>
      <form onSubmit={submit} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input className="sm:col-span-2" label="Nome" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Select label="Categoria" value={form.categoryId} placeholder="Sem categoria" options={categories.map((c) => ({ value: c.id, label: c.name }))} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} />
          <Select
            label="Tipo"
            value={form.type}
            options={[
              { value: 'SIMPLE', label: 'Produto' },
              { value: 'COMBO', label: 'Combo' },
            ]}
            onChange={(e) => setForm({ ...form, type: e.target.value as 'SIMPLE' | 'COMBO' })}
          />
          <Textarea className="sm:col-span-2" label="Descrição" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <MoneyInput label="Preço (R$)" required value={form.priceCents} onChange={(priceCents) => setForm({ ...form, priceCents })} />
          <MoneyInput label="Preço promocional (R$)" value={form.promoPriceCents} onChange={(promoPriceCents) => setForm({ ...form, promoPriceCents })} hint="Deixe vazio para não ter promoção." />
          <Input label="Promoção de" type="datetime-local" value={form.promoStartsAt} onChange={(e) => setForm({ ...form, promoStartsAt: e.target.value })} />
          <Input label="Promoção até" type="datetime-local" value={form.promoEndsAt} onChange={(e) => setForm({ ...form, promoEndsAt: e.target.value })} />
          <Input label="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          <Input label="Código de barras" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
          <Input label="Peso (g)" type="number" min={0} value={form.weightGrams} onChange={(e) => setForm({ ...form, weightGrams: e.target.value as never })} />
          <Input label="Idade mínima" type="number" min={0} max={21} hint="Ex.: 18 para bebidas alcoólicas" value={form.minimumAge} onChange={(e) => setForm({ ...form, minimumAge: e.target.value as never })} />
        </div>

        <div className="grid gap-3 rounded-xl bg-surface-2 p-4 sm:grid-cols-2">
          <Checkbox label="Produto ativo (visível na loja)" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          <Checkbox label="Controlar estoque" checked={form.trackStock} onChange={(e) => setForm({ ...form, trackStock: e.target.checked })} />
          {form.trackStock && !product && (
            <Input label="Estoque inicial" type="number" min={0} value={form.stockQuantity} onChange={(e) => setForm({ ...form, stockQuantity: Number(e.target.value) })} />
          )}
          <Checkbox label="Produto regulado" checked={form.isRegulated} onChange={(e) => setForm({ ...form, isRegulated: e.target.checked })} />
          <Checkbox label="Exige receita médica" checked={form.requiresPrescription} onChange={(e) => setForm({ ...form, requiresPrescription: e.target.checked })} />
        </div>

        {form.type === 'COMBO' && (
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">Itens do combo</legend>
            {comboItems.map((item, index) => (
              <div key={index} className="flex items-end gap-2">
                <Select
                  className="flex-1"
                  aria-label="Produto"
                  value={item.productId}
                  options={products.filter((p) => p.type === 'SIMPLE' && p.id !== product?.id).map((p) => ({ value: p.id, label: p.name }))}
                  onChange={(e) => setComboItems(comboItems.map((it, i) => (i === index ? { ...it, productId: e.target.value } : it)))}
                />
                <Input className="w-24" aria-label="Quantidade" type="number" min={1} value={item.quantity} onChange={(e) => setComboItems(comboItems.map((it, i) => (i === index ? { ...it, quantity: Number(e.target.value) } : it)))} />
                <button type="button" onClick={() => setComboItems(comboItems.filter((_, i) => i !== index))} className="mb-2 rounded p-1 text-muted hover:text-danger" aria-label="Remover item">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button type="button" size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setComboItems([...comboItems, { productId: products.find((p) => p.type === 'SIMPLE')?.id ?? '', quantity: 1 }])}>
              Adicionar item
            </Button>
          </fieldset>
        )}

        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold">Variações e adicionais</legend>
          {groups.map((group, index) => (
            <div key={index} className="rounded-xl border border-border p-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_6rem_6rem_auto] sm:items-end">
                <Input label="Grupo" placeholder="Ex.: Tamanho, Adicionais" value={group.name} onChange={(e) => updateGroup(index, { name: e.target.value })} />
                <Input label="Mínimo" type="number" min={0} value={group.minSelect} onChange={(e) => updateGroup(index, { minSelect: Number(e.target.value) })} />
                <Input label="Máximo" type="number" min={1} value={group.maxSelect} onChange={(e) => updateGroup(index, { maxSelect: Number(e.target.value) })} />
                <button type="button" onClick={() => setGroups(groups.filter((_, i) => i !== index))} className="mb-2 rounded p-2 text-muted hover:text-danger" aria-label="Remover grupo">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {group.options.map((option, optionIndex) => (
                  <div key={optionIndex} className="flex items-end gap-2">
                    <Input
                      className="flex-1"
                      aria-label="Opção"
                      placeholder="Nome da opção"
                      value={option.name}
                      onChange={(e) => updateGroup(index, { options: group.options.map((o, i) => (i === optionIndex ? { ...o, name: e.target.value } : o)) })}
                    />
                    <MoneyInput
                      className="w-32"
                      label="+ R$"
                      value={option.priceDeltaCents}
                      onChange={(cents) => updateGroup(index, { options: group.options.map((o, i) => (i === optionIndex ? { ...o, priceDeltaCents: cents } : o)) })}
                    />
                    <button
                      type="button"
                      onClick={() => updateGroup(index, { options: group.options.filter((_, i) => i !== optionIndex) })}
                      className="mb-2 rounded p-1 text-muted hover:text-danger"
                      aria-label="Remover opção"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <Button type="button" size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => updateGroup(index, { options: [...group.options, { name: '', priceDeltaCents: 0, isActive: true }] })}>
                  Opção
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setGroups([...groups, { name: '', minSelect: 0, maxSelect: 1, options: [{ name: '', priceDeltaCents: 0, isActive: true }] }])}>
            Adicionar grupo
          </Button>
        </fieldset>

        {product && (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Fotos</legend>
            <div className="flex flex-wrap gap-3">
              {images.map((image) => (
                <div key={image.id} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt="" className="h-20 w-20 rounded-lg object-cover" />
                  <button type="button" onClick={() => removeImage(image.id)} className="absolute -right-2 -top-2 rounded-full bg-danger p-1 text-white" aria-label="Remover foto">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => uploadImage(e.target.files?.[0])} />
              <button type="button" onClick={() => imageInput.current?.click()} className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-xs text-muted hover:bg-surface-2">
                <Upload className="h-4 w-4" /> Foto
              </button>
            </div>
          </fieldset>
        )}

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy}>
            Salvar produto
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
