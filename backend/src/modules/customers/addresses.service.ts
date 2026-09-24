import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';
import { AddressDto } from './address.dto';
import { MapsService } from '../geo/maps.service';

const MAX_ADDRESSES = 20;

@Injectable()
export class AddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly maps: MapsService,
  ) {}

  /** Completa latitude/longitude pelo geocodificador quando o app não enviou (melhor esforço). */
  async withCoordinates<T extends AddressDto>(dto: T): Promise<T> {
    if (dto.lat != null && dto.lng != null) return dto;
    const point = await this.maps.geocode(dto);
    return point ? { ...dto, lat: point.lat, lng: point.lng } : dto;
  }

  list(userId: string) {
    return this.prisma.address.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async get(userId: string, id: string) {
    const address = await this.prisma.address.findFirst({ where: { id, userId, deletedAt: null } });
    if (!address) throw new NotFoundException('Endereço não encontrado.');
    return address;
  }

  async create(userId: string, dto: AddressDto) {
    const count = await this.prisma.address.count({ where: { userId, deletedAt: null } });
    if (count >= MAX_ADDRESSES) throw new BadRequestException(`Limite de ${MAX_ADDRESSES} endereços atingido.`);
    dto = await this.withCoordinates(dto);
    return this.prisma.$transaction(async (tx) => {
      const isDefault = dto.isDefault ?? count === 0;
      if (isDefault) await this.clearDefault(tx, userId);
      return tx.address.create({ data: { ...dto, userId, isDefault } });
    });
  }

  async update(userId: string, id: string, dto: AddressDto) {
    await this.get(userId, id);
    dto = await this.withCoordinates(dto);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await this.clearDefault(tx, userId);
      return tx.address.update({ where: { id }, data: dto });
    });
  }

  async remove(userId: string, id: string) {
    const address = await this.get(userId, id);
    await this.prisma.$transaction(async (tx) => {
      // Soft delete: pedidos antigos guardam cópia do endereço, mas o registro é preservado para auditoria.
      await tx.address.update({ where: { id }, data: { deletedAt: new Date(), isDefault: false } });
      if (address.isDefault) {
        const next = await tx.address.findFirst({ where: { userId, deletedAt: null }, orderBy: { createdAt: 'desc' } });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
  }

  private async clearDefault(tx: Tx, userId: string) {
    await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
  }
}
