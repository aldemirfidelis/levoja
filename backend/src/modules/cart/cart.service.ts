import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { productInclude } from '../catalog/catalog.service';
import { priceLine } from './line-pricing';

const MAX_QUANTITY = 99;
const MAX_LINES = 50;

export const cartInclude = {
  company: { select: { id: true, tenantId: true, tradeName: true, slug: true, logoKey: true, minimumOrderCents: true, status: true } },
  items: { orderBy: { createdAt: 'asc' }, include: { product: { include: productInclude } } },
} as const;

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  customerId(user: AuthUser): string {
    if (!user.customerId) throw new ForbiddenException('Perfil de cliente não encontrado.');
    return user.customerId;
  }

  async listCarts(user: AuthUser) {
    const carts = await this.prisma.cart.findMany({
      where: { customerId: this.customerId(user), items: { some: {} } },
      include: cartInclude,
      orderBy: { updatedAt: 'desc' },
    });
    return carts.map((cart) => this.toView(cart));
  }

  async getCart(user: AuthUser, companyId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { customerId_companyId: { customerId: this.customerId(user), companyId } },
      include: cartInclude,
    });
    if (!cart) return { companyId, items: [], subtotalCents: 0, itemsCount: 0, hasIssues: false };
    return this.toView(cart);
  }

  async addItem(user: AuthUser, input: { productId: string; quantity: number; optionIds?: string[]; notes?: string }) {
    const customerId = this.customerId(user);
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, tenantId: user.tenantId, deletedAt: null },
      include: { ...productInclude, company: { select: { id: true, status: true } } },
    });
    if (!product || product.company.status !== 'APPROVED') throw new NotFoundException('Produto não encontrado.');
    const optionIds = input.optionIds ?? [];
    const priced = priceLine(product, optionIds);
    if (priced.issues.length) throw new BadRequestException({ message: priced.issues[0], details: priced.issues });

    const cart = await this.prisma.cart.upsert({
      where: { customerId_companyId: { customerId, companyId: product.companyId } },
      create: { tenantId: user.tenantId, customerId, companyId: product.companyId },
      update: {},
      include: { items: true },
    });
    const sortedIds = [...optionIds].sort();
    const notes = input.notes?.trim() || null;
    // Mesmo produto, mesmas opções e mesma observação = mesma linha (soma a quantidade).
    const same = cart.items.find(
      (item) => item.productId === product.id && [...item.optionIds].sort().join() === sortedIds.join() && (item.notes ?? null) === notes,
    );
    if (same) {
      await this.prisma.cartItem.update({ where: { id: same.id }, data: { quantity: Math.min(MAX_QUANTITY, same.quantity + input.quantity) } });
    } else {
      if (cart.items.length >= MAX_LINES) throw new BadRequestException('Carrinho cheio.');
      await this.prisma.cartItem.create({ data: { cartId: cart.id, productId: product.id, quantity: input.quantity, optionIds: sortedIds, notes } });
    }
    await this.prisma.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });
    return this.getCart(user, product.companyId);
  }

  async updateItem(user: AuthUser, itemId: string, input: { quantity?: number; notes?: string }) {
    const item = await this.findItem(user, itemId);
    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity: input.quantity, notes: input.notes === undefined ? undefined : input.notes.trim() || null },
    });
    return this.getCart(user, item.cart.companyId);
  }

  async removeItem(user: AuthUser, itemId: string) {
    const item = await this.findItem(user, itemId);
    await this.prisma.cartItem.delete({ where: { id: itemId } });
    return this.getCart(user, item.cart.companyId);
  }

  async clear(user: AuthUser, companyId: string) {
    await this.prisma.cart.deleteMany({ where: { customerId: this.customerId(user), companyId } });
  }

  private async findItem(user: AuthUser, itemId: string) {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cart: { customerId: this.customerId(user) } },
      include: { cart: { select: { companyId: true } } },
    });
    if (!item) throw new NotFoundException('Item não encontrado no carrinho.');
    return item;
  }

  toView(cart: { companyId: string; company: { id: string; tradeName: string; slug: string; logoKey: string | null; minimumOrderCents: number }; items: any[] }) {
    const items = cart.items.map((item) => {
      const priced = priceLine(item.product, item.optionIds);
      return {
        id: item.id,
        productId: item.productId,
        name: item.product.name,
        imageUrl: item.product.images[0] ? this.storage.publicUrl(item.product.images[0].fileKey) : null,
        quantity: item.quantity,
        notes: item.notes,
        optionIds: item.optionIds,
        options: priced.options,
        unitPriceCents: priced.unitPriceCents,
        totalCents: priced.unitPriceCents * item.quantity,
        requiresPrescription: item.product.requiresPrescription,
        minimumAge: item.product.minimumAge,
        issues: priced.issues,
      };
    });
    const valid = items.filter((item) => item.issues.length === 0);
    return {
      companyId: cart.companyId,
      company: { id: cart.company.id, tradeName: cart.company.tradeName, slug: cart.company.slug, logoUrl: this.storage.publicUrl(cart.company.logoKey) },
      minimumOrderCents: cart.company.minimumOrderCents,
      items,
      itemsCount: items.reduce((sum, item) => sum + item.quantity, 0),
      subtotalCents: valid.reduce((sum, item) => sum + item.totalCents, 0),
      hasIssues: items.some((item) => item.issues.length > 0),
      requiresPrescription: items.some((item) => item.requiresPrescription),
    };
  }
}
