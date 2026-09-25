import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LatLng } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { isWithinOpeningHours } from '../../common/opening-hours';
import { formatLocalDate } from '../../common/time-range';
import { paginated } from '../../common/pagination';
import type { AuthUser } from '../../common/auth/auth-user';
import { CatalogService, productInclude } from './catalog.service';
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

  async list(tenantId: string, user: AuthUser | undefined, query: StoresQueryDto) {
    const location = await this.resolveLocation(user, query);
    const where: Prisma.CompanyWhereInput = {
      tenantId,
      status: 'APPROVED',
      segment: query.segment ? { slug: query.segment, isActive: true } : { isActive: true },
      ...(query.search
        ? {
            OR: [
              { tradeName: { contains: query.search, mode: 'insensitive' } },
              { products: { some: { name: { contains: query.search, mode: 'insensitive' }, status: 'ACTIVE', deletedAt: null } } },
            ],
          }
        : {}),
      ...(location.point
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
      if (coverage && !coverage.covered) continue;
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
      });
    }

    rows.sort((a, b) => {
      if (a.isOpenNow !== b.isOpenNow) return a.isOpenNow ? -1 : 1;
      if (query.sort === 'rating') return b.ratingAvg - a.ratingAvg;
      return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
    });
    const start = (query.page - 1) * query.pageSize;
    return paginated(rows.slice(start, start + query.pageSize), rows.length, query);
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
