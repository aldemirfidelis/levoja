'use client';

import { FormEvent, useState } from 'react';
import { Copy, Package, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { formatBRL } from '@levoja/shared';
import { api, Paginated, useApi, useApiMutation } from '@levoja/web-kit/client';
import {
  Badge,
  Button,
  cn,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
  Select,
  SkeletonRows,
  useToast,
} from '@levoja/web-kit/ui';
import { ProductEditor, ProductView } from '@/components/product-editor';
import { useCompany } from '@/lib/company';

interface Category {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  _count: { products: number };
}

function Categories({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const { company, can } = useCompany();
  const toast = useToast();
  const base = `companies/${company.id}/categories`;
  const { data } = useApi<Category[]>(base);
  const [name, setName] = useState('');
  const [removing, setRemoving] = useState<Category | null>(null);
  const create = useApiMutation(() => api.post(base, { name, sortOrder: (data?.length ?? 0) * 10 }), [base]);
  const manage = can('company.products.manage');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      await create.mutateAsync(undefined);
      setName('');
    } catch (error) {
      toast.error(error);
    }
  };

  return (
    <aside className="space-y-3">
      <h2 className="text-sm font-semibold">Categorias</h2>
      <ul className="space-y-1">
        <li>
          <button onClick={() => onSelect('')} className={cn('w-full rounded-lg px-3 py-2 text-left text-sm', selected === '' ? 'bg-brand-500/10 text-brand-600' : 'hover:bg-surface-2')}>
            Todos os produtos
          </button>
        </li>
        {data?.map((category) => (
          <li key={category.id} className="group flex items-center">
            <button
              onClick={() => onSelect(category.id)}
              className={cn('flex-1 rounded-lg px-3 py-2 text-left text-sm', selected === category.id ? 'bg-brand-500/10 text-brand-600' : 'hover:bg-surface-2')}
            >
              {category.name} <span className="text-xs text-muted">({category._count.products})</span>
            </button>
            {manage && (
              <button onClick={() => setRemoving(category)} className="rounded p-1 text-muted opacity-0 hover:text-danger group-hover:opacity-100" aria-label={`Remover ${category.name}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {manage && (
        <form onSubmit={submit} className="flex gap-2">
          <Input aria-label="Nova categoria" placeholder="Nova categoria" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" size="sm" className="mt-0.5 h-10" loading={create.isPending} aria-label="Adicionar categoria">
            <Plus className="h-4 w-4" />
          </Button>
        </form>
      )}
      {removing && (
        <ConfirmDialog
          open
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api.delete(`${base}/${removing.id}`);
            toast.success('Categoria removida.');
            if (selected === removing.id) onSelect('');
          }}
          title={`Remover "${removing.name}"?`}
          description="Só é possível remover categorias sem produtos."
          confirmLabel="Remover"
          tone="danger"
        />
      )}
    </aside>
  );
}

export default function CatalogPage() {
  const { company, can } = useCompany();
  const toast = useToast();
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ProductView | 'new' | null>(null);
  const [removing, setRemoving] = useState<ProductView | null>(null);
  const base = `companies/${company.id}`;
  const products = useApi<Paginated<ProductView>>(`${base}/products`, { categoryId, search, status, page, pageSize: 20 });
  const all = useApi<Paginated<ProductView>>(`${base}/products`, { pageSize: 100 });
  const categories = useApi<Category[]>(`${base}/categories`);
  const manage = can('company.products.manage');

  const refresh = () => {
    void products.refetch();
    void all.refetch();
    void categories.refetch();
  };

  /** Destaque na tela inicial do app (o limite por loja é validado pela API). */
  const featuredCount = (all.data?.data ?? []).filter((product) => product.isFeatured).length;
  const toggleFeatured = async (product: ProductView) => {
    try {
      await api.patch(`${base}/products/${product.id}`, { isFeatured: !product.isFeatured });
      toast.success(product.isFeatured ? 'Destaque removido.' : product.images.length ? 'Produto em destaque na tela inicial do app.' : 'Produto em destaque. Adicione uma foto para ele aparecer na tela inicial do app.');
      refresh();
    } catch (error) {
      toast.error(error);
    }
  };

  /** Duplica o produto (a cópia nasce inativa, logo abaixo do original) e já abre a cópia para editar. */
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const duplicate = async (product: ProductView) => {
    setDuplicating(product.id);
    try {
      const copy = await api.post<ProductView>(`${base}/products/${product.id}/duplicate`);
      toast.success('Cópia criada (inativa). Ajuste o que mudar e marque "Produto ativo" para publicar.');
      refresh();
      setEditing(copy);
    } catch (error) {
      toast.error(error);
    } finally {
      setDuplicating(null);
    }
  };

  const [stockOf, setStockOf] = useState<ProductView | null>(null);
  const [stockForm, setStockForm] = useState({ delta: '', reason: '' });
  const adjustStock = (product: ProductView) => {
    setStockForm({ delta: '', reason: '' });
    setStockOf(product);
  };
  const saveStock = async () => {
    if (!stockOf) return;
    const delta = Number(stockForm.delta);
    if (!Number.isInteger(delta) || delta === 0) throw new Error('Informe um número inteiro diferente de zero (ex.: 10 ou -3).');
    await api.post(`${base}/products/${stockOf.id}/stock`, { delta, reason: stockForm.reason || 'Ajuste manual pelo portal' });
    toast.success('Estoque atualizado.');
    refresh();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <Categories selected={categoryId} onSelect={(id) => { setCategoryId(id); setPage(1); }} />
      <div>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <Input className="sm:max-w-xs" aria-label="Buscar" placeholder="Buscar por nome, SKU ou código de barras" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <Select
            className="sm:w-40"
            aria-label="Status"
            value={status}
            placeholder="Todos"
            options={[
              { value: 'ACTIVE', label: 'Ativos' },
              { value: 'INACTIVE', label: 'Inativos' },
            ]}
            onChange={(e) => setStatus(e.target.value)}
          />
          {manage && (
            <Button className="sm:ml-auto" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
              Novo produto
            </Button>
          )}
        </div>
        {manage && !!all.data?.data.length && (
          <p className="mb-4 flex items-center gap-2 rounded-xl border border-gema/50 bg-gema/10 px-4 py-2.5 text-sm text-fg">
            <Star className="h-4 w-4 shrink-0 fill-gema text-gema" aria-hidden />
            <span>
              <strong>Destaques: {featuredCount} de 3.</strong> Só os produtos em destaque aparecem na tela inicial do app (com foto grande, sua loja e seus cupons); os demais ficam no cardápio da loja. Clique na estrela para destacar — o produto precisa ter foto.
            </span>
          </p>
        )}
        {products.isLoading && <SkeletonRows />}
        {products.error && <ErrorState error={products.error} onRetry={() => products.refetch()} />}
        {products.data?.data.length === 0 && (
          <EmptyState icon={<Package className="h-8 w-8" />} title="Nenhum produto" description="Cadastre produtos para começar a vender." />
        )}
        {!!products.data?.data.length && (
          <>
            <DataTable
              rows={products.data.data}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: 'name',
                  header: 'Produto',
                  cell: (row) => (
                    <div className="flex items-center gap-3">
                      {row.images[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={row.images[0].url} alt="" className="h-10 w-10 rounded-lg object-cover" />
                      ) : (
                        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2 text-muted">
                          <Package className="h-4 w-4" />
                        </span>
                      )}
                      <div>
                        <p className="font-medium">{row.name}</p>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {row.isFeatured && <Badge tone="warning">★ Destaque</Badge>}
                          {row.type === 'COMBO' && <Badge tone="info">Combo</Badge>}
                          {row.onSale && <Badge tone="brand">Promoção</Badge>}
                          {row.requiresPrescription && <Badge tone="warning">Receita</Badge>}
                          {row.minimumAge && <Badge tone="warning">+{row.minimumAge}</Badge>}
                          {row.status === 'INACTIVE' && <Badge>Inativo</Badge>}
                          {row.status === 'ACTIVE' && !row.available && <Badge tone="danger">Indisponível</Badge>}
                        </div>
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'price',
                  header: 'Preço',
                  cell: (row) =>
                    row.onSale ? (
                      <span>
                        <span className="text-xs text-muted line-through">{formatBRL(row.priceCents)}</span> <strong>{formatBRL(row.effectivePriceCents)}</strong>
                      </span>
                    ) : (
                      formatBRL(row.priceCents)
                    ),
                },
                {
                  key: 'stock',
                  header: 'Estoque',
                  hideOnMobile: true,
                  cell: (row) =>
                    row.trackStock ? (
                      <button disabled={!manage} onClick={() => adjustStock(row)} className={cn('tabular-nums hover:underline', row.stockQuantity <= 5 && 'font-semibold text-danger')}>
                        {row.stockQuantity} un.
                      </button>
                    ) : (
                      <span className="text-muted">—</span>
                    ),
                },
                {
                  key: 'actions',
                  header: '',
                  className: 'text-right',
                  cell: (row) =>
                    manage && (
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => toggleFeatured(row)}
                          className="rounded-lg p-2 text-muted hover:bg-surface-2"
                          aria-pressed={row.isFeatured}
                          aria-label={row.isFeatured ? 'Tirar destaque' : 'Destacar na tela inicial do app'}
                          title={row.isFeatured ? 'Tirar destaque' : 'Destacar na tela inicial do app'}
                        >
                          <Star className={cn('h-4 w-4', row.isFeatured && 'fill-gema text-gema')} />
                        </button>
                        <button
                          onClick={() => duplicate(row)}
                          disabled={duplicating !== null}
                          className="rounded-lg p-2 text-muted hover:bg-surface-2 disabled:opacity-50"
                          aria-label="Duplicar produto"
                          title="Duplicar produto"
                        >
                          <Copy className={cn('h-4 w-4', duplicating === row.id && 'animate-pulse text-brand-500')} />
                        </button>
                        <button onClick={() => setEditing(row)} className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label="Editar">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => setRemoving(row)} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-danger" aria-label="Excluir">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ),
                },
              ]}
            />
            <Pagination page={products.data.meta.page} totalPages={products.data.meta.totalPages} total={products.data.meta.total} onChange={setPage} />
          </>
        )}
      </div>
      {editing && (
        <ProductEditor
          companyId={company.id}
          product={editing === 'new' ? null : editing}
          categories={categories.data ?? []}
          products={all.data?.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
      {stockOf && (
        <Dialog
          open
          onClose={() => setStockOf(null)}
          size="sm"
          title={`Estoque: ${stockOf.name}`}
          description={`Quantidade atual: ${stockOf.stockQuantity} un.`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setStockOf(null)}>
                Cancelar
              </Button>
              <Button onClick={() => saveStock().then(() => setStockOf(null)).catch(toast.error)}>Salvar</Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input label="Entrada (+) ou saída (−)" type="number" placeholder="Ex.: 10 ou -3" value={stockForm.delta} onChange={(e) => setStockForm({ ...stockForm, delta: e.target.value })} autoFocus />
            <Input label="Motivo" placeholder="Compra, perda, inventário..." value={stockForm.reason} onChange={(e) => setStockForm({ ...stockForm, reason: e.target.value })} />
          </div>
        </Dialog>
      )}
      {removing && (
        <ConfirmDialog
          open
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api.delete(`${base}/products/${removing.id}`);
            toast.success('Produto excluído.');
            refresh();
          }}
          title={`Excluir "${removing.name}"?`}
          description="O produto sai da loja. Pedidos antigos continuam com o registro."
          confirmLabel="Excluir"
          tone="danger"
        />
      )}
    </div>
  );
}
