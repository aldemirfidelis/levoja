import { Body, Controller, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MailService } from '../../infra/mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { Client, ClientInfo, CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { TenantId } from '../../common/tenant.decorator';
import type { AuthUser } from '../../common/auth/auth-user';
import { paginated, PaginationQueryDto, skipOf } from '../../common/pagination';
import { ContactAudience } from '../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class ContactDto {
  @ApiProperty() @IsString() @Length(2, 120) @Transform(trim) name!: string;
  @ApiProperty() @IsEmail() email!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiProperty({ enum: ContactAudience }) @IsEnum(ContactAudience) audience!: ContactAudience;
  @ApiProperty() @IsString() @Length(3, 150) @Transform(trim) subject!: string;
  @ApiProperty() @IsString() @Length(10, 5000) @Transform(trim) message!: string;
}

class ContactQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  pendingOnly?: boolean;
}

@Injectable()
export class ContactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, dto: ContactDto, client: ClientInfo) {
    const message = await this.prisma.contactMessage.create({
      data: { tenantId, ...dto, email: dto.email.toLowerCase(), ip: client.ip },
    });
    await this.mail.send({
      to: message.email,
      subject: 'Recebemos sua mensagem',
      paragraphs: [
        `Olá, ${message.name.split(' ')[0]}! Recebemos sua mensagem sobre "${message.subject}".`,
        'Nossa equipe responderá em até 2 dias úteis.',
      ],
      footer: `Protocolo: ${message.id}`,
    });
    const staff = await this.prisma.user.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        roles: { some: { role: { permissions: { some: { permission: { key: 'support.tickets.read' } } } } } },
      },
      select: { id: true },
      take: 50,
    });
    await this.notifications.notifyMany(
      staff.map((user) => user.id),
      { type: 'contact.created', title: 'Nova mensagem de contato', body: `${message.name}: ${message.subject}`, data: { contactId: message.id }, channels: ['inapp'] },
    );
    return { protocol: message.id };
  }

  async list(tenantId: string, query: ContactQueryDto) {
    const where = { tenantId, ...(query.pendingOnly ? { handledAt: null } : {}) };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.contactMessage.count({ where }),
      this.prisma.contactMessage.findMany({ where, orderBy: { createdAt: 'desc' }, skip: skipOf(query), take: query.pageSize }),
    ]);
    return paginated(rows, total, query);
  }

  async markHandled(actor: AuthUser, id: string) {
    const message = await this.prisma.contactMessage.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!message) throw new NotFoundException('Mensagem não encontrada.');
    await this.prisma.contactMessage.update({ where: { id }, data: { handledAt: new Date(), handledById: actor.userId } });
    await this.audit.log({ action: 'contact.handled', entityType: 'ContactMessage', entityId: id });
  }
}

@ApiTags('Contato')
@Controller()
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Public()
  @Post('contact')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Formulário de contato do portal' })
  create(@TenantId() tenantId: string, @Body() dto: ContactDto, @Client() client: ClientInfo) {
    return this.contact.create(tenantId, dto, client);
  }

  @ApiBearerAuth()
  @Get('admin/contact-messages')
  @RequirePermissions('support.tickets.read')
  list(@CurrentUser() user: AuthUser, @Query() query: ContactQueryDto) {
    return this.contact.list(user.tenantId, query);
  }

  @ApiBearerAuth()
  @Post('admin/contact-messages/:id/handled')
  @HttpCode(204)
  @RequirePermissions('support.tickets.manage')
  async handled(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.contact.markHandled(user, id);
  }
}

@Module({ providers: [ContactService], controllers: [ContactController] })
export class ContactModule {}
