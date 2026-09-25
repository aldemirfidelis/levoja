import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { tierRank } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { SettingsService } from '../settings/settings.service';
import { StoresService } from '../catalog/stores.service';
import { StoresQueryDto } from '../catalog/catalog.dto';
import { CartService } from '../cart/cart.service';
import type { AuthUser } from '../../common/auth/auth-user';
import type { Coupon } from '../../generated/prisma/client';

const HOME_FAVORITES = 10;
const HOME_ORDERS = 5;

/**
 * Home do cliente: lojas favoritas, promoções das lojas que atendem o endereço, cupons disponíveis
 * (públicos e exclusivos do nível de fidelidade), pedidos recentes com "pedir de novo" e resumo
 * de fidelidade/indicação.
 */
@Injectable()
export class CustomerHomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly stores: StoresService,
    private readonly cart: CartService,
  ) {}

  private customerId(user: AuthUser): string {
    if (!user.customerId) throw new ForbiddenException('Disponível para clientes.');
    return user.customerId;
  }

  // ---------------------------------------------------------------------------
  // Favoritos
  // ---------------------------------------------------------------------------

  async favoriteIds(user: AuthUser): Promise<string[]> {
    const rows = await this.prisma.favoriteStore.findMany({ where: { customerId: this.customerId(user) }, orderBy: { createdAt: 'desc' }, select: { companyId: true } });
    return rows.map((row) => row.companyId);
  }

  async favorites(user: AuthUser, query: StoresQueryDto) {
    const ids = await this.favoriteIds(user);
    if (!ids.length) return [];
    const listed = await this.stores.list(user.tenantId, user, { ...query, page: 1, pageSize: 100, segment: undefined, search: undefined } as StoresQueryDto, { companyIds: ids, includeUncovered: true });
    // Mesma ordem em que foram favoritadas (mais recentes primeiro), lojas que atendem o endereço antes.
    return [...listed.data].sort((a, b) => (a.covered === b.covered ? ids.indexOf(a.id) - ids.indexOf(b.id) : a.covered ? -1 : 1));
  }

  async addFavorite(user: AuthUser, companyId: string) {
    const customerId = this.customerId(user);
    const company = await this.prisma.company.findFirst({ where: { id: companyId, tenantId: user.tenantId, status: 'APPROVED' }, select: { id: true } });
    if (!company) throw new NotFoundException('Loja não encontrada.');
    await this.prisma.favoriteStore.upsert({ where: { customerId_companyId: { customerId, companyId } }, create: { customerId, companyId }, update: {} });
  }

  async removeFavorite(user: AuthUser, companyId: string) {
    await this.prisma.favoriteStore.deleteMany({ where: { customerId: this.customerId(user), companyId } });
  }

  // ---------------------------------------------------------------------------
  // Cupons disponíveis
  // ---------------------------------------------------------------------------

  /** Cupons listáveis (públicos e de nível) válidos agora, com o que falta para usar. */
  async coupons(user: AuthUser, now = new Date()) {
    const customerId = this.customerId(user);
    const listed = await this.prisma.coupon.findMany({
      where: {
        tenantId: user.tenantId,
        isActive: true,
        visibility: { in: ['PUBLIC', 'TIER'] },
        AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
      },
      orderBy: [{ endsAt: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });
    const available = listed.filter((coupon) => coupon.maxRedemptions == null || coupon.redemptions < coupon.maxRedemptions);
    if (!available.length) return [];
    const [used, previousOrders, companies, segments, loyalty, account] = await Promise.all([
      this.prisma.couponRedemption.groupBy({ by: ['couponId'], where: { customerId, couponId: { in: available.map((coupon) => coupon.id) } }, _count: { _all: true } }),
      this.prisma.order.count({ where: { customerId, status: { not: 'CANCELED' } } }),
      this.prisma.company.findMany({
        where: { id: { in: available.map((coupon) => coupon.companyId).filter((id): id is string => !!id) }, status: 'APPROVED' },
        select: { id: true, slug: true, tradeName: true, logoKey: true },
      }),
      this.prisma.segment.findMany({ where: { id: { in: available.map((coupon) => coupon.segmentId).filter((id): id is string => !!id) } }, select: { id: true, name: true, slug: true } }),
      this.settings.get(user.tenantId, 'loyalty'),
      this.prisma.loyaltyAccount.findUnique({ where: { customerId }, select: { tier: true } }),
    ]);
    const usedCount = new Map(used.map((row) => [row.couponId, row._count._all]));
    const companyById = new Map(companies.map((company) => [company.id, company]));
    const segmentById = new Map(segments.map((segment) => [segment.id, segment]));
    const tiers = [...loyalty.tiers].sort((a, b) => a.minPoints - b.minPoints);
    const currentTier = account?.tier ?? tiers[0].key;

    const rows = [];
    for (const coupon of available) {
      const usesLeft = coupon.maxPerCustomer - (usedCount.get(coupon.id) ?? 0);
      if (usesLeft <= 0) continue;
      if (coupon.firstOrderOnly && previousOrders > 0) continue;
      if (coupon.companyId && !companyById.has(coupon.companyId)) continue;
      let locked: string | null = null;
      if (coupon.visibility === 'TIER') {
        if (!loyalty.enabled) continue;
        const required = tiers.find((tier) => tier.key === coupon.minTier);
        if (required && tierRank(currentTier, tiers) < tierRank(required.key, tiers)) locked = `Exclusivo do nível ${required.name}`;
      }
      rows.push(this.couponView(coupon, { usesLeft, locked, company: coupon.companyId ? companyById.get(coupon.companyId)! : null, segment: coupon.segmentId ? (segmentById.get(coupon.segmentId) ?? null) : null, tierName: tiers.find((tier) => tier.key === coupon.minTier)?.name ?? null }));
    }
    // Disponíveis primeiro; bloqueados por nível no fim (mostram o que falta).
    return rows.sort((a, b) => Number(!!a.locked) - Number(!!b.locked));
  }

  private couponView(
    coupon: Coupon,
    extra: { usesLeft: number; locked: string | null; company: { id: string; slug: string; tradeName: string; logoKey: string | null } | null; segment: { id: string; name: string; slug: string } | null; tierName: string | null },
  ) {
    return {
      id: coupon.id,
      code: coupon.code,
      description: coupon.description,
      type: coupon.type,
      percentBps: coupon.percentBps,
      amountCents: coupon.amountCents,
      maxDiscountCents: coupon.maxDiscountCents,
      minOrderCents: coupon.minOrderCents,
      firstOrderOnly: coupon.firstOrderOnly,
      weekdays: coupon.weekdays,
      fromTime: coupon.fromTime,
      toTime: coupon.toTime,
      endsAt: coupon.endsAt,
      visibility: coupon.visibility,
      minTier: coupon.minTier,
      minTierName: extra.tierName,
      usesLeft: extra.usesLeft,
      locked: extra.locked,
      store: extra.company ? { id: extra.company.id, slug: extra.company.slug, tradeName: extra.company.tradeName, logoUrl: this.storage.publicUrl(extra.company.logoKey) } : null,
      segment: extra.segment,
    };
  }

  // ---------------------------------------------------------------------------
  // Pedidos recentes e "pedir de novo"
  // ---------------------------------------------------------------------------

  async recentOrders(user: AuthUser, take = HOME_ORDERS) {
    const orders = await this.prisma.order.findMany({
      where: { customerId: this.customerId(user), status: { not: 'PENDING_PAYMENT' } },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        number: true,
        status: true,
        totalCents: true,
        createdAt: true,
        company: { select: { id: true, slug: true, tradeName: true, logoKey: true } },
        items: { select: { productName: true, quantity: true }, take: 3 },
      },
    });
    return orders.map((order) => ({
      id: order.id,
      number: order.number,
      status: order.status,
      totalCents: order.totalCents,
      createdAt: order.createdAt,
      store: { id: order.company.id, slug: order.company.slug, tradeName: order.company.tradeName, logoUrl: this.storage.publicUrl(order.company.logoKey) },
      summary: order.items.map((item) => `${item.quantity}x ${item.productName}`).join(', '),
    }));
  }

  /** Coloca no carrinho os itens de um pedido anterior que continuam disponíveis. */
  async reorder(user: AuthUser, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, customerId: this.customerId(user) }, select: { companyId: true, items: true } });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    const skipped: string[] = [];
    let added = 0;
    for (const item of order.items) {
      if (!item.productId) {
        skipped.push(item.productName);
        continue;
      }
      const optionIds = Array.isArray(item.options) ? (item.options as { optionId?: string }[]).map((option) => option.optionId).filter((id): id is string => !!id) : [];
      try {
        await this.cart.addItem(user, { productId: item.productId, quantity: item.quantity, optionIds, notes: item.notes ?? undefined });
        added += 1;
      } catch {
        skipped.push(item.productName);
      }
    }
    return { companyId: order.companyId, added, skipped, cart: await this.cart.getCart(user, order.companyId) };
  }

  // ---------------------------------------------------------------------------
  // Home
  // ---------------------------------------------------------------------------

  async home(user: AuthUser, query: StoresQueryDto) {
    const [favorites, coupons, recentOrders, loyaltyConfig, referralConfig, account] = await Promise.all([
      this.favorites(user, query),
      this.coupons(user),
      this.recentOrders(user),
      this.settings.get(user.tenantId, 'loyalty'),
      this.settings.get(user.tenantId, 'referral'),
      user.customerId ? this.prisma.loyaltyAccount.findUnique({ where: { customerId: user.customerId } }) : null,
    ]);
    // Promoções: lojas que atendem o endereço e têm cupom próprio listado.
    const storeCoupons = coupons.filter((coupon) => coupon.store && !coupon.locked);
    const promoStoreIds = [...new Set(storeCoupons.map((coupon) => coupon.store!.id))];
    const promoStores = promoStoreIds.length
      ? (await this.stores.list(user.tenantId, user, { ...query, page: 1, pageSize: 20, segment: undefined, search: undefined } as StoresQueryDto, { companyIds: promoStoreIds })).data
      : [];
    const promotions = promoStores.map((store) => ({ store, coupons: storeCoupons.filter((coupon) => coupon.store!.id === store.id) }));
    const tiers = [...loyaltyConfig.tiers].sort((a, b) => a.minPoints - b.minPoints);
    const tier = tiers.find((row) => row.key === account?.tier) ?? tiers[0];
    return {
      favorites: favorites.slice(0, HOME_FAVORITES),
      promotions,
      coupons: coupons.filter((coupon) => !coupon.store).slice(0, 10),
      recentOrders,
      loyalty: loyaltyConfig.enabled ? { points: account?.points ?? 0, tier: { key: tier.key, name: tier.name }, redeemableCents: Math.floor((account?.points ?? 0) * loyaltyConfig.pointValueCents) } : null,
      referral: referralConfig.enabled && referralConfig.customer.enabled ? { referrerRewardCents: referralConfig.customer.referrerRewardCents, referredRewardCents: referralConfig.customer.referredRewardCents } : null,
    };
  }
}
