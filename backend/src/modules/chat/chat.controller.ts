import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { CompanyPermission, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { PaginationQueryDto } from '../../common/pagination';
import { ConversationType } from '../../generated/prisma/enums';
import { ChatService } from './chat.service';

/** Limite por minuto e por usuário/IP (desligado apenas no ambiente de testes). */
const limit = (per: number) => ({ default: { limit: () => (process.env.NODE_ENV === 'test' ? 10_000 : per), ttl: 60_000 } });

class ContextQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() orderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() deliveryId?: string;
}

class OpenConversationDto extends ContextQueryDto {
  @ApiProperty({ enum: ConversationType }) @IsEnum(ConversationType) type!: ConversationType;
}

class MessagesQueryDto {
  @ApiPropertyOptional({ description: 'Mensagens anteriores a esta data (paginação)' }) @IsOptional() @IsDateString() before?: string;
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

class SendMessageDto {
  @ApiProperty() @IsString() @Length(1, 2000) body!: string;
}

@ApiTags('Chat')
@ApiBearerAuth()
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly chat: ChatService) {}

  @Get('available')
  @ApiOperation({ summary: 'Conversas possíveis para um pedido/entrega (com a loja, o entregador ou o cliente)' })
  available(@CurrentUser() user: AuthUser, @Query() query: ContextQueryDto) {
    return this.chat.available(user, query);
  }

  @Post('open')
  @HttpCode(200)
  @ApiOperation({ summary: 'Abrir (ou retomar) a conversa de um pedido/entrega' })
  open(@CurrentUser() user: AuthUser, @Body() dto: OpenConversationDto) {
    return this.chat.open(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Minhas conversas (cliente/entregador)' })
  inbox(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.chat.inbox(user, query);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.get(user, id);
  }

  @Get(':id/messages')
  messages(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() query: MessagesQueryDto) {
    return this.chat.messages(user, id, query.before, query.limit);
  }

  @Post(':id/messages')
  @Throttle(limit(40))
  send(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto) {
    return this.chat.send(user, id, dto.body);
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.chat.markRead(user, id);
  }

  @Post(':id/call')
  @HttpCode(200)
  @Throttle(limit(5))
  @ApiOperation({ summary: 'Ligação mascarada com a outra parte (ninguém vê o telefone do outro)' })
  call(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.call(user, id);
  }
}

@ApiTags('Empresas • Chat')
@ApiBearerAuth()
@Controller('companies/:companyId/conversations')
@CompanyPermission('company.orders.read', 'support.tickets.read')
export class CompanyConversationsController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  inbox(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Query() query: PaginationQueryDto) {
    return this.chat.companyInbox(user, companyId, query);
  }
}

@ApiTags('Admin • Chat')
@ApiBearerAuth()
@Controller('admin/conversations')
@RequirePermissions('support.tickets.read')
export class AdminConversationsController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  @ApiOperation({ summary: 'Conversas de um pedido/entrega (análise de reclamações; acesso auditado)' })
  list(@CurrentUser() user: AuthUser, @Query() query: ContextQueryDto) {
    return this.chat.forStaff(user, query);
  }
}
