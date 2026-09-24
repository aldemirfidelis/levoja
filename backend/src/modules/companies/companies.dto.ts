import { ApiProperty, ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination';
import {
  CompanyDocumentType,
  DocumentStatus,
  FulfillmentMode,
  PartnerStatus,
} from '../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateCompanyDto {
  @ApiProperty({ example: 'Sabor Caseiro Alimentos LTDA' }) @IsString() @Length(3, 150) @Transform(trim) legalName!: string;
  @ApiProperty({ example: 'Sabor Caseiro' }) @IsString() @Length(2, 80) @Transform(trim) tradeName!: string;
  @ApiProperty({ example: '11.222.333/0001-81', description: 'CNPJ numérico ou alfanumérico' })
  @IsString()
  @Length(14, 18)
  cnpj!: string;
  @ApiProperty() @IsUUID() segmentId!: string;
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty({ example: '(11) 3333-4444' }) @IsString() @Length(10, 20) phone!: string;
  @ApiProperty() @IsString() @Length(3, 120) @Transform(trim) responsibleName!: string;
  @ApiProperty({ example: '529.982.247-25' }) @IsString() @Length(11, 14) responsibleCpf!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {
  @ApiPropertyOptional({ minimum: 1, maximum: 240 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(240)
  averagePrepMinutes?: number;

  @ApiPropertyOptional({ description: 'Pedido mínimo em centavos' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  minimumOrderCents?: number;

  @ApiPropertyOptional({ enum: FulfillmentMode }) @IsOptional() @IsEnum(FulfillmentMode) fulfillmentMode?: FulfillmentMode;
}

export class OpeningHourDto {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0 = domingo' }) @IsInt() @Min(0) @Max(6) weekday!: number;
  @ApiProperty({ example: '08:00' }) @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) opensAt!: string;
  @ApiProperty({ example: '18:00' }) @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) closesAt!: string;
}

export class OpeningHoursDto {
  @ApiProperty({ type: [OpeningHourDto] })
  @IsArray()
  @ArrayMaxSize(42)
  @ValidateNested({ each: true })
  @Type(() => OpeningHourDto)
  hours!: OpeningHourDto[];
}

export class SetOpenDto {
  @ApiProperty() @IsBoolean() isOpen!: boolean;
}

export class UploadCompanyDocumentDto {
  @ApiProperty({ enum: CompanyDocumentType }) @IsEnum(CompanyDocumentType) type!: CompanyDocumentType;
}

export class ReviewDocumentDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] }) @IsIn(['APPROVED', 'REJECTED']) status!: Exclude<DocumentStatus, 'PENDING'>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class PartnerActionDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT', 'REQUEST_CHANGES', 'SUSPEND', 'BLOCK', 'REACTIVATE'] })
  @IsIn(['APPROVE', 'REJECT', 'REQUEST_CHANGES', 'SUSPEND', 'BLOCK', 'REACTIVATE'])
  action!: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES' | 'SUSPEND' | 'BLOCK' | 'REACTIVATE';

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class AdminCompaniesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PartnerStatus }) @IsOptional() @IsEnum(PartnerStatus) status?: PartnerStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() segmentId?: string;
}

export class AddMemberDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiPropertyOptional({ description: 'Obrigatório se o usuário ainda não tiver conta' })
  @IsOptional()
  @IsString()
  @Length(3, 120)
  name?: string;
  @ApiProperty({ example: 'company_attendant' }) @IsString() roleKey!: string;
}

export class UpdateMemberDto extends PickType(AddMemberDto, ['roleKey'] as const) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
