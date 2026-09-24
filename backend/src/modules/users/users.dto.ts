import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination';
import { UserStatus } from '../../generated/prisma/enums';

export class AdminUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: UserStatus }) @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @ApiPropertyOptional({ example: 'support' }) @IsOptional() @IsString() role?: string;
  @ApiPropertyOptional({ enum: ['customer', 'driver', 'company', 'staff'] })
  @IsOptional()
  @IsIn(['customer', 'driver', 'company', 'staff'])
  type?: 'customer' | 'driver' | 'company' | 'staff';
}

export class AdminCreateUserDto {
  @ApiProperty() @IsString() @Length(3, 120) name!: string;
  @ApiProperty() @IsEmail() email!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(10, 20) phone?: string;
  @ApiProperty({ type: [String], example: ['support'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  roleKeys!: string[];
}

export class AdminUpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(10, 20) phone?: string;
}

export class UserStatusActionDto {
  @ApiProperty({ enum: ['SUSPEND', 'BLOCK', 'DEACTIVATE', 'REACTIVATE'] })
  @IsIn(['SUSPEND', 'BLOCK', 'DEACTIVATE', 'REACTIVATE'])
  action!: 'SUSPEND' | 'BLOCK' | 'DEACTIVATE' | 'REACTIVATE';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

/** Preferências de interface. Comunicações de marketing são controladas por consentimento (/me/consents). */
class PreferencesDto {
  @ApiPropertyOptional({ enum: ['light', 'dark', 'system'] }) @IsOptional() @IsIn(['light', 'dark', 'system']) theme?: string;
}

export class UpdateMeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(10, 20) phone?: string;
  @ApiPropertyOptional({ example: '1990-05-20' }) @IsOptional() @IsDateString() birthDate?: string;
  @ApiPropertyOptional({ description: 'Somente se ainda não informado' }) @IsOptional() @IsString() @Length(11, 14) cpf?: string;
  @ApiPropertyOptional({ type: PreferencesDto }) @IsOptional() @ValidateNested() @Type(() => PreferencesDto) preferences?: PreferencesDto;
}
