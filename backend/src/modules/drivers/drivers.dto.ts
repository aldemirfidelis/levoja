import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination';
import { DriverDocumentType, PartnerStatus, VehicleType } from '../../generated/prisma/enums';

export class VehicleDto {
  @ApiProperty({ enum: VehicleType }) @IsEnum(VehicleType) type!: VehicleType;

  @ApiPropertyOptional({ example: 'ABC1D23', description: 'Obrigatória para veículos motorizados' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]/g, '') : value))
  @Matches(/^[A-Z]{3}\d[A-Z0-9]\d{2}$/, { message: 'Placa inválida (padrão antigo ou Mercosul).' })
  plate?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) brand?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) model?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1950) @Max(2100) year?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) color?: string;
  @ApiPropertyOptional({ description: 'Capacidade de carga (kg)' }) @IsOptional() @IsNumber() @Min(0) @Max(5000) maxWeightKg?: number;
}

export class UpdateVehicleDto extends PartialType(VehicleDto) {}

export class CreateDriverDto {
  @ApiProperty({ enum: VehicleType }) @IsEnum(VehicleType) vehicleType!: VehicleType;
}

export class UpdateDriverDto {
  @ApiPropertyOptional({ description: 'Obrigatório se ainda não informado no perfil' })
  @IsOptional()
  @IsString()
  @Length(11, 14)
  cpf?: string;

  @ApiPropertyOptional({ example: '1995-03-10' }) @IsOptional() @IsDateString() birthDate?: string;

  @ApiPropertyOptional({ example: '01234567890' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\D/g, '') : value))
  @Matches(/^\d{11}$/, { message: 'Número da CNH deve ter 11 dígitos.' })
  cnhNumber?: string;

  @ApiPropertyOptional({ example: 'A' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsIn(['A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE'])
  cnhCategory?: string;

  @ApiPropertyOptional({ example: '2030-01-31' }) @IsOptional() @IsDateString() cnhExpiresAt?: string;
}

export class UploadDriverDocumentDto {
  @ApiProperty({ enum: DriverDocumentType }) @IsEnum(DriverDocumentType) type!: DriverDocumentType;
  @ApiPropertyOptional({ description: 'Para documentos do veículo' }) @IsOptional() @IsUUID() vehicleId?: string;
}

export class AdminDriversQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PartnerStatus }) @IsOptional() @IsEnum(PartnerStatus) status?: PartnerStatus;
  @ApiPropertyOptional({ enum: VehicleType }) @IsOptional() @IsEnum(VehicleType) vehicleType?: VehicleType;
}

export class ReviewVehicleDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] }) @IsIn(['APPROVED', 'REJECTED']) status!: 'APPROVED' | 'REJECTED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}
