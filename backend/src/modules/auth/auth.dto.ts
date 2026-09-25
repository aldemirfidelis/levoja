import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateCompanyDto } from '../companies/companies.dto';
import { VehicleType } from '../../generated/prisma/enums';

class BaseRegisterDto {
  @ApiProperty({ example: 'Maria Silva' }) @IsString() @Length(3, 120) name!: string;
  @ApiProperty({ example: 'maria@email.com' }) @IsEmail() email!: string;
  @ApiProperty({ example: '(11) 98765-4321' }) @IsString() @Length(10, 20) phone!: string;
  @ApiProperty({ example: 'SenhaForte123' }) @IsString() @Length(8, 128) password!: string;

  @ApiProperty({ description: 'Aceite dos Termos de Uso (obrigatório)' })
  @IsBoolean()
  @Equals(true, { message: 'É necessário aceitar os Termos de Uso.' })
  acceptTerms!: boolean;

  @ApiProperty({ description: 'Ciência da Política de Privacidade (obrigatório)' })
  @IsBoolean()
  @Equals(true, { message: 'É necessário aceitar a Política de Privacidade.' })
  acceptPrivacy!: boolean;

  @ApiPropertyOptional({ description: 'Opt-in para comunicações de marketing' }) @IsOptional() @IsBoolean() marketingOptIn?: boolean;
  @ApiPropertyOptional({ description: 'Código de indicação de quem convidou (programa Indique e ganhe)', example: 'MARIA7K2' })
  @IsOptional()
  @IsString()
  @Length(3, 20)
  referralCode?: string;
}

export class RegisterCustomerDto extends BaseRegisterDto {
  @ApiPropertyOptional({ example: '529.982.247-25' }) @IsOptional() @IsString() @Length(11, 14) cpf?: string;
  @ApiPropertyOptional({ example: '1990-05-20' }) @IsOptional() @IsDateString() birthDate?: string;
}

export class RegisterDriverDto extends BaseRegisterDto {
  @ApiProperty({ example: '529.982.247-25' }) @IsString() @Length(11, 14) cpf!: string;
  @ApiProperty({ example: '1995-03-10' }) @IsDateString() birthDate!: string;
  @ApiProperty({ enum: VehicleType }) @IsEnum(VehicleType) vehicleType!: VehicleType;

  @ApiProperty({ description: 'Aceite dos Termos do Entregador' })
  @IsBoolean()
  @Equals(true, { message: 'É necessário aceitar os Termos do Entregador.' })
  acceptDriverTerms!: boolean;

  @ApiProperty({ description: 'Consentimento de uso da localização durante as entregas' })
  @IsBoolean()
  @Equals(true, { message: 'A localização é necessária para realizar entregas.' })
  acceptLocationTracking!: boolean;
}

export class RegisterCompanyDto extends BaseRegisterDto {
  @ApiProperty({ example: '529.982.247-25', description: 'CPF do usuário responsável' }) @IsString() @Length(11, 14) cpf!: string;

  @ApiProperty({ type: CreateCompanyDto })
  @ValidateNested()
  @Type(() => CreateCompanyDto)
  company!: CreateCompanyDto;

  @ApiProperty({ description: 'Aceite dos Termos para Empresas' })
  @IsBoolean()
  @Equals(true, { message: 'É necessário aceitar os Termos para Empresas.' })
  acceptCompanyTerms!: boolean;
}

export class LoginDto {
  @ApiProperty({ description: 'E-mail ou telefone', example: 'maria@email.com' }) @IsString() @Length(5, 254) login!: string;
  @ApiProperty() @IsString() @Length(1, 128) password!: string;
  @ApiPropertyOptional({ enum: ['CUSTOMER', 'DRIVER', 'COMPANY', 'ADMIN'], description: 'Aplicação de origem' })
  @IsOptional()
  @IsIn(['CUSTOMER', 'DRIVER', 'COMPANY', 'ADMIN'])
  app?: 'CUSTOMER' | 'DRIVER' | 'COMPANY' | 'ADMIN';
}

export class MfaLoginDto {
  @ApiProperty() @IsString() mfaToken!: string;
  @ApiProperty({ example: '123456' }) @Matches(/^\d{6}$/) code!: string;
  @ApiPropertyOptional({ enum: ['CUSTOMER', 'DRIVER', 'COMPANY', 'ADMIN'] })
  @IsOptional()
  @IsIn(['CUSTOMER', 'DRIVER', 'COMPANY', 'ADMIN'])
  app?: 'CUSTOMER' | 'DRIVER' | 'COMPANY' | 'ADMIN';
}

export class RefreshDto {
  @ApiProperty() @IsString() @Length(20, 200) refreshToken!: string;
}

export class ForgotPasswordDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiPropertyOptional({ enum: ['web', 'admin'] }) @IsOptional() @IsIn(['web', 'admin']) portal?: 'web' | 'admin';
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() @Length(20, 200) token!: string;
  @ApiProperty() @IsString() @Length(8, 128) password!: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @MaxLength(128) currentPassword!: string;
  @ApiProperty() @IsString() @Length(8, 128) newPassword!: string;
}

export class MfaCodeDto {
  @ApiProperty({ example: '123456' }) @Matches(/^\d{6}$/) code!: string;
}

export class MfaDisableDto extends MfaCodeDto {
  @ApiProperty() @IsString() @MaxLength(128) password!: string;
}

export class VerificationChannelDto {
  @ApiProperty({ enum: ['email', 'phone'] }) @IsIn(['email', 'phone']) channel!: 'email' | 'phone';
}

export class VerifyCodeDto extends VerificationChannelDto {
  @ApiProperty({ example: '123456' }) @Matches(/^\d{6}$/) code!: string;
}
