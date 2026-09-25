import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';
import { SubscriptionsService } from '../saas/subscriptions.service';
import { StorageService } from '../../infra/storage/storage.service';
import { UploadedFileLike, validateUpload } from '../../infra/storage/file-validation';
import { AuditService, diff } from '../audit/audit.service';
import { paginated, skipOf } from '../../common/pagination';
import { CategoryDto, ProductDto, ProductsQueryDto, UpdateCategoryDto, UpdateProductDto } from './catalog.dto';
import { Prisma } from '../../generated/prisma/client';

export const productInclude = {
  images: { orderBy: { sortOrder: 'asc' } },
  optionGroups: { orderBy: { sortOrder: 'asc' }, include: { options: { orderBy: { sortOrder: 'asc' } } } },
  comboItems: { include: { product: { select: { id: true, name: true, status: true, trackStock: true, stockQuantity: true, deletedAt: true } } } },
} satisfies Prisma.ProductInclude;

export type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

const MAX_IMAGES = 8;

/** Preço vigente: promocional dentro da janela de validade, senão o preço cheio. */
export function effectivePrice(product: { priceCents: number; promoPriceCents: number | null; promoStartsAt: Date | null; promoEndsAt: Date | null }, at = new Date()): number {
  const promoActive =
    product.promoPriceCents != null &&
    product.promoPriceCents < product.priceCents &&
    (!product.promoStartsAt || product.promoStartsAt <= at) &&
    (!product.promoEndsAt || product.promoEndsAt > at);
  return promoActive ? product.promoPriceCents! : product.priceCents;
}

/** Disponibilidade para venda (status, exclusão lógica, estoque e componentes do combo). */
export function isAvailable(product: ProductWithRelations): boolean {
  if (product.status !== 'ACTIVE' || product.deletedAt) return false;
  if (product.trackStock && product.stockQuantity <= 0) return false;
  if (product.type === 'COMBO') {
    return product.comboItems.every(
      (item) => item.product.status === 'ACTIVE' && !item.product.deletedAt && (!item.product.trackStock || item.product.stockQuantity >= item.quantity),
    );
  }
  return true;
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Categorias
  // ---------------------------------------------------------------------------

  listCategories(companyId: string) {
    return this.prisma.productCategory.findMany({
      where: { companyId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: { where: { deletedAt: null } } } } },
    });
  }

  async createCategory(companyId: string, dto: CategoryDto) {
    if (dto.parentId) await this.assertCategory(companyId, dto.parentId);
    const category = await this.prisma.productCategory.create({ data: { ...dto, companyId } });
    await this.audit.log({ action: 'catalog.category.create', entityType: 'ProductCategory', entityId: category.id, after: { ...dto } });
    return category;
  }

  async updateCategory(companyId: string, id: string, dto: UpdateCategoryDto) {
    const category = await this.assertCategory(companyId, id);
    if (dto.parentId) {
      if (dto.parentId === id) throw new BadRequestException('Uma categoria não pode ser pai de si mesma.');
      await this.assertCategory(companyId, dto.parentId);
    }
    const updated = await this.prisma.productCategory.update({ where: { id }, data: dto });
    await this.audit.log({ action: 'catalog.category.update', entityType: 'ProductCategory', entityId: id, ...diff(category, updated) });
    return updated;
  }

  async deleteCategory(companyId: string, id: string) {
    await this.assertCategory(companyId, id);
    const inUse = await this.prisma.product.count({ where: { categoryId: id, deletedAt: null } });
    if (inUse) throw new ConflictException('Mova ou exclua os produtos desta categoria antes de removê-la.');
    await this.prisma.productCategory.delete({ where: { id } });
    await this.audit.log({ action: 'catalog.category.delete', entityType: 'ProductCategory', entityId: id });
  }

  private async assertCategory(companyId: string, id: string) {
    const category = await this.prisma.productCategory.findFirst({ where: { id, companyId } });
    if (!category) throw new NotFoundException('Categoria não encontrada.');
    return category;
  }

  // ---------------------------------------------------------------------------
  // Produtos
  // ---------------------------------------------------------------------------

  async listProducts(companyId: string, query: ProductsQueryDto) {
    const where: Prisma.ProductWhereInput = {
      companyId,
      deletedAt: null,
      categoryId: query.categoryId,
      status: query.status,
      ...(query.lowStock ? { trackStock: true, stockQuantity: { lte: 5 } } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
              { barcode: query.search },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({ where, include: productInclude, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], skip: skipOf(query), take: query.pageSize }),
    ]);
    return paginated(rows.map((row) => this.toView(row)), total, query);
  }

  async getProduct(companyId: string, id: string) {
    return this.toView(await this.findProduct(companyId, id));
  }

  async findProduct(companyId: string, id: string, tx: Tx = this.prisma): Promise<ProductWithRelations> {
    const product = await tx.product.findFirst({ where: { id, companyId, deletedAt: null }, include: productInclude });
    if (!product) throw new NotFoundException('Produto não encontrado.');
    return product;
  }

  async createProduct(company: { id: string; tenantId: string }, dto: ProductDto) {
    await this.subscriptions.assertLimit(company.tenantId, company.id, 'maxProducts', await this.prisma.product.count({ where: { companyId: company.id, deletedAt: null } }));
    await this.validateProduct(company.id, dto);
    const product = await this.prisma.$transaction(async (tx) => {
      const { optionGroups, comboItems, promoStartsAt, promoEndsAt, ...data } = dto;
      const created = await tx.product.create({
        data: {
          ...data,
          tenantId: company.tenantId,
          companyId: company.id,
          promoStartsAt: promoStartsAt ? new Date(promoStartsAt) : null,
          promoEndsAt: promoEndsAt ? new Date(promoEndsAt) : null,
        },
      });
      await this.replaceOptions(tx, created.id, optionGroups);
      await this.replaceComboItems(tx, created.id, comboItems);
      return created;
    });
    await this.audit.log({ action: 'catalog.product.create', entityType: 'Product', entityId: product.id, after: { name: dto.name, priceCents: dto.priceCents } });
    return this.getProduct(company.id, product.id);
  }

  async updateProduct(companyId: string, id: string, dto: UpdateProductDto) {
    const current = await this.findProduct(companyId, id);
    await this.validateProduct(companyId, { ...current, ...dto } as ProductDto, id);
    const { optionGroups, comboItems, promoStartsAt, promoEndsAt, ...data } = dto;
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.product.update({
        where: { id },
        data: {
          ...data,
          promoStartsAt: promoStartsAt === undefined ? undefined : promoStartsAt ? new Date(promoStartsAt) : null,
          promoEndsAt: promoEndsAt === undefined ? undefined : promoEndsAt ? new Date(promoEndsAt) : null,
        },
      });
      if (optionGroups) await this.replaceOptions(tx, id, optionGroups);
      if (comboItems) await this.replaceComboItems(tx, id, comboItems);
      return row;
    });
    const audited = (p: typeof updated) => ({ name: p.name, priceCents: p.priceCents, promoPriceCents: p.promoPriceCents, status: p.status, stockQuantity: p.stockQuantity, trackStock: p.trackStock });
    // Alterações de preço são operações críticas: sempre auditadas com valor anterior e novo.
    await this.audit.log({ action: 'catalog.product.update', entityType: 'Product', entityId: id, ...diff(audited(current), audited(updated)) });
    return this.getProduct(companyId, id);
  }

  async deleteProduct(companyId: string, id: string) {
    await this.findProduct(companyId, id);
    const inCombo = await this.prisma.comboItem.count({ where: { productId: id, combo: { deletedAt: null } } });
    if (inCombo) throw new ConflictException('Este produto faz parte de um combo ativo. Remova-o do combo primeiro.');
    // Exclusão lógica: pedidos antigos continuam referenciando o produto.
    await this.prisma.product.update({ where: { id }, data: { deletedAt: new Date(), status: 'INACTIVE' } });
    await this.prisma.cartItem.deleteMany({ where: { productId: id } });
    await this.audit.log({ action: 'catalog.product.delete', entityType: 'Product', entityId: id });
  }

  async adjustStock(companyId: string, id: string, delta: number, reason?: string) {
    const product = await this.findProduct(companyId, id);
    if (!product.trackStock) throw new BadRequestException('Ative o controle de estoque do produto primeiro.');
    const result = await this.prisma.product.updateMany({
      where: { id, stockQuantity: { gte: delta < 0 ? -delta : 0 } },
      data: { stockQuantity: { increment: delta } },
    });
    if (result.count === 0) throw new ConflictException('Estoque insuficiente para esta saída.');
    await this.audit.log({
      action: 'catalog.stock.adjust',
      entityType: 'Product',
      entityId: id,
      before: { stockQuantity: product.stockQuantity },
      after: { stockQuantity: product.stockQuantity + delta },
      metadata: { reason },
    });
    return this.getProduct(companyId, id);
  }

  async addImage(companyId: string, id: string, file: UploadedFileLike | undefined) {
    const product = await this.findProduct(companyId, id);
    if (product.images.length >= MAX_IMAGES) throw new BadRequestException(`Limite de ${MAX_IMAGES} imagens por produto.`);
    const { mime, ext } = validateUpload(file, 'image');
    const key = await this.storage.put(`public/products/${companyId}/${id}/${randomUUID()}.${ext}`, file!.buffer, mime);
    await this.prisma.productImage.create({ data: { productId: id, fileKey: key, sortOrder: product.images.length } });
    return this.getProduct(companyId, id);
  }

  async removeImage(companyId: string, id: string, imageId: string) {
    const product = await this.findProduct(companyId, id);
    const image = product.images.find((item) => item.id === imageId);
    if (!image) throw new NotFoundException('Imagem não encontrada.');
    await this.prisma.productImage.delete({ where: { id: imageId } });
    await this.storage.delete(image.fileKey);
    return this.getProduct(companyId, id);
  }

  private async validateProduct(companyId: string, dto: ProductDto, productId?: string) {
    if (dto.categoryId) await this.assertCategory(companyId, dto.categoryId);
    if (dto.promoPriceCents != null && dto.promoPriceCents >= dto.priceCents) {
      throw new BadRequestException('O preço promocional deve ser menor que o preço normal.');
    }
    if (dto.promoStartsAt && dto.promoEndsAt && new Date(dto.promoEndsAt) <= new Date(dto.promoStartsAt)) {
      throw new BadRequestException('O fim da promoção deve ser depois do início.');
    }
    for (const group of dto.optionGroups ?? []) {
      if (group.minSelect > group.maxSelect) throw new BadRequestException(`Grupo "${group.name}": mínimo maior que o máximo.`);
      if (group.options.length === 0) throw new BadRequestException(`Grupo "${group.name}" precisa de ao menos uma opção.`);
      if (group.minSelect > group.options.length) throw new BadRequestException(`Grupo "${group.name}": mínimo maior que o número de opções.`);
    }
    if (dto.type === 'COMBO') {
      if (!dto.comboItems?.length && !productId) throw new BadRequestException('Combos precisam de ao menos um item.');
      for (const item of dto.comboItems ?? []) {
        if (item.productId === productId) throw new BadRequestException('Um combo não pode conter a si mesmo.');
        const component = await this.prisma.product.findFirst({ where: { id: item.productId, companyId, deletedAt: null } });
        if (!component) throw new BadRequestException('Item do combo não encontrado nesta loja.');
        if (component.type === 'COMBO') throw new BadRequestException('Combos não podem conter outros combos.');
      }
    }
    if (dto.sku) {
      const duplicate = await this.prisma.product.findFirst({ where: { companyId, sku: dto.sku, deletedAt: null, NOT: productId ? { id: productId } : undefined } });
      if (duplicate) throw new ConflictException('Já existe um produto com este SKU.');
    }
  }

  private async replaceOptions(tx: Tx, productId: string, groups?: ProductDto['optionGroups']) {
    if (!groups) return;
    await tx.productOptionGroup.deleteMany({ where: { productId } });
    for (const [index, group] of groups.entries()) {
      await tx.productOptionGroup.create({
        data: {
          productId,
          name: group.name,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          sortOrder: index,
          options: { create: group.options.map((option, position) => ({ ...option, sortOrder: position })) },
        },
      });
    }
  }

  private async replaceComboItems(tx: Tx, comboId: string, items?: ProductDto['comboItems']) {
    if (!items) return;
    await tx.comboItem.deleteMany({ where: { comboId } });
    if (items.length) await tx.comboItem.createMany({ data: items.map((item) => ({ ...item, comboId })) });
  }

  toView(product: ProductWithRelations) {
    const price = effectivePrice(product);
    return {
      id: product.id,
      companyId: product.companyId,
      categoryId: product.categoryId,
      type: product.type,
      name: product.name,
      description: product.description,
      sku: product.sku,
      barcode: product.barcode,
      priceCents: product.priceCents,
      promoPriceCents: product.promoPriceCents,
      promoStartsAt: product.promoStartsAt,
      promoEndsAt: product.promoEndsAt,
      effectivePriceCents: price,
      onSale: price < product.priceCents,
      trackStock: product.trackStock,
      stockQuantity: product.stockQuantity,
      weightGrams: product.weightGrams,
      lengthCm: product.lengthCm,
      widthCm: product.widthCm,
      heightCm: product.heightCm,
      status: product.status,
      available: isAvailable(product),
      isRegulated: product.isRegulated,
      requiresPrescription: product.requiresPrescription,
      minimumAge: product.minimumAge,
      sortOrder: product.sortOrder,
      images: product.images.map((image) => ({ id: image.id, url: this.storage.publicUrl(image.fileKey) })),
      optionGroups: product.optionGroups.map((group) => ({
        id: group.id,
        name: group.name,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        options: group.options.map((option) => ({
          id: option.id,
          name: option.name,
          priceDeltaCents: option.priceDeltaCents,
          available: option.isActive && (!option.trackStock || option.stockQuantity > 0),
          sku: option.sku,
          trackStock: option.trackStock,
          stockQuantity: option.stockQuantity,
          isActive: option.isActive,
        })),
      })),
      comboItems: product.comboItems.map((item) => ({ productId: item.productId, name: item.product.name, quantity: item.quantity })),
      updatedAt: product.updatedAt,
    };
  }
}
