import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LatLng } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { isWithinOpeningHours } from '../../common/opening-hours';
import { formatLocalDate } from '../../common/time-range';
import { paginated } from '../../common/pagination';
import type { AuthUser } from '../../common/auth/auth-user';
import { CatalogService, FEATURED_PER_STORE, productInclude } from './catalog.service';
import { ServiceAreasService } from './service-areas.service';
import { StoresQueryDto } from './catalog.dto';
import { Prisma } from '../../generated/prisma/client';

/** Velocidade média para a estimativa de tempo na listagem (sem chamar o provedor de rotas). */
const LIST_SPEED_KMH = 22;
/** Pré-filtro geográfico (~55 km) antes de verificar a cobertura exata. */
const BOUNDING_DEGREES = 0.5;

/**
 * Vitrine pública: estabelecimentos aprovados que atendem o endereço do cliente,
 * com status de funcionamento, distância e tempo estimado.
 */
@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly catalog: CatalogService,
    private readonly areas: ServiceAreasService,
  ) {}

  async resolveLocation(user: AuthUser | undefined, query: StoresQueryDto): Promise<{ point: LatLng | null; district?: string; city?: string; state?: string }> {
    if (query.addressId) {
      if (!user) throw new BadRequestException('Entre na sua conta para usar um endereço salvo.');
      const address = await this.prisma.address.findFirst({ where: { id: query.addressId, userId: user.userId, deletedAt: null } });
      if (!address) throw new NotFoundException('Endereço não encontrado.');
      return {
        point: address.lat != null && address.lng != null ? { lat: address.lat, lng: address.lng } : null,
        district: address.district,
        city: address.city,
        state: address.state,
      };
    }
    return { point: query.lat != null && query.lng != null ? { lat: query.lat, lng: query.lng } : null };
  }

  /**
   * `only`: uso interno (favoritos e promoções da Home) — restringe às lojas informadas e,
   * com `includeUncovered`, mantém as que não atendem o endereço (marcadas com `covered: false`).
   */
  async list(tenantId: string, user: AuthUser | undefined, query: StoresQueryDto, only?: { companyIds: string[]; includeUncovered?: boolean }) {
    const location = await this.resolveLocation(user, query);
    const includeUncovered = !!only?.includeUncovered;
    const where: Prisma.CompanyWhereInput = {
      tenantId,
      status: 'APPROVED',
      ...(only ? { id: { in: only.companyIds } } : {}),
      segment: query.segment ? { slug: query.segment, isActive: true } : { isActive: true },
      ...(query.search
        ? {
            OR: [
              { tradeName: { contains: query.search, mode: 'insensitive' } },
              { products: { some: { name: { contains: query.search, mode: 'insensitive' }, status: 'ACTIVE', deletedAt: null } } },
            ],
          }
        : {}),
      ...(includeUncovered
        ? {}
        : location.point
          ? {
            address: {
              lat: { gte: location.point.lat - BOUNDING_DEGREES, lte: location.point.lat + BOUNDING_DEGREES },
              lng: { gte: location.point.lng - BOUNDING_DEGREES, lte: location.point.lng + BOUNDING_DEGREES },
            },
          }
          : location.city
            ? { address: { city: { equals: location.city, mode: 'insensitive' } } }
            : {}),
    };

    const companies = await this.prisma.company.findMany({
      where,
      take: 500,
      include: {
        address: true,
        segment: { select: { slug: true, name: true } },
        openingHours: true,
        serviceAreas: { where: { isActive: true }, orderBy: { createdAt: 'asc' } },
      },
    });

    const now = new Date();
    const rows = [];
    for (const company of companies) {
      const hasLocation = !!(location.point || location.city);
      const coverage = hasLocation ? await this.areas.coverage(company, location, company.serviceAreas) : null;
      if (coverage && !coverage.covered && !includeUncovered) continue;
      const distanceKm = coverage?.straightKm ?? null;
      const travelMin = distanceKm != null ? Math.round((distanceKm * 1.35 * 60) / LIST_SPEED_KMH) : null;
      const openNow = company.isOpen && isWithinOpeningHours(company.openingHours, now, company.timezone);
      rows.push({
        id: company.id,
        slug: company.slug,
        tradeName: company.tradeName,
        description: company.description,
        logoUrl: this.storage.publicUrl(company.logoKey),
        bannerUrl: this.storage.publicUrl(company.bannerKey),
        segment: company.segment,
        ratingAvg: company.ratingAvg,
        ratingCount: company.ratingCount,
        isOpenNow: openNow,
        minimumOrderCents: coverage?.area?.minimumOrderCents ?? company.minimumOrderCents,
        distanceKm: distanceKm != null ? Math.round(distanceKm * 10) / 10 : null,
        estimatedMinutes: travelMin != null ? { min: company.averagePrepMinutes + travelMin, max: company.averagePrepMinutes + travelMin + 15 } : null,
        city: company.address?.city ?? null,
        covered: coverage ? coverage.covered : true,
      });
    }

    rows.sort((a, b) => {
      if (a.covered !== b.covered) return a.covered ? -1 : 1;
      if (a.isOpenNow !== b.isOpenNow) return a.isOpenNow ? -1 : 1;
      if (query.sort === 'rating') return b.ratingAvg - a.ratingAvg;
      return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
    });
    const start = (query.page - 1) * query.pageSize;
    return paginated(rows.slice(start, start + query.pageSize), rows.length, query);
  }

  /**
   * Vitrine da tela inicial do app: SÓ os produtos em destaque (escolhidos pela loja no catálogo,
   * até FEATURED_PER_STORE por loja). Os demais produtos ficam apenas no cardápio da loja.
   *
   * Regras:
   * - só lojas que aparecem na listagem para este endereço (aprovadas, segmento ativo, área de entrega cobrindo o cliente);
   * - só produtos em destaque, ativos, disponíveis (estoque) e COM FOTO;
   * - lojas abertas antes das fechadas; dentro de cada grupo as lojas seguem a ordem da listagem
   *   (distância/avaliação) e os destaques se revezam entre elas (1º de cada loja, depois o 2º...),
   *   para uma loja não ocupar a tela inteira;
   * - dentro da loja: promoção vigente, depois os mais vendidos nos últimos 30 dias, depois a ordem do
   *   cardápio e, por fim, o maior preço.
   */
  async productFeed(tenantId: string, user: AuthUser | undefined, query: StoresQueryDto) {
    const stores = (await this.list(tenantId, user, { ...query, search: undefined, page: 1, pageSize: 500 })).data;
    if (!stores.length) return paginated([], 0, query);
    const search = query.search?.trim();

    const products = await this.prisma.product.findMany({
      where: {
        companyId: { in: stores.map((store) => store.id) },
        isFeatured: true,
        status: 'ACTIVE',
        deletedAt: null,
        images: { some: {} },
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
                { company: { tradeName: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: productInclude,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: 2000,
    });

    const since = new Date(Date.now() - 30 * 86_400_000);
    const sales = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      where: { productId: { in: products.map((product) => product.id) }, order: { status: 'DELIVERED', createdAt: { gte: since } } },
      _sum: { quantity: true },
    });
    const sold = new Map(sales.map((row) => [row.productId, row._sum.quantity ?? 0]));

    type View = ReturnType<CatalogService['toView']>;
    const byStore = new Map<string, View[]>();
    for (const product of products) {
      const view = this.catalog.toView(product);
      if (!view.available) continue;
      byStore.set(product.companyId, [...(byStore.get(product.companyId) ?? []), view]);
    }
    for (const list of byStore.values()) {
      list.sort((a, b) => Number(b.onSale) - Number(a.onSale) || (sold.get(b.id) ?? 0) - (sold.get(a.id) ?? 0) || a.sortOrder - b.sortOrder || b.effectivePriceCents - a.effectivePriceCents);
    }

    const interleave = (group: typeof stores) => {
      const rows: { product: View; store: (typeof stores)[number] }[] = [];
      for (let round = 0; round < FEATURED_PER_STORE; round++) {
        for (const store of group) {
          const product = byStore.get(store.id)?.[round];
          if (product) rows.push({ product, store });
        }
      }
      return rows;
    };
    const rows = [...interleave(stores.filter((store) => store.isOpenNow)), ...interleave(stores.filter((store) => !store.isOpenNow))];

    const start = (query.page - 1) * query.pageSize;
    return paginated(
      rows.slice(start, start + query.pageSize).map(({ product, store }) => ({
        product,
        store: {
          id: store.id,
          slug: store.slug,
          tradeName: store.tradeName,
          logoUrl: store.logoUrl,
          segment: store.segment,
          isOpenNow: store.isOpenNow,
          ratingAvg: store.ratingAvg,
          ratingCount: store.ratingCount,
          estimatedMinutes: store.estimatedMinutes,
          distanceKm: store.distanceKm,
        },
      })),
      rows.length,
      query,
    );
  }

  /** Visitas diárias à loja (base da taxa de conversão) — contagem agregada, sem identificar o visitante. */
  private countVisit(companyId: string, timeZone: string) {
    const day = formatLocalDate(new Date(), timeZone);
    this.prisma.$executeRaw`
      INSERT INTO store_visits_daily ("companyId", day, visits) VALUES (${companyId}::uuid, ${day}::date, 1)
      ON CONFLICT ("companyId", day) DO UPDATE SET visits = store_visits_daily.visits + 1`.catch(() => undefined);
  }

  async detail(tenantId: string, idOrSlug: string) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
    const company = await this.prisma.company.findFirst({
      where: { tenantId, status: 'APPROVED', ...(isUuid ? { id: idOrSlug } : { slug: idOrSlug }) },
      include: {
        address: { select: { district: true, city: true, state: true, lat: true, lng: true } },
        segment: { select: { slug: true, name: true, isRegulated: true, minimumAge: true } },
        openingHours: { orderBy: [{ weekday: 'asc' }, { opensAt: 'asc' }] },
        categories: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
        products: {
          where: { status: 'ACTIVE', deletedAt: null },
          include: productInclude,
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        },
      },
    });
    if (!company) throw new NotFoundException('Loja não encontrada.');
    this.countVisit(company.id, company.timezone);
    const products = company.products.map((product) => this.catalog.toView(product));
    return {
      id: company.id,
      slug: company.slug,
      tradeName: company.tradeName,
      description: company.description,
      logoUrl: this.storage.publicUrl(company.logoKey),
      bannerUrl: this.storage.publicUrl(company.bannerKey),
      brandColor: company.brandColor,
      segment: company.segment,
      address: company.address,
      openingHours: company.openingHours.map(({ weekday, opensAt, closesAt }) => ({ weekday, opensAt, closesAt })),
      isOpenNow: company.isOpen && isWithinOpeningHours(company.openingHours, new Date(), company.timezone),
      averagePrepMinutes: company.averagePrepMinutes,
      minimumOrderCents: company.minimumOrderCents,
      ratingAvg: company.ratingAvg,
      ratingCount: company.ratingCount,
      categories: company.categories.map((category) => ({
        id: category.id,
        parentId: category.parentId,
        name: category.name,
        description: category.description,
        products: products.filter((product) => product.categoryId === category.id),
      })),
      uncategorized: products.filter((product) => !product.categoryId || !company.categories.some((c) => c.id === product.categoryId)),
    };
  }
}
