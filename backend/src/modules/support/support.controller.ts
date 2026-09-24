import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { UploadedFileLike } from '../../infra/storage/file-validation';
import { DOCUMENT_UPLOAD, FILE_BODY } from '../users/users.controller';
import { sendFile } from '../companies/companies.controller';
import { SupportService } from './support.service';
import {
  AssignTicketDto,
  CreateTicketDto,
  RateTicketDto,
  RequesterTicketsQueryDto,
  StaffAttachmentDto,
  StaffReplyDto,
  StaffTicketsQueryDto,
  TicketPriorityDto,
  TicketReplyDto,
  TicketStatusDto,
} from './support.dto';

/** Limite por minuto e por usuário/IP (desligado apenas no ambiente de testes). */
const limit = (per: number) => ({ default: { limit: () => (process.env.NODE_ENV === 'test' ? 10_000 : per), ttl: 60_000 } });

/** Cliente, entregador ou empresa: a permissão é conferida pelo perfil informado em cada chamado. */
@ApiTags('Suporte')
@ApiBearerAuth()
@Controller('support/tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @Throttle(limit(10))
  @ApiOperation({ summary: 'Abrir chamado (como cliente, entregador ou empresa)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    return this.support.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Meus chamados (ou os da empresa, com companyId)' })
  list(@CurrentUser() user: AuthUser, @Query() query: RequesterTicketsQueryDto) {
    return this.support.listForRequester(user, query);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.getForRequester(user, id);
  }

  @Post(':id/messages')
  @Throttle(limit(30))
  reply(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TicketReplyDto) {
    return this.support.replyAsRequester(user, id, dto.body);
  }

  @Post(':id/attachments')
  @Throttle(limit(20))
  @UseInterceptors(DOCUMENT_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  @ApiOperation({ summary: 'Anexar arquivo (PDF, PNG, JPEG ou WEBP; até 10 MB)' })
  attach(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: UploadedFileLike) {
    return this.support.attach(user, id, file, false);
  }

  @Get(':id/attachments/:attachmentId/file')
  async attachment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return sendFile(response, await this.support.attachmentFile(user, id, attachmentId, false));
  }

  @Post(':id/rating')
  @HttpCode(200)
  @ApiOperation({ summary: 'Avaliar o atendimento (após resolvido)' })
  rate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RateTicketDto) {
    return this.support.rate(user, id, dto.rating, dto.comment);
  }

  @Post(':id/close')
  @HttpCode(200)
  close(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.closeByRequester(user, id);
  }
}

@ApiTags('Admin • Suporte')
@ApiBearerAuth()
@Controller('admin/support/tickets')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @RequirePermissions('support.tickets.read')
  @ApiOperation({ summary: 'Fila de chamados (ordenada pelo prazo de resolução)' })
  list(@CurrentUser() user: AuthUser, @Query() query: StaffTicketsQueryDto) {
    return this.support.listForStaff(user, query);
  }

  @Get('stats')
  @RequirePermissions('support.tickets.read')
  @ApiOperation({ summary: 'Indicadores do atendimento: fila, SLA, tempos médios e satisfação' })
  stats(@CurrentUser() user: AuthUser) {
    return this.support.stats(user);
  }

  @Get(':id')
  @RequirePermissions('support.tickets.read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.getForStaff(user, id);
  }

  @Post(':id/messages')
  @RequirePermissions('support.tickets.manage')
  reply(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StaffReplyDto) {
    return this.support.replyAsStaff(user, id, dto.body, dto.internal ?? false);
  }

  @Post(':id/attachments')
  @RequirePermissions('support.tickets.manage')
  @UseInterceptors(DOCUMENT_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  attach(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileLike,
    @Body() dto: StaffAttachmentDto,
  ) {
    return this.support.attach(user, id, file, true, dto.internal ?? false);
  }

  @Get(':id/attachments/:attachmentId/file')
  @RequirePermissions('support.tickets.read')
  async attachment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return sendFile(response, await this.support.attachmentFile(user, id, attachmentId, true));
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermissions('support.tickets.manage')
  assign(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignTicketDto) {
    return this.support.assign(user, id, dto.assigneeId ?? null);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions('support.tickets.manage')
  status(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TicketStatusDto) {
    return this.support.setStatus(user, id, dto.status);
  }

  @Post(':id/priority')
  @HttpCode(200)
  @RequirePermissions('support.tickets.manage')
  priority(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TicketPriorityDto) {
    return this.support.setPriority(user, id, dto.priority);
  }
}
