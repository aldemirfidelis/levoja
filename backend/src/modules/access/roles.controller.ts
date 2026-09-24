import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { RolesService } from './roles.service';
import { RoleScope } from '../../generated/prisma/enums';

class RoleDto {
  @ApiPropertyOptional({ example: 'atendimento_n2', description: 'Somente na criação' })
  @IsOptional()
  @IsString()
  @Length(3, 40)
  key?: string;

  @ApiProperty() @IsString() @Length(2, 80) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) description?: string;
  @ApiPropertyOptional({ enum: RoleScope }) @IsOptional() @IsEnum(RoleScope) scope?: RoleScope;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isStaff?: boolean;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  permissionKeys!: string[];
}

class UserRolesDto {
  @ApiProperty({ type: [String], example: ['support'] })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  roleKeys!: string[];
}

@ApiTags('Admin • Papéis e permissões')
@ApiBearerAuth()
@Controller('admin')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermissions('roles.read')
  @ApiOperation({ summary: 'Catálogo de permissões' })
  permissions() {
    return this.roles.listPermissions();
  }

  @Get('roles')
  @RequirePermissions('roles.read')
  @ApiOperation({ summary: 'Listar papéis com suas permissões' })
  list(@CurrentUser() user: AuthUser) {
    return this.roles.listRoles(user.tenantId);
  }

  @Post('roles')
  @RequirePermissions('roles.manage')
  @ApiOperation({ summary: 'Criar papel' })
  create(@CurrentUser() user: AuthUser, @Body() dto: RoleDto) {
    return this.roles.create(user.tenantId, dto);
  }

  @Patch('roles/:id')
  @RequirePermissions('roles.manage')
  @ApiOperation({ summary: 'Atualizar papel e permissões' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RoleDto) {
    return this.roles.update(user.tenantId, id, dto);
  }

  @Delete('roles/:id')
  @HttpCode(204)
  @RequirePermissions('roles.manage')
  @ApiOperation({ summary: 'Excluir papel personalizado' })
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.roles.remove(user.tenantId, id);
  }

  @Put('users/:id/roles')
  @RequirePermissions('roles.manage')
  @ApiOperation({ summary: 'Definir papéis de plataforma de um usuário' })
  async setUserRoles(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UserRolesDto) {
    return { roleKeys: await this.roles.setUserRoles(user, id, dto.roleKeys) };
  }
}
