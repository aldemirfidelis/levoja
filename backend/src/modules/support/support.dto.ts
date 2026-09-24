import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination';
import { TicketCategory, TicketPriority, TicketStatus } from '../../generated/prisma/enums';
import type { RequesterRole } from './support.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const bool = ({ value }: { value: unknown }) => value === true || value === 'true';
const REQUESTER_ROLES: RequesterRole[] = ['CUSTOMER', 'DRIVER', 'COMPANY'];

export class CreateTicketDto {
  @ApiProperty({ enum: REQUESTER_ROLES, description: 'Perfil em nome do qual o chamado é aberto' })
  @IsIn(REQUESTER_ROLES)
  as!: RequesterRole;

  @ApiPropertyOptional({ description: 'Obrigatório quando as=COMPANY' })
  @ValidateIf((dto: CreateTicketDto) => dto.as === 'COMPANY')
  @IsUUID()
  companyId?: string;

  @ApiProperty({ enum: TicketCategory }) @IsEnum(TicketCategory) category!: TicketCategory;
  @ApiProperty() @IsString() @Transform(trim) @Length(3, 150) subject!: string;
  @ApiProperty() @IsString() @Transform(trim) @Length(10, 5000) description!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() orderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() deliveryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() paymentId?: string;
}

export class RequesterTicketsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: REQUESTER_ROLES }) @IsOptional() @IsIn(REQUESTER_ROLES) as?: RequesterRole;
  @ApiPropertyOptional({ description: 'Chamados da empresa (membros com permissão)' }) @IsOptional() @IsUUID() companyId?: string;
}

export class TicketReplyDto {
  @ApiProperty() @IsString() @Transform(trim) @Length(1, 5000) body!: string;
}

export class StaffReplyDto extends TicketReplyDto {
  @ApiPropertyOptional({ description: 'Nota interna (não aparece para quem abriu)' })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  internal?: boolean;
}

export class AssignTicketDto {
  @ApiPropertyOptional({ nullable: true, description: 'null remove o responsável' })
  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;
}

export class TicketStatusDto {
  @ApiProperty({ enum: TicketStatus }) @IsEnum(TicketStatus) status!: TicketStatus;
}

export class TicketPriorityDto {
  @ApiProperty({ enum: TicketPriority }) @IsEnum(TicketPriority) priority!: TicketPriority;
}

export class RateTicketDto {
  @ApiProperty({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) rating!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Transform(trim) @MaxLength(1000) comment?: string;
}

export class StaffAttachmentDto {
  @ApiPropertyOptional() @IsOptional() @Transform(bool) @IsBoolean() internal?: boolean;
}

export class StaffTicketsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: [...Object.values(TicketStatus), 'ACTIVE'] })
  @IsOptional()
  @IsIn([...Object.values(TicketStatus), 'ACTIVE'])
  status?: TicketStatus | 'ACTIVE';

  @ApiPropertyOptional({ enum: TicketPriority }) @IsOptional() @IsEnum(TicketPriority) priority?: TicketPriority;
  @ApiPropertyOptional({ enum: TicketCategory }) @IsOptional() @IsEnum(TicketCategory) category?: TicketCategory;

  @ApiPropertyOptional({ description: "'me', 'none' ou o id do atendente" })
  @IsOptional()
  @ValidateIf((dto: StaffTicketsQueryDto) => dto.assignee !== 'me' && dto.assignee !== 'none')
  @IsUUID()
  assignee?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(bool) @IsBoolean() breached?: boolean;
}
