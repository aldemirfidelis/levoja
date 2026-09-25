import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { normalizeBrazilianPhone } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';

const DAY = 86_400_000;
const INVITATION_DAYS = 7;

/** Telefone parcial (a empresa não precisa do número pessoal do entregador; o contato é pelo chat). */
function maskedPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return `(${digits.slice(-11, -9)}) •••••-${digits.slice(-4)}`;
}

/**
 * Frota própria: a empresa convida entregadores (por e-mail ou telefone do cadastro) e o entregador
 * aceita ou recusa no app. Na frota, ele recebe as entregas da empresa conforme o modo de entrega dela
 * (frota própria ou híbrido) e os ganhos dessas entregas ficam na carteira da empresa, que acerta com ele
 * diretamente. Empresa e entregador podem encerrar o vínculo a qualquer momento.
 */
@Injectable()
export class FleetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Empresa
  // ---------------------------------------------------------------------------

  async companyView(tenantId: string, companyId: string) {
    const company = await this.prisma.company.findFirst({ where: { id: companyId, tenantId }, select: { id: true, fulfillmentMode: true } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    const since = new Date(Date.now() - 30 * DAY);
    const drivers = await this.prisma.driver.findMany({
      where: { tenantId, fleetType: 'COMPANY', fleetCompanyId: companyId },
      select: {
        id: true,
        status: true,
        availability: true,
        ratingAvg: true,
        ratingCount: true,
        user: { select: { name: true, phone: true, avatarKey: true } },
        activeVehicle: { select: { type: true, plate: true, model: true } },
      },
      orderBy: { user: { name: 'asc' } },
    });
    const counts = drivers.length
      ? await this.prisma.delivery.groupBy({ by: ['driverId'], where: { driverId: { in: drivers.map((driver) => driver.id) }, companyId, status: 'DELIVERED', createdAt: { gte: since } }, _count: { _all: true } })
      : [];
    const invitations = await this.prisma.fleetInvitation.findMany({ where: { companyId, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 50 });
    const invited = await this.prisma.driver.findMany({ where: { id: { in: invitations.map((row) => row.driverId) } }, select: { id: true, user: { select: { name: true } } } });
    const invitedName = new Map(invited.map((row) => [row.id, row.user.name]));
    return {
      fulfillmentMode: company.fulfillmentMode,
      drivers: drivers.map((driver) => ({
        driverId: driver.id,
        name: driver.user.name,
        phone: maskedPhone(driver.user.phone),
        avatarUrl: this.storage.publicUrl(driver.user.avatarKey),
        status: driver.status,
        availability: driver.availability,
        ratingAvg: driver.ratingAvg,
        ratingCount: driver.ratingCount,
        vehicle: driver.activeVehicle,
        deliveriesLast30Days: counts.find((row) => row.driverId === driver.id)?._count._all ?? 0,
      })),
      invitations: invitations.map((row) => ({ ...row, driverName: invitedName.get(row.driverId) ?? 'Entregador' })),
    };
  }

  async invite(actor: AuthUser, companyId: string, input: { login: string; message?: string }) {
    const login = input.login.trim();
    const phone = login.includes('@') ? null : normalizeBrazilianPhone(login);
    if (!login.includes('@') && !phone) throw new BadRequestException('Informe o e-mail ou o celular do entregador.');
    const user = await this.prisma.user.findFirst({
      where: { tenantId: actor.tenantId, ...(phone ? { phone } : { email: login.toLowerCase() }), status: 'ACTIVE' },
      select: { id: true, name: true, driver: { select: { id: true, fleetType: true, fleetCompanyId: true } } },
    });
    if (!user?.driver) throw new NotFoundException('Nenhum entregador cadastrado com este e-mail ou celular. Peça para ele se cadastrar no app do entregador.');
    const driver = user.driver;
    if (driver.fleetType === 'COMPANY' && driver.fleetCompanyId === companyId) throw new ConflictException('Este entregador já faz parte da sua frota.');
    if (driver.fleetType === 'COMPANY') throw new ConflictException('Este entregador já faz parte da frota de outra empresa.');
    const pending = await this.prisma.fleetInvitation.findFirst({ where: { companyId, driverId: driver.id, status: 'PENDING', expiresAt: { gt: new Date() } } });
    if (pending) throw new ConflictException('Já existe um convite aguardando resposta deste entregador.');
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { tradeName: true } });
    const invitation = await this.prisma.fleetInvitation.create({
      data: { tenantId: actor.tenantId, companyId, driverId: driver.id, invitedById: actor.userId, message: input.message?.trim() || null, expiresAt: new Date(Date.now() + INVITATION_DAYS * DAY) },
    });
    await this.audit.log({ action: 'fleet.invite', entityType: 'FleetInvitation', entityId: invitation.id, metadata: { companyId, driverId: driver.id } });
    await this.notifications.notify({
      userId: user.id,
      type: 'fleet.invitation',
      title: `${company.tradeName} convidou você para a frota própria`,
      body: 'Abra o app para ver o convite e responder.',
      data: { invitationId: invitation.id, companyId },
      channels: ['inapp', 'push'],
      app: 'DRIVER',
    });
    return { ...invitation, driverName: user.name };
  }

  async cancelInvitation(actor: AuthUser, companyId: string, invitationId: string) {
    const updated = await this.prisma.fleetInvitation.updateMany({ where: { id: invitationId, companyId, status: 'PENDING' }, data: { status: 'CANCELED', respondedAt: new Date() } });
    if (updated.count === 0) throw new NotFoundException('Convite não encontrado ou já respondido.');
    await this.audit.log({ action: 'fleet.invitation.cancel', entityType: 'FleetInvitation', entityId: invitationId, metadata: { companyId } });
  }

  async removeDriver(actor: AuthUser, companyId: string, driverId: string) {
    const driver = await this.prisma.driver.findFirst({ where: { id: driverId, tenantId: actor.tenantId, fleetType: 'COMPANY', fleetCompanyId: companyId }, select: { id: true, userId: true } });
    if (!driver) throw new NotFoundException('Entregador não está na sua frota.');
    await this.prisma.driver.update({ where: { id: driverId }, data: { fleetType: 'PLATFORM', fleetCompanyId: null } });
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { tradeName: true } });
    await this.audit.log({ action: 'fleet.remove', entityType: 'Driver', entityId: driverId, before: { fleetType: 'COMPANY', fleetCompanyId: companyId }, after: { fleetType: 'PLATFORM' } });
    await this.notifications.notify({
      userId: driver.userId,
      type: 'fleet.removed',
      title: 'Você saiu da frota própria',
      body: `${company.tradeName} encerrou o vínculo de frota própria. Você volta a receber entregas da rede da plataforma.`,
      channels: ['inapp', 'push'],
      app: 'DRIVER',
    });
  }

  // ---------------------------------------------------------------------------
  // Entregador
  // ---------------------------------------------------------------------------

  private async driverOf(user: AuthUser) {
    if (!user.driverId) throw new ForbiddenException('Disponível para entregadores.');
    return this.prisma.driver.findUniqueOrThrow({ where: { id: user.driverId }, select: { id: true, userId: true, fleetType: true, fleetCompanyId: true } });
  }

  private companyCard(company: { id: string; tradeName: string; logoKey: string | null; address: { city: string; state: string } | null }) {
    return { id: company.id, tradeName: company.tradeName, logoUrl: this.storage.publicUrl(company.logoKey), city: company.address ? `${company.address.city}/${company.address.state}` : null };
  }

  async driverView(user: AuthUser) {
    const driver = await this.driverOf(user);
    const companySelect = { id: true, tradeName: true, logoKey: true, address: { select: { city: true, state: true } } } as const;
    const company =
      driver.fleetType === 'COMPANY' && driver.fleetCompanyId ? await this.prisma.company.findUnique({ where: { id: driver.fleetCompanyId }, select: companySelect }) : null;
    const invitations = await this.prisma.fleetInvitation.findMany({ where: { driverId: driver.id, status: 'PENDING', expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    const companies = await this.prisma.company.findMany({ where: { id: { in: invitations.map((row) => row.companyId) } }, select: companySelect });
    const byId = new Map(companies.map((row) => [row.id, row]));
    return {
      company: company ? this.companyCard(company) : null,
      invitations: invitations.map((row) => ({
        id: row.id,
        message: row.message,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
        company: byId.has(row.companyId) ? this.companyCard(byId.get(row.companyId)!) : null,
      })),
      rules: [
        'Na frota própria você recebe as entregas desta empresa (e deixa de receber as da rede da plataforma).',
        'Os ganhos dessas entregas são repassados à empresa, que acerta o pagamento com você diretamente.',
        'Você pode sair da frota a qualquer momento pelo app.',
      ],
    };
  }

  async respond(user: AuthUser, invitationId: string, accept: boolean) {
    const driver = await this.driverOf(user);
    const invitation = await this.prisma.fleetInvitation.findFirst({ where: { id: invitationId, driverId: driver.id } });
    if (!invitation || invitation.status !== 'PENDING') throw new NotFoundException('Convite não encontrado ou já respondido.');
    if (invitation.expiresAt <= new Date()) {
      await this.prisma.fleetInvitation.update({ where: { id: invitation.id }, data: { status: 'EXPIRED' } });
      throw new BadRequestException('Este convite expirou. Peça um novo à empresa.');
    }
    if (accept && driver.fleetType === 'COMPANY' && driver.fleetCompanyId !== invitation.companyId) {
      throw new ConflictException('Você já faz parte da frota de outra empresa. Saia dela antes de aceitar.');
    }
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: invitation.companyId }, select: { tradeName: true, status: true } });
    if (accept && company.status !== 'APPROVED') throw new BadRequestException('A empresa não está ativa no momento.');
    await this.prisma.$transaction(async (tx) => {
      await tx.fleetInvitation.update({ where: { id: invitation.id }, data: { status: accept ? 'ACCEPTED' : 'DECLINED', respondedAt: new Date() } });
      if (accept) {
        await tx.driver.update({ where: { id: driver.id }, data: { fleetType: 'COMPANY', fleetCompanyId: invitation.companyId } });
        // Os demais convites pendentes deixam de valer.
        await tx.fleetInvitation.updateMany({ where: { driverId: driver.id, status: 'PENDING', id: { not: invitation.id } }, data: { status: 'CANCELED', respondedAt: new Date() } });
      }
    });
    await this.audit.log({ action: accept ? 'fleet.accept' : 'fleet.decline', entityType: 'FleetInvitation', entityId: invitation.id, metadata: { companyId: invitation.companyId, driverId: driver.id } });
    const name = (await this.prisma.user.findUniqueOrThrow({ where: { id: driver.userId }, select: { name: true } })).name;
    await this.notifications.notify({
      userId: invitation.invitedById,
      type: accept ? 'fleet.accepted' : 'fleet.declined',
      title: accept ? 'Convite de frota aceito' : 'Convite de frota recusado',
      body: accept ? `${name} agora faz parte da frota própria de ${company.tradeName}.` : `${name} recusou o convite para a frota de ${company.tradeName}.`,
      data: { companyId: invitation.companyId },
      channels: ['inapp'],
    });
    return this.driverView(user);
  }

  async leave(user: AuthUser) {
    const driver = await this.driverOf(user);
    if (driver.fleetType !== 'COMPANY' || !driver.fleetCompanyId) throw new BadRequestException('Você não faz parte de uma frota própria.');
    const companyId = driver.fleetCompanyId;
    await this.prisma.driver.update({ where: { id: driver.id }, data: { fleetType: 'PLATFORM', fleetCompanyId: null } });
    await this.audit.log({ action: 'fleet.leave', entityType: 'Driver', entityId: driver.id, before: { fleetType: 'COMPANY', fleetCompanyId: companyId }, after: { fleetType: 'PLATFORM' } });
    const accepted = await this.prisma.fleetInvitation.findFirst({ where: { driverId: driver.id, companyId, status: 'ACCEPTED' }, orderBy: { respondedAt: 'desc' } });
    const name = (await this.prisma.user.findUniqueOrThrow({ where: { id: driver.userId }, select: { name: true } })).name;
    if (accepted) {
      await this.notifications.notify({ userId: accepted.invitedById, type: 'fleet.left', title: 'Entregador saiu da frota', body: `${name} saiu da sua frota própria.`, data: { companyId }, channels: ['inapp'] });
    }
    return this.driverView(user);
  }

  /** De hora em hora: convites sem resposta dentro do prazo. */
  @Cron(CronExpression.EVERY_HOUR)
  async expireInvitations(now = new Date()) {
    return (await this.prisma.fleetInvitation.updateMany({ where: { status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } })).count;
  }
}
