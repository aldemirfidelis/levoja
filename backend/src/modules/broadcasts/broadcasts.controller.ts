import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { PaginationQueryDto } from '../../common/pagination';
import { BroadcastAudience, BroadcastKind } from '../../generated/prisma/enums';
import { BroadcastChannel, BroadcastsService } from './broadcasts.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const CHANNELS: BroadcastChannel[] = ['inapp', 'push', 'email'];

class BroadcastTargetDto {
  @ApiProperty({ enum: BroadcastAudience }) @IsEnum(BroadcastAudience) audience!: BroadcastAudience;
  @ApiProperty({ enum: BroadcastKind }) @IsEnum(BroadcastKind) kind!: BroadcastKind;

  @ApiProperty({ enum: CHANNELS, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsIn(CHANNELS, { each: true })
  channels!: BroadcastChannel[];

  @ApiPropertyOptional({ description: 'Somente pessoas desta cidade' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsString()
  @MaxLength(80)
  city?: string;
}

class CreateBroadcastDto extends BroadcastTargetDto {
  @ApiProperty() @IsString() @Transform(trim) @Length(3, 80) title!: string;
  @ApiProperty() @IsString() @Transform(trim) @Length(5, 500) body!: string;
}

@ApiTags('Admin • Comunicados')
@ApiBearerAuth()
@Controller('admin/notifications/broadcasts')
@RequirePermissions('notifications.broadcast')
export class BroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.broadcasts.list(user, query);
  }

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Alcance estimado (público e pessoas alcançáveis pelos canais escolhidos)' })
  preview(@CurrentUser() user: AuthUser, @Body() dto: BroadcastTargetDto) {
    return this.broadcasts.preview(user, dto);
  }

  @Post()
  @Throttle({ default: { limit: () => (process.env.NODE_ENV === 'test' ? 10_000 : 5), ttl: 60_000 } })
  @ApiOperation({ summary: 'Enviar comunicado (promoção respeita o consentimento; aviso operacional só para entregadores/empresas)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBroadcastDto) {
    return this.broadcasts.create(user, dto);
  }
}
