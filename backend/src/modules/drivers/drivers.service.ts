import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import {
  availablePartnerActions,
  DRIVER_DOCUMENT_LABELS,
  DriverDocumentType as SharedDriverDocumentType,
  isAdult,
  maskDocument,
  requiredDriverDocuments,
  ROLE_KEYS,
  VehicleType as SharedVehicleType,
} from '@levoja/shared';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { StorageService } from '../../infra/storage/storage.service';
import { safeFileName, UploadedFileLike, validateUpload } from '../../infra/storage/file-validation';
import { AuditService, diff } from '../audit/audit.service';
import { AccessService } from '../access/access.service';
import { RolesService } from '../access/roles.service';
import { UsersService } from '../users/users.service';
import { BankAccountsService, toView as bankAccountView } from '../partners/bank-accounts.service';
import { BankAccountDto } from '../partners/bank-account.dto';
import { AddressDto } from '../customers/address.dto';
import { assertRequirements, RequirementItem, resolveOwnerSubmit } from '../../common/partner-workflow';
import type { AuthUser } from '../../common/auth/auth-user';
import { UpdateDriverDto, UpdateVehicleDto, VehicleDto } from './drivers.dto';
import { Prisma } from '../../generated/prisma/client';
import type { DriverDocumentType, VehicleType } from '../../generated/prisma/enums';

export const driverDetailInclude = {
  user: { select: { id: true, name: true, email: true, phone: true, cpfEncrypted: true, birthDate: true, avatarKey: true, status: true } },
  address: true,
  vehicles: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
  documents: { orderBy: { createdAt: 'desc' } },
  bankAccount: true,
  fleetCompany: { select: { id: true, tradeName: true } },
} satisfies Prisma.DriverInclude;

export type DriverDetail = Prisma.DriverGetPayload<{ include: typeof driverDetailInclude }>;

export const DRIVER_SUBMITTED = 'driver.submitted';

const MOTORIZED: VehicleType[] = ['MOTORCYCLE', 'CAR', 'VAN'];

@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly roles: RolesService,
    private readonly users: UsersService,
    private readonly bankAccounts: BankAccountsService,
    private readonly events: EventEmitter2,
  ) {}

  /** Cria o perfil de entregador (status "Cadastro iniciado") com o primeiro veículo. */
  async createForUser(tx: Tx, tenantId: string, userId: string, vehicleType: VehicleType) {
    if (await tx.driver.findUnique({ where: { userId }, select: { id: true } })) {
      throw new ConflictException('Você já possui cadastro de entregador.');
    }
    const role = await this.roles.findByKey(tenantId, ROLE_KEYS.DRIVER, tx);
    await tx.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      create: { userId, roleId: role.id },
      update: {},
    });
    const driver = await tx.driver.create({
      data: {
        tenantId,
        userId,
        statusHistory: { create: { fromStatus: 'DRAFT', toStatus: 'DRAFT', action: 'CREATE', changedById: userId } },
      },
    });
    const vehicle = await tx.vehicle.create({ data: { driverId: driver.id, type: vehicleType } });
    await tx.driver.update({ where: { id: driver.id }, data: { activeVehicleId: vehicle.id } });
    await this.audit.log(
      { action: 'driver.create', entityType: 'Driver', entityId: driver.id, actorId: userId, tenantId, after: { vehicleType } },
      tx,
    );
    return driver;
  }

  async create(user: AuthUser, vehicleType: VehicleType) {
    await this.prisma.$transaction((tx) => this.createForUser(tx, user.tenantId, user.userId, vehicleType));
    await this.access.invalidate(user.userId);
    return this.getMine(user.userId);
  }

  async findDetailByUser(userId: string): Promise<DriverDetail> {
    const driver = await this.prisma.driver.findUnique({ where: { userId }, include: driverDetailInclude });
    if (!driver) throw new NotFoundException('Cadastro de entregador não encontrado.');
    return driver;
  }

  async findDetail(driverId: string): Promise<DriverDetail> {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId }, include: driverDetailInclude });
    if (!driver) throw new NotFoundException('Entregador não encontrado.');
    return driver;
  }

  async getMine(userId: string) {
    return this.toView(await this.findDetailByUser(userId));
  }

  toView(driver: DriverDetail) {
    const cpf = this.crypto.decryptNullable(driver.user.cpfEncrypted);
    const cnh = this.crypto.decryptNullable(driver.cnhNumberEncrypted);
    return {
      id: driver.id,
      status: driver.status,
      statusReason: driver.statusReason,
      submittedAt: driver.submittedAt,
      approvedAt: driver.approvedAt,
      user: {
        id: driver.user.id,
        name: driver.user.name,
        email: driver.user.email,
        phone: driver.user.phone,
        cpfMasked: cpf ? maskDocument(cpf) : null,
        birthDate: driver.user.birthDate?.toISOString().slice(0, 10) ?? null,
        avatarUrl: this.storage.publicUrl(driver.user.avatarKey),
      },
      cnhNumberMasked: cnh ? maskDocument(cnh) : null,
      cnhCategory: driver.cnhCategory,
      cnhExpiresAt: driver.cnhExpiresAt?.toISOString().slice(0, 10) ?? null,
      fleetType: driver.fleetType,
      fleetCompany: driver.fleetCompany,
      address: driver.address,
      activeVehicleId: driver.activeVehicleId,
      vehicles: driver.vehicles,
      documents: driver.documents.map((doc) => ({
        id: doc.id,
        type: doc.type,
        label: DRIVER_DOCUMENT_LABELS[doc.type as SharedDriverDocumentType],
        vehicleId: doc.vehicleId,
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        status: doc.status,
        reviewNote: doc.reviewNote,
        reviewedAt: doc.reviewedAt,
        createdAt: doc.createdAt,
      })),
      bankAccount: bankAccountView(driver.bankAccount),
      ratingAvg: driver.ratingAvg,
      ratingCount: driver.ratingCount,
      requirements: this.requirements(driver),
      ownerActions: availablePartnerActions(driver.status, 'OWNER'),
      createdAt: driver.createdAt,
    };
  }

  activeVehicle(driver: DriverDetail) {
    return driver.vehicles.find((vehicle) => vehicle.id === driver.activeVehicleId) ?? null;
  }

  requiredDocuments(driver: DriverDetail): DriverDocumentType[] {
    const vehicle = this.activeVehicle(driver);
    return vehicle ? requiredDriverDocuments(vehicle.type as SharedVehicleType) : ['ID_DOCUMENT', 'SELFIE', 'ADDRESS_PROOF'];
  }

  requirements(driver: DriverDetail): RequirementItem[] {
    const vehicle = this.activeVehicle(driver);
    const motorized = !!vehicle && MOTORIZED.includes(vehicle.type);
    const birthDate = driver.user.birthDate;
    const items: RequirementItem[] = [
      { key: 'cpf', label: 'CPF', done: !!driver.user.cpfEncrypted },
      {
        key: 'birth_date',
        label: 'Data de nascimento (maior de 18 anos)',
        done: !!birthDate && isAdult(birthDate),
        detail: birthDate && !isAdult(birthDate) ? 'É necessário ter 18 anos ou mais.' : undefined,
      },
      { key: 'address', label: 'Endereço', done: !!driver.address },
      { key: 'vehicle', label: 'Veículo ativo', done: !!vehicle },
      { key: 'bank_account', label: 'Chave PIX / dados bancários', done: !!driver.bankAccount },
    ];
    if (motorized) {
      items.push({
        key: 'vehicle_details',
        label: 'Placa, marca, modelo e ano do veículo',
        done: !!(vehicle!.plate && vehicle!.brand && vehicle!.model && vehicle!.year),
      });
      items.push({
        key: 'cnh',
        label: 'Número, categoria e validade da CNH',
        done: !!(driver.cnhNumberEncrypted && driver.cnhCategory && driver.cnhExpiresAt && driver.cnhExpiresAt > new Date()),
        detail: driver.cnhExpiresAt && driver.cnhExpiresAt <= new Date() ? 'CNH vencida.' : undefined,
      });
    }
    for (const type of this.requiredDocuments(driver)) {
      const latest = driver.documents.find((doc) => doc.type === type);
      items.push({
        key: `document:${type}`,
        label: `Documento: ${DRIVER_DOCUMENT_LABELS[type as SharedDriverDocumentType]}`,
        done: !!latest && latest.status !== 'REJECTED',
        detail: latest?.status === 'REJECTED' ? (latest.reviewNote ?? 'Documento reprovado — envie novamente.') : undefined,
      });
    }
    return items;
  }

  async updateMine(user: AuthUser, dto: UpdateDriverDto) {
    const driver = await this.findDetailByUser(user.userId);
    this.assertEditable(driver.status);
    if (dto.birthDate && !isAdult(new Date(dto.birthDate))) {
      throw new BadRequestException('É necessário ter 18 anos ou mais para ser entregador.');
    }

    const userData: Prisma.UserUpdateInput = {};
    if (dto.birthDate) userData.birthDate = new Date(dto.birthDate);
    if (dto.cpf) {
      if (driver.user.cpfEncrypted) throw new ConflictException('CPF já informado. Para alterá-lo, fale com o suporte.');
      const protectedCpf = this.users.protectCpf(dto.cpf);
      await this.users.assertAvailable(user.tenantId, { cpfHash: protectedCpf.cpfHash }, user.userId);
      Object.assign(userData, protectedCpf);
    }
    if (dto.cnhExpiresAt && new Date(dto.cnhExpiresAt) <= new Date()) throw new BadRequestException('CNH vencida.');

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(userData).length) await tx.user.update({ where: { id: user.userId }, data: userData });
      await tx.driver.update({
        where: { id: driver.id },
        data: {
          cnhNumberEncrypted: dto.cnhNumber ? this.crypto.encrypt(dto.cnhNumber) : undefined,
          cnhCategory: dto.cnhCategory,
          cnhExpiresAt: dto.cnhExpiresAt ? new Date(dto.cnhExpiresAt) : undefined,
        },
      });
    });
    await this.audit.log({
      action: 'driver.update',
      entityType: 'Driver',
      entityId: driver.id,
      after: { cpf: dto.cpf ? 'set' : undefined, birthDate: dto.birthDate, cnh: dto.cnhNumber ? 'set' : undefined, cnhCategory: dto.cnhCategory, cnhExpiresAt: dto.cnhExpiresAt },
    });
    return this.getMine(user.userId);
  }

  async setAddress(user: AuthUser, dto: AddressDto) {
    const driver = await this.findDetailByUser(user.userId);
    const { isDefault: _d, label: _l, recipientName: _r, ...address } = dto;
    await this.prisma.$transaction(async (tx) => {
      if (driver.addressId) await tx.address.update({ where: { id: driver.addressId }, data: address });
      else {
        const created = await tx.address.create({ data: address });
        await tx.driver.update({ where: { id: driver.id }, data: { addressId: created.id } });
      }
    });
    await this.audit.log({ action: 'driver.address.update', entityType: 'Driver', entityId: driver.id });
    return this.getMine(user.userId);
  }

  // --- Veículos ---

  async addVehicle(user: AuthUser, dto: VehicleDto) {
    const driver = await this.findDetailByUser(user.userId);
    if (driver.status === 'BLOCKED') throw new ForbiddenException('Cadastro bloqueado.');
    if (driver.vehicles.length >= 5) throw new BadRequestException('Limite de 5 veículos.');
    this.assertVehicle(dto.type, dto.plate);
    const vehicle = await this.prisma.vehicle.create({ data: { driverId: driver.id, ...dto } });
    await this.audit.log({ action: 'driver.vehicle.create', entityType: 'Vehicle', entityId: vehicle.id, after: { ...dto } });
    return vehicle;
  }

  async updateVehicle(user: AuthUser, vehicleId: string, dto: UpdateVehicleDto) {
    const driver = await this.findDetailByUser(user.userId);
    const vehicle = driver.vehicles.find((item) => item.id === vehicleId);
    if (!vehicle) throw new NotFoundException('Veículo não encontrado.');
    this.assertVehicle(dto.type ?? vehicle.type, dto.plate ?? vehicle.plate ?? undefined);
    // Alterar dados de um veículo aprovado exige nova análise.
    const updated = await this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: { ...dto, status: vehicle.status === 'APPROVED' ? 'PENDING' : undefined },
    });
    await this.audit.log({ action: 'driver.vehicle.update', entityType: 'Vehicle', entityId: vehicleId, ...diff(vehicle, updated) });
    return updated;
  }

  async removeVehicle(user: AuthUser, vehicleId: string) {
    const driver = await this.findDetailByUser(user.userId);
    if (!driver.vehicles.some((item) => item.id === vehicleId)) throw new NotFoundException('Veículo não encontrado.');
    if (driver.activeVehicleId === vehicleId) throw new ConflictException('Defina outro veículo como ativo antes de remover este.');
    await this.prisma.vehicle.update({ where: { id: vehicleId }, data: { deletedAt: new Date() } });
    await this.audit.log({ action: 'driver.vehicle.delete', entityType: 'Vehicle', entityId: vehicleId });
  }

  async activateVehicle(user: AuthUser, vehicleId: string) {
    const driver = await this.findDetailByUser(user.userId);
    const vehicle = driver.vehicles.find((item) => item.id === vehicleId);
    if (!vehicle) throw new NotFoundException('Veículo não encontrado.');
    if (driver.status === 'APPROVED' && vehicle.status !== 'APPROVED') {
      throw new ConflictException('Somente veículos aprovados podem ser usados em entregas.');
    }
    await this.prisma.driver.update({ where: { id: driver.id }, data: { activeVehicleId: vehicleId } });
    await this.audit.log({ action: 'driver.vehicle.activate', entityType: 'Driver', entityId: driver.id, after: { vehicleId } });
    return this.getMine(user.userId);
  }

  private assertVehicle(type: VehicleType, plate?: string) {
    if (MOTORIZED.includes(type) && plate === undefined) return; // placa pode ser informada depois (checklist)
    if (type === 'BICYCLE' && plate) throw new BadRequestException('Bicicletas não possuem placa.');
  }

  // --- Documentos ---

  async uploadDocument(user: AuthUser, type: DriverDocumentType, vehicleId: string | undefined, file: UploadedFileLike | undefined) {
    const driver = await this.findDetailByUser(user.userId);
    if (driver.status === 'UNDER_REVIEW') throw new ConflictException('Cadastro em análise: aguarde o resultado.');
    if (driver.status === 'BLOCKED') throw new ForbiddenException('Cadastro bloqueado.');
    if (vehicleId && !driver.vehicles.some((vehicle) => vehicle.id === vehicleId)) throw new NotFoundException('Veículo não encontrado.');
    const resolvedVehicleId = vehicleId ?? (type === 'VEHICLE_REGISTRATION' ? driver.activeVehicleId : null);

    const { mime, ext } = validateUpload(file, 'document');
    const key = await this.storage.put(`private/drivers/${driver.id}/documents/${randomUUID()}.${ext}`, file!.buffer, mime);
    const document = await this.prisma.driverDocument.create({
      data: {
        driverId: driver.id,
        vehicleId: resolvedVehicleId,
        type,
        fileKey: key,
        fileName: safeFileName(file!.originalname),
        mimeType: mime,
        sizeBytes: file!.size,
      },
    });
    await this.audit.log({ action: 'driver.document.upload', entityType: 'DriverDocument', entityId: document.id, metadata: { type } });
    return { id: document.id, type: document.type, status: document.status, fileName: document.fileName, createdAt: document.createdAt };
  }

  async getDocumentFile(driverId: string, documentId: string, tenantId?: string) {
    const document = await this.prisma.driverDocument.findFirst({
      where: { id: documentId, driverId, ...(tenantId ? { driver: { tenantId } } : {}) },
    });
    if (!document) throw new NotFoundException('Documento não encontrado.');
    const file = await this.storage.get(document.fileKey);
    if (!file) throw new NotFoundException('Arquivo não encontrado.');
    await this.audit.log({ action: 'driver.document.view', entityType: 'DriverDocument', entityId: document.id, metadata: { driverId } });
    return { ...file, contentType: document.mimeType, fileName: document.fileName };
  }

  async deleteDocument(user: AuthUser, documentId: string) {
    const driver = await this.findDetailByUser(user.userId);
    const document = driver.documents.find((doc) => doc.id === documentId);
    if (!document) throw new NotFoundException('Documento não encontrado.');
    if (document.status === 'APPROVED') throw new ConflictException('Documentos aprovados não podem ser removidos.');
    await this.prisma.driverDocument.delete({ where: { id: document.id } });
    await this.storage.delete(document.fileKey);
    await this.audit.log({ action: 'driver.document.delete', entityType: 'DriverDocument', entityId: document.id });
  }

  async setBankAccount(user: AuthUser, dto: BankAccountDto) {
    const driver = await this.findDetailByUser(user.userId);
    return this.bankAccounts.upsert(user.tenantId, { driverId: driver.id }, dto);
  }

  async submit(user: AuthUser) {
    const driver = await this.findDetailByUser(user.userId);
    const next = resolveOwnerSubmit(driver.status);
    assertRequirements(this.requirements(driver));
    await this.prisma.$transaction(async (tx) => {
      await tx.driver.update({ where: { id: driver.id }, data: { status: next, statusReason: null, submittedAt: new Date() } });
      await tx.driverStatusHistory.create({
        data: { driverId: driver.id, fromStatus: driver.status, toStatus: next, action: 'SUBMIT', changedById: user.userId },
      });
      await this.audit.log(
        { action: 'driver.submit', entityType: 'Driver', entityId: driver.id, before: { status: driver.status }, after: { status: next } },
        tx,
      );
    });
    this.events.emit(DRIVER_SUBMITTED, { tenantId: driver.tenantId, driverId: driver.id, name: driver.user.name });
    return this.getMine(user.userId);
  }

  statusHistory(driverId: string) {
    return this.prisma.driverStatusHistory.findMany({ where: { driverId }, orderBy: { createdAt: 'desc' } });
  }

  private assertEditable(status: string) {
    if (status === 'UNDER_REVIEW') throw new ConflictException('Cadastro em análise: aguarde o resultado para alterar os dados.');
    if (status === 'BLOCKED') throw new ForbiddenException('Cadastro bloqueado.');
  }
}
