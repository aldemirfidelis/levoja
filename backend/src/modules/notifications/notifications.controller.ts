import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { paginated, PaginationQueryDto, skipOf } from '../../common/pagination';
import { AppKind, DevicePlatform } from '../../generated/prisma/enums';

class NotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unreadOnly?: boolean;
}

class RegisterDeviceDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxx]' }) @IsString() @MaxLength(300) token!: string;
  @ApiProperty({ enum: DevicePlatform }) @IsEnum(DevicePlatform) platform!: DevicePlatform;
  @ApiProperty({ enum: AppKind }) @IsEnum(AppKind) app!: AppKind;
}

@ApiTags('Notificações')
@ApiBearerAuth()
@Controller('me')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('notifications')
  @ApiOperation({ summary: 'Notificações do usuário' })
  async list(@CurrentUser() user: AuthUser, @Query() query: NotificationsQueryDto) {
    const where = { userId: user.userId, ...(query.unreadOnly ? { readAt: null } : {}) };
    const [total, unread, rows] = await this.prisma.$transaction([
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId: user.userId, readAt: null } }),
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: skipOf(query), take: query.pageSize }),
    ]);
    return { ...paginated(rows, total, query), unread };
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  async markRead(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId: user.userId, readAt: null }, data: { readAt: new Date() } });
  }

  @Post('notifications/read-all')
  @HttpCode(204)
  async markAllRead(@CurrentUser() user: AuthUser) {
    await this.prisma.notification.updateMany({ where: { userId: user.userId, readAt: null }, data: { readAt: new Date() } });
  }

  @Post('devices')
  @HttpCode(204)
  @ApiOperation({ summary: 'Registrar dispositivo para push' })
  async registerDevice(@CurrentUser() user: AuthUser, @Body() dto: RegisterDeviceDto) {
    await this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      create: { userId: user.userId, token: dto.token, platform: dto.platform, app: dto.app },
      update: { userId: user.userId, platform: dto.platform, app: dto.app, lastSeenAt: new Date() },
    });
  }

  @Delete('devices/:token')
  @HttpCode(204)
  async unregisterDevice(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { token, userId: user.userId } });
  }
}
