import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { UploadedFileLike, validateUpload } from '../../infra/storage/file-validation';
import { AuditService, diff } from '../audit/audit.service';
import { UsersService } from './users.service';
import { AdminUsersService } from './admin-users.service';
import { AdminCreateUserDto, AdminUpdateUserDto, AdminUsersQueryDto, UpdateMeDto, UserStatusActionDto } from './users.dto';
import { Prisma } from '../../generated/prisma/client';

export const IMAGE_UPLOAD = FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } });
export const DOCUMENT_UPLOAD = FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } });
export const FILE_BODY = {
  schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
};

@ApiTags('Perfil')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  @Patch()
  @ApiOperation({ summary: 'Atualizar meu perfil' })
  async update(@CurrentUser() actor: AuthUser, @Body() dto: UpdateMeDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    const phone = dto.phone ? this.users.normalizePhone(dto.phone) : undefined;
    let cpfData: { cpfEncrypted?: string; cpfHash?: string } = {};
    if (dto.cpf) {
      if (user.cpfHash) throw new ConflictException('CPF já informado. Para alterá-lo, fale com o suporte.');
      cpfData = this.users.protectCpf(dto.cpf);
    }
    await this.users.assertAvailable(actor.tenantId, { phone, cpfHash: cpfData.cpfHash }, actor.userId);

    const preferences = dto.preferences ? { ...((user.preferences as Record<string, unknown>) ?? {}), ...dto.preferences } : undefined;

    const updated = await this.prisma.user.update({
      where: { id: actor.userId },
      data: {
        name: dto.name?.trim(),
        phone,
        phoneVerifiedAt: phone && phone !== user.phone ? null : undefined,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        preferences: preferences as Prisma.InputJsonValue | undefined,
        ...cpfData,
      },
    });
    const changes = diff(
      { name: user.name, phone: user.phone, birthDate: user.birthDate, cpf: user.cpfHash ? 'set' : null },
      { name: updated.name, phone: updated.phone, birthDate: updated.birthDate, cpf: updated.cpfHash ? 'set' : null },
    );
    if (Object.keys(changes.after).length) {
      await this.audit.log({ action: 'user.profile.update', entityType: 'User', entityId: actor.userId, ...changes });
    }
    return this.users.toView(updated);
  }

  @Put('avatar')
  @UseInterceptors(IMAGE_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  @ApiOperation({ summary: 'Enviar foto de perfil' })
  async avatar(@CurrentUser() actor: AuthUser, @UploadedFile() file: UploadedFileLike) {
    const { mime, ext } = validateUpload(file, 'image');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { avatarKey: true } });
    const key = await this.storage.put(`public/avatars/${actor.userId}/${randomUUID()}.${ext}`, file.buffer, mime);
    await this.prisma.user.update({ where: { id: actor.userId }, data: { avatarKey: key } });
    await this.storage.delete(user.avatarKey);
    return { avatarUrl: this.storage.publicUrl(key) };
  }

  @Delete('avatar')
  @HttpCode(204)
  async removeAvatar(@CurrentUser() actor: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { avatarKey: true } });
    await this.prisma.user.update({ where: { id: actor.userId }, data: { avatarKey: null } });
    await this.storage.delete(user.avatarKey);
  }
}

@ApiTags('Admin • Usuários')
@ApiBearerAuth()
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly admin: AdminUsersService) {}

  @Get()
  @RequirePermissions('users.read')
  @ApiOperation({ summary: 'Listar usuários' })
  list(@CurrentUser() user: AuthUser, @Query() query: AdminUsersQueryDto) {
    return this.admin.list(user.tenantId, query);
  }

  @Post()
  @RequirePermissions('users.create')
  @ApiOperation({ summary: 'Criar usuário interno (envia convite)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: AdminCreateUserDto) {
    return this.admin.create(user, dto);
  }

  @Get(':id')
  @RequirePermissions('users.read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.get(user, id);
  }

  @Patch(':id')
  @RequirePermissions('users.update')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminUpdateUserDto) {
    return this.admin.update(user, id, dto);
  }

  @Post(':id/status')
  @RequirePermissions('users.status.manage')
  @ApiOperation({ summary: 'Suspender, bloquear, desativar ou reativar' })
  changeStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UserStatusActionDto) {
    return this.admin.changeStatus(user, id, dto);
  }

  @Post(':id/password-reset')
  @HttpCode(204)
  @RequirePermissions('users.update')
  @ApiOperation({ summary: 'Enviar link de redefinição de senha' })
  async passwordReset(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.admin.sendPasswordReset(user, id);
  }
}
