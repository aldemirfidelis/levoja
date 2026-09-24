import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
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
import { DeliveryStatus, ItemCategory, PaymentMethod, ProofMethod, VehicleType } from '../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class StopDto {
  @ApiPropertyOptional({ description: 'Endereço salvo do solicitante (alternativa aos campos abaixo)' }) @IsOptional() @IsUUID() addressId?: string;
  @ApiPropertyOptional({ description: 'Unidade/local cadastrado da empresa (entregas corporativas e transferências)' }) @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional({ description: 'Nome de quem entrega/recebe' }) @IsOptional() @IsString() @MaxLength(120) @Transform(trim) contactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) contactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{5}-?\d{3}$/) zipCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) street?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) number?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) complement?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) district?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) city?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Za-z]{2}$/) state?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() lng?: number;
}

export class DeliveryQuoteDto {
  @ApiPropertyOptional({ type: StopDto, description: 'Para empresas, padrão = endereço da empresa' })
  @IsOptional()
  @ValidateNested()
  @Type(() => StopDto)
  pickup?: StopDto;

  @ApiProperty({ type: StopDto }) @ValidateNested() @Type(() => StopDto) dropoff!: StopDto;
  @ApiProperty({ enum: ItemCategory }) @IsEnum(ItemCategory) itemCategory!: ItemCategory;
  @ApiPropertyOptional({ description: 'Peso aproximado (kg)' }) @IsOptional() @IsNumber() @Min(0) @Max(2000) weightKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(500) lengthCm?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(500) widthCm?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(500) heightCm?: number;
  @ApiPropertyOptional({ enum: VehicleType, description: 'Veículo desejado (se maior que o mínimo exigido pela carga)' })
  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;
  @ApiPropertyOptional({ description: 'Entrega agendada (ISO 8601). Vazio = imediata.' }) @IsOptional() @IsDateString() scheduledFor?: string;
}

export class CreateDeliveryDto extends DeliveryQuoteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) itemDescription?: string;
  @ApiPropertyOptional({ description: 'Valor declarado (centavos)' }) @IsOptional() @IsInt() @Min(0) @Max(100_000_000) declaredValueCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiProperty({ enum: PaymentMethod }) @IsEnum(PaymentMethod) paymentMethod!: PaymentMethod;
  @ApiPropertyOptional({ enum: ProofMethod, default: 'CODE' }) @IsOptional() @IsEnum(ProofMethod) proofMethod?: ProofMethod;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000) tipCents?: number;
  @ApiPropertyOptional({ description: 'Centro de custo (empresas)' }) @IsOptional() @IsUUID() costCenterId?: string;
  @ApiPropertyOptional({ description: 'Sua referência (pedido, nota fiscal, protocolo)' }) @IsOptional() @IsString() @MaxLength(60) @Transform(trim) externalRef?: string;
}

export class CancelDeliveryDto {
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class DeliverDto {
  @ApiProperty({ enum: ProofMethod }) @IsEnum(ProofMethod) method!: ProofMethod;
  @ApiPropertyOptional({ description: 'Código informado/escaneado (CODE / QR_CODE)' }) @IsOptional() @IsString() @MaxLength(200) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) recipientName?: string;
  @ApiPropertyOptional({ description: 'Documento conferido (itens com idade mínima)' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  idChecked?: boolean;
}

export class FailDeliveryDto {
  @ApiProperty({ enum: ['RECIPIENT_ABSENT', 'WRONG_ADDRESS', 'REFUSED', 'DAMAGED', 'UNSAFE_LOCATION', 'OTHER'] })
  @IsIn(['RECIPIENT_ABSENT', 'WRONG_ADDRESS', 'REFUSED', 'DAMAGED', 'UNSAFE_LOCATION', 'OTHER'])
  reasonCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) details?: string;
}

export class LocationPointDto {
  @ApiProperty() @IsLatitude() lat!: number;
  @ApiProperty() @IsLongitude() lng!: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(10_000) accuracy?: number;
  @ApiPropertyOptional({ description: 'm/s' }) @IsOptional() @IsNumber() @Min(0) @Max(100) speed?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(360) heading?: number;
  @ApiPropertyOptional({ description: 'Momento da leitura no aparelho (sincronização offline)' }) @IsOptional() @IsDateString() recordedAt?: string;
  @ApiPropertyOptional({ description: 'Leitura marcada pelo sistema como localização simulada (Android)' }) @IsOptional() @IsBoolean() mocked?: boolean;
}

export class LocationBatchDto {
  @ApiProperty({ type: [LocationPointDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => LocationPointDto)
  points!: LocationPointDto[];
}

export class AvailabilityDto {
  @ApiProperty() @IsBoolean() online!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() lng?: number;
}

export class DeclineOfferDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class DeliveriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DeliveryStatus }) @IsOptional() @IsEnum(DeliveryStatus) status?: DeliveryStatus;
  @ApiPropertyOptional({ enum: ['active', 'finished'] }) @IsOptional() @IsIn(['active', 'finished']) scope?: 'active' | 'finished';
  @ApiPropertyOptional() @IsOptional() @IsUUID() driverId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
}

export class AssignDriverDto {
  @ApiProperty() @IsUUID() driverId!: string;
}

export class ReviewInputDto {
  @ApiProperty({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) rating!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) comment?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) tags?: string[];
}

export class OrderReviewDto {
  @ApiPropertyOptional({ type: ReviewInputDto }) @IsOptional() @ValidateNested() @Type(() => ReviewInputDto) company?: ReviewInputDto;
  @ApiPropertyOptional({ type: ReviewInputDto }) @IsOptional() @ValidateNested() @Type(() => ReviewInputDto) driver?: ReviewInputDto;
}
