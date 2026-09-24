import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { haversineKm, LatLng, pointInPolygon } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { Prisma } from '../../generated/prisma/client';
import type { ServiceArea } from '../../generated/prisma/client';
import type { ServiceAreaType } from '../../generated/prisma/enums';

export interface ServiceAreaInput {
  name: string;
  type: ServiceAreaType;
  radiusKm?: number;
  polygon?: [number, number][];
  districts?: string[];
  cities?: string[];
  feeAdjustmentCents?: number;
  minimumOrderCents?: number;
  extraMinutes?: number;
  isActive?: boolean;
}

export interface CoverageTarget {
  point: LatLng | null;
  district?: string;
  city?: string;
  state?: string;
}

export interface Coverage {
  covered: boolean;
  area: Pick<ServiceArea, 'id' | 'name' | 'feeAdjustmentCents' | 'minimumOrderCents' | 'extraMinutes'> | null;
  /** Distância em linha reta da loja ao destino (quando há coordenadas). */
  straightKm: number | null;
}

export const normalizePlace = (value?: string | null) =>
  (value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

/**
 * Áreas de atendimento da empresa: raio, polígono, bairros ou cidades.
 * Sem áreas configuradas, vale o raio padrão da plataforma a partir do endereço da loja.
 */
@Injectable()
export class ServiceAreasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  list(companyId: string) {
    return this.prisma.serviceArea.findMany({ where: { companyId }, orderBy: { createdAt: 'asc' } });
  }

  async create(companyId: string, input: ServiceAreaInput) {
    const data = this.normalize(input);
    const area = await this.prisma.serviceArea.create({ data: { ...data, companyId } });
    await this.audit.log({ action: 'service_area.create', entityType: 'ServiceArea', entityId: area.id, after: { ...input }, metadata: { companyId } });
    return area;
  }

  async update(companyId: string, id: string, input: ServiceAreaInput) {
    const area = await this.prisma.serviceArea.findFirst({ where: { id, companyId } });
    if (!area) throw new NotFoundException('Área não encontrada.');
    const updated = await this.prisma.serviceArea.update({ where: { id }, data: this.normalize(input) });
    await this.audit.log({ action: 'service_area.update', entityType: 'ServiceArea', entityId: id, after: { ...input } });
    return updated;
  }

  async remove(companyId: string, id: string) {
    const area = await this.prisma.serviceArea.findFirst({ where: { id, companyId } });
    if (!area) throw new NotFoundException('Área não encontrada.');
    await this.prisma.serviceArea.delete({ where: { id } });
    await this.audit.log({ action: 'service_area.delete', entityType: 'ServiceArea', entityId: id });
  }

  private normalize(input: ServiceAreaInput): Omit<Prisma.ServiceAreaUncheckedCreateInput, 'companyId'> {
    switch (input.type) {
      case 'RADIUS':
        if (!input.radiusKm || input.radiusKm <= 0 || input.radiusKm > 100) throw new BadRequestException('Informe um raio entre 0 e 100 km.');
        break;
      case 'POLYGON':
        if (!input.polygon || input.polygon.length < 3) throw new BadRequestException('O polígono precisa de pelo menos 3 pontos.');
        if (input.polygon.some(([lng, lat]) => Math.abs(lat) > 90 || Math.abs(lng) > 180)) throw new BadRequestException('Coordenadas inválidas.');
        break;
      case 'DISTRICTS':
        if (!input.districts?.length) throw new BadRequestException('Informe ao menos um bairro.');
        break;
      case 'CITIES':
        if (!input.cities?.length) throw new BadRequestException('Informe ao menos uma cidade (ex.: "São Paulo/SP").');
        break;
    }
    return {
      name: input.name,
      type: input.type,
      radiusKm: input.type === 'RADIUS' ? input.radiusKm : null,
      polygon: input.type === 'POLYGON' ? (input.polygon as Prisma.InputJsonValue) : Prisma.DbNull,
      districts: input.type === 'DISTRICTS' ? input.districts!.map(normalizePlace) : [],
      cities: input.type === 'CITIES' ? input.cities!.map((city) => normalizePlace(city.replace(/\s*-\s*/, '/'))) : [],
      feeAdjustmentCents: input.feeAdjustmentCents ?? 0,
      minimumOrderCents: input.minimumOrderCents ?? null,
      extraMinutes: input.extraMinutes ?? 0,
      isActive: input.isActive ?? true,
    };
  }

  /** Verifica se o destino é atendido pela empresa. A primeira área ativa que casar é usada. */
  async coverage(
    company: { id: string; tenantId: string; address: { lat: number | null; lng: number | null } | null },
    target: CoverageTarget,
    /** Áreas ativas já carregadas (evita consultas por empresa em listagens). */
    preloaded?: ServiceArea[],
  ): Promise<Coverage> {
    const origin = company.address?.lat != null && company.address?.lng != null ? { lat: company.address.lat, lng: company.address.lng } : null;
    const straightKm = origin && target.point ? haversineKm(origin, target.point) : null;
    const areas =
      preloaded ??
      (await this.prisma.serviceArea.findMany({ where: { companyId: company.id, isActive: true }, orderBy: { createdAt: 'asc' } }));

    if (areas.length === 0) {
      const radius = await this.settings.get(company.tenantId, 'marketplace.defaultRadiusKm');
      const covered = straightKm != null && straightKm <= radius;
      return { covered, area: null, straightKm };
    }

    const district = normalizePlace(target.district);
    const city = `${normalizePlace(target.city)}/${normalizePlace(target.state)}`;
    for (const area of areas) {
      const matches =
        (area.type === 'RADIUS' && straightKm != null && straightKm <= (area.radiusKm ?? 0)) ||
        (area.type === 'POLYGON' && target.point != null && pointInPolygon(target.point, (area.polygon as [number, number][]) ?? [])) ||
        (area.type === 'DISTRICTS' && !!district && area.districts.includes(district)) ||
        (area.type === 'CITIES' && area.cities.includes(city));
      if (matches) {
        const { id, name, feeAdjustmentCents, minimumOrderCents, extraMinutes } = area;
        return { covered: true, area: { id, name, feeAdjustmentCents, minimumOrderCents, extraMinutes }, straightKm };
      }
    }
    return { covered: false, area: null, straightKm };
  }
}
