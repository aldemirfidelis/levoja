import { Clock, MapPin, Smartphone, Star } from 'lucide-react';
import { formatBRL, isHexColor } from '@levoja/shared';
import { brandCss } from '@levoja/web-kit/brand';

export interface PublicStore {
  id: string;
  slug: string;
  tradeName: string;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  brandColor: string | null;
  address: { district: string | null; city: string; state: string } | null;
  openingHours: { weekday: number; opensAt: string; closesAt: string }[];
  isOpenNow: boolean;
  averagePrepMinutes: number;
  minimumOrderCents: number;
  ratingAvg: number;
  ratingCount: number;
  categories: { id: string; name: string; products: StoreProduct[] }[];
  uncategorized: StoreProduct[];
}

interface StoreProduct {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  effectivePriceCents: number;
  onSale: boolean;
  images: { url: string | null }[];
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/**
 * Página pública da loja (marca própria): cardápio, horários e convite para pedir pelo app.
 * Com cor de marca definida, a paleta da página usa a cor da loja.
 */
export function StorePage({ store, appName, appScheme }: { store: PublicStore; appName: string; appScheme: string }) {
  const color = store.brandColor && isHexColor(store.brandColor) ? store.brandColor : null;
  const css = color ? brandCss(color) : '';
  const products = [...store.categories, ...(store.uncategorized.length ? [{ id: 'outros', name: 'Outros', products: store.uncategorized }] : [])].filter((category) => category.products.length);
  return (
    <div className="min-h-screen bg-bg">
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      <header className="bg-brand-500 text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-8 sm:px-6">
          {store.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={store.logoUrl} alt="" className="h-16 w-16 rounded-full bg-white object-cover" />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-extrabold">{store.tradeName}</h1>
            {store.description && <p className="mt-1 text-white/90">{store.description}</p>}
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/90">
              {store.address && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-4 w-4" aria-hidden /> {store.address.district ? `${store.address.district}, ` : ''}
                  {store.address.city}/{store.address.state}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Clock className="h-4 w-4" aria-hidden /> {store.isOpenNow ? `Aberto agora · preparo ~${store.averagePrepMinutes} min` : 'Fechado agora'}
              </span>
              {store.ratingCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Star className="h-4 w-4" aria-hidden /> {store.ratingAvg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ({store.ratingCount})
                </span>
              )}
            </p>
          </div>
          <a href={`${appScheme}://loja/${store.id}`} className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 font-semibold text-brand-600 shadow-sm">
            <Smartphone className="h-4 w-4" aria-hidden /> Pedir pelo app
          </a>
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_16rem]">
        <div className="space-y-8">
          {products.length === 0 && <p className="text-muted">O cardápio está sendo atualizado.</p>}
          {products.map((category) => (
            <section key={category.id} aria-labelledby={`categoria-${category.id}`}>
              <h2 id={`categoria-${category.id}`} className="mb-3 text-xl font-bold text-fg">
                {category.name}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {category.products.map((product) => {
                  const image = product.images[0]?.url ?? null;
                  const promo = product.onSale;
                  return (
                    <li key={product.id} className="flex gap-3 rounded-xl border border-border bg-surface p-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-fg">{product.name}</p>
                        {product.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{product.description}</p>}
                        <p className="mt-2 text-sm font-semibold text-fg">
                          {promo ? (
                            <>
                              <span className="mr-2 text-muted line-through">{formatBRL(product.priceCents)}</span>
                              <span className="text-brand-600">{formatBRL(product.effectivePriceCents)}</span>
                            </>
                          ) : (
                            formatBRL(product.priceCents)
                          )}
                        </p>
                      </div>
                      {image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={image} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover" />
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <aside className="space-y-4 text-sm">
          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-2 font-semibold text-fg">Horários</h2>
            <ul className="space-y-1 text-muted">
              {store.openingHours.map((slot, index) => (
                <li key={index} className="flex justify-between gap-2">
                  <span>{WEEKDAYS[slot.weekday]}</span>
                  <span className="tabular-nums">
                    {slot.opensAt}–{slot.closesAt}
                  </span>
                </li>
              ))}
            </ul>
            {store.minimumOrderCents > 0 && <p className="mt-3 text-muted">Pedido mínimo: {formatBRL(store.minimumOrderCents)}</p>}
          </div>
          <p className="text-xs text-muted">Pedidos, pagamento e entrega pelo app {appName}.</p>
        </aside>
      </main>
    </div>
  );
}
