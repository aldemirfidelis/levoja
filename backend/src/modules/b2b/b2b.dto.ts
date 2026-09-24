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
import { API_KEY_SCOPES, type ApiKeyScope } from '@levoja/shared';
import { PaginationQueryDto } from '../../common/pagination';
import { BatchItemStatus, ContractStatus, InvoiceStatus, ItemCategory, PaymentMethod, ProofMethod, VehicleType } from '../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const bool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// -----------------------------------------------------------------------------
// Contratos
// -----------------------------------------------------------------------------

export class ContractDto {
  @ApiProperty() @IsString() @Transform(trim) @Length(3, 120) title!: string;
  @ApiProperty({ example: '2026-10-01' }) @Matches(DATE) startsOn!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Matches(DATE) endsOn?: string | null;
  @ApiProperty({ minimum: 1, maximum: 28 }) @IsInt() @Min(1) @Max(28) billingDay!: number;
  @ApiProperty({ minimum: 1, maximum: 90 }) @IsInt() @Min(1) @Max(90) paymentTermDays!: number;
  @ApiProperty({ description: 'Limite de crédito (centavos)' }) @IsInt() @Min(0) @Max(1_000_000_000) creditLimitCents!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) minimumMonthlyCents?: number;
  @ApiPropertyOptional({ description: 'Desconto sobre a tabela padrão (pontos-base, 100 = 1%)' }) @IsOptional() @IsInt() @Min(0) @Max(9000) discountBps?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireCostCenter?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() notifyRecipients?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(90) blockAfterOverdueDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

export class CreateContractDto extends ContractDto {
  @ApiProperty() @IsUUID() companyId!: string;
}

export class UpdateContractDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Transform(trim) @Length(3, 120) title?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) startsOn?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Matches(DATE) endsOn?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(28) billingDay?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(90) paymentTermDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) creditLimitCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) minimumMonthlyCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(9000) discountBps?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireCostCenter?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() notifyRecipients?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(90) blockAfterOverdueDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

export class ContractsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ContractStatus }) @IsOptional() @IsEnum(ContractStatus) status?: ContractStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
}

export class ReasonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Transform(trim) @MaxLength(500) reason?: string;
}

export class PriceRuleDto {
  @ApiProperty() @IsString() @Transform(trim) @Length(2, 80) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(-100) @Max(100) priority?: number;
  @ApiPropertyOptional({ enum: VehicleType, nullable: true }) @IsOptional() @IsEnum(VehicleType) vehicleType?: VehicleType | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(80) city?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Matches(/^[A-Za-z]{2}$/) state?: string | null;
  @ApiProperty() @IsInt() @Min(0) @Max(10_000_000) baseCents!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000) perKmCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(500) includedKm?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000) perMinuteCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000) perKgCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(2000) includedKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000_000) minimumCents?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(0) @Max(100_000_000) maximumCents?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) nightSurchargeBps?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) rainSurchargeBps?: number;
}

export class UpdatePriceRuleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Transform(trim) @Length(2, 80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(-100) @Max(100) priority?: number;
  @ApiPropertyOptional({ enum: VehicleType, nullable: true }) @IsOptional() @IsEnum(VehicleType) vehicleType?: VehicleType | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(80) city?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Matches(/^[A-Za-z]{2}$/) state?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000_000) baseCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000) perKmCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(500) includedKm?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000) perMinuteCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000) perKgCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(2000) includedKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000_000) minimumCents?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(0) @Max(100_000_000) maximumCents?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) nightSurchargeBps?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) rainSurchargeBps?: number;
}

export class SimulateDto {
  @ApiProperty() @IsNumber() @Min(0) @Max(500) distanceKm!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1440) durationMin?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(2000) weightKg?: number;
  @ApiPropertyOptional({ enum: VehicleType }) @IsOptional() @IsEnum(VehicleType) vehicleType?: VehicleType;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) city?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Za-z]{2}$/) state?: string;
}

// -----------------------------------------------------------------------------
// Cadastros da empresa
// -----------------------------------------------------------------------------

export class CostCenterDto {
  @ApiProperty() @IsString() @Transform(trim) @Matches(/^[A-Za-z0-9._-]{1,20}$/, { message: 'Código com até 20 letras, números, ponto, hífen ou sublinhado.' }) code!: string;
  @ApiProperty() @IsString() @Transform(trim) @Length(2, 80) name!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Orçamento mensal (centavos); vazio = sem limite' }) @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) monthlyBudgetCents?: number | null;
}

export class UpdateCostCenterDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Transform(trim) @Length(2, 80) name?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) monthlyBudgetCents?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class LocationDto {
  @ApiProperty() @IsString() @Transform(trim) @Length(2, 80) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isUnit?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) contactName?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) contactPhone?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{5}-?\d{3}$/) zipCode?: string | null;
  @ApiProperty() @IsString() @Length(2, 150) street!: string;
  @ApiProperty() @IsString() @Length(1, 20) number!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) complement?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) district?: string | null;
  @ApiProperty() @IsString() @Length(2, 80) city!: string;
  @ApiProperty() @Matches(/^[A-Za-z]{2}$/) state!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) reference?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() lng?: number;
}

export class UpdateLocationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Transform(trim) @Length(2, 80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isUnit?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) contactName?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) contactPhone?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{5}-?\d{3}$/) zipCode?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 150) street?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 20) number?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) complement?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) district?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 80) city?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Za-z]{2}$/) state?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) reference?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() lng?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ApiKeyDto {
  @ApiProperty() @IsString() @Transform(trim) @Length(2, 60) name!: string;
  @ApiProperty({ enum: Object.keys(API_KEY_SCOPES), isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(Object.keys(API_KEY_SCOPES), { each: true })
  scopes!: ApiKeyScope[];
  @ApiPropertyOptional({ description: 'Validade em dias (vazio = sem expiração)' }) @IsOptional() @IsInt() @Min(1) @Max(730) expiresInDays?: number;
}

// -----------------------------------------------------------------------------
// Lotes
// -----------------------------------------------------------------------------

export class BatchOptionsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Transform(trim) @MaxLength(80) name?: string;
  @ApiPropertyOptional({ description: 'Unidade de coleta (padrão: endereço da empresa)' }) @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional({ description: 'Agendamento do lote (ISO 8601)' }) @IsOptional() @IsDateString() scheduledFor?: string;
  @ApiProperty({ enum: ['INVOICE', 'WALLET'] }) @IsIn(['INVOICE', 'WALLET']) paymentMethod!: PaymentMethod;
  @ApiPropertyOptional({ description: 'Centro de custo padrão das entregas' }) @IsOptional() @IsUUID() costCenterId?: string;
  @ApiPropertyOptional({ default: true, description: 'Agrupar em rotas (várias paradas por entregador)' }) @IsOptional() @Transform(bool) @IsBoolean() planRoutes?: boolean;
}

/** Entrega do lote via API (mesmos campos da planilha). */
export class BatchItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) externalRef?: string;
  @ApiProperty() @IsString() @MaxLength(120) recipientName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) recipientPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(9) zipCode?: string;
  @ApiProperty() @IsString() @MaxLength(150) street!: string;
  @ApiProperty() @IsString() @MaxLength(20) number!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) complement?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) district?: string;
  @ApiProperty() @IsString() @MaxLength(80) city!: string;
  @ApiProperty() @IsString() @MaxLength(2) state!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() lng?: number;
  @ApiPropertyOptional({ enum: ItemCategory }) @IsOptional() @IsEnum(ItemCategory) itemCategory?: ItemCategory;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) itemDescription?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1000) weightKg?: number;
  @ApiPropertyOptional({ description: 'Valor declarado (centavos)' }) @IsOptional() @IsInt() @Min(0) declaredValueCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiPropertyOptional({ description: 'Código do centro de custo' }) @IsOptional() @IsString() @MaxLength(20) costCenter?: string;
  @ApiPropertyOptional({ enum: ProofMethod }) @IsOptional() @IsEnum(ProofMethod) proofMethod?: ProofMethod;
}

export class CreateBatchDto extends BatchOptionsDto {
  @ApiProperty({ type: [BatchItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => BatchItemDto)
  items!: BatchItemDto[];
}

export class ConfirmBatchDto {
  @ApiPropertyOptional({ nullable: true, description: 'Novo horário (ISO 8601); null = enviar agora' }) @IsOptional() @IsDateString() scheduledFor?: string | null;
}

export class CancelBatchDto {
  @ApiProperty() @IsString() @Transform(trim) @Length(3, 300) reason!: string;
}

export class BatchItemsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: BatchItemStatus }) @IsOptional() @IsEnum(BatchItemStatus) status?: BatchItemStatus;
}

// -----------------------------------------------------------------------------
// Recorrências
// -----------------------------------------------------------------------------

export class RecurrenceStopDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) contactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) contactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{5}-?\d{3}$/) zipCode?: string;
  @ApiProperty() @IsString() @Length(2, 150) street!: string;
  @ApiProperty() @IsString() @Length(1, 20) number!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) complement?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) district?: string;
  @ApiProperty() @IsString() @Length(2, 80) city!: string;
  @ApiProperty() @Matches(/^[A-Za-z]{2}$/) state!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() lng?: number;
}

export class RecurrenceDto {
  @ApiProperty() @IsString() @Transform(trim) @Length(2, 80) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() pickupLocationId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() dropoffLocationId?: string | null;
  @ApiPropertyOptional({ type: RecurrenceStopDto }) @IsOptional() @ValidateNested() @Type(() => RecurrenceStopDto) dropoff?: RecurrenceStopDto | null;
  @ApiProperty({ type: [Number], description: '0 = domingo … 6 = sábado' }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) weekdays!: number[];
  @ApiProperty({ example: '09:00' }) @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) time!: string;
  @ApiProperty() @Matches(DATE) startsOn!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Matches(DATE) endsOn?: string | null;
  @ApiProperty({ enum: ItemCategory }) @IsEnum(ItemCategory) itemCategory!: ItemCategory;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) itemDescription?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1000) weightKg?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
  @ApiPropertyOptional({ enum: ProofMethod }) @IsOptional() @IsEnum(ProofMethod) proofMethod?: ProofMethod | null;
  @ApiProperty({ enum: ['INVOICE', 'WALLET'] }) @IsIn(['INVOICE', 'WALLET']) paymentMethod!: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @IsUUID() costCenterId?: string | null;
}

export class UpdateRecurrenceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Transform(trim) @Length(2, 80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() pickupLocationId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() dropoffLocationId?: string | null;
  @ApiPropertyOptional({ type: RecurrenceStopDto }) @IsOptional() @ValidateNested() @Type(() => RecurrenceStopDto) dropoff?: RecurrenceStopDto | null;
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) weekdays?: number[];
  @ApiPropertyOptional() @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) time?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) startsOn?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Matches(DATE) endsOn?: string | null;
  @ApiPropertyOptional({ enum: ItemCategory }) @IsOptional() @IsEnum(ItemCategory) itemCategory?: ItemCategory;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) itemDescription?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1000) weightKg?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
  @ApiPropertyOptional({ enum: ProofMethod }) @IsOptional() @IsEnum(ProofMethod) proofMethod?: ProofMethod | null;
  @ApiPropertyOptional({ enum: ['INVOICE', 'WALLET'] }) @IsOptional() @IsIn(['INVOICE', 'WALLET']) paymentMethod?: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @IsUUID() costCenterId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

// -----------------------------------------------------------------------------
// Faturas e relatório
// -----------------------------------------------------------------------------

export class InvoicesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: InvoiceStatus }) @IsOptional() @IsEnum(InvoiceStatus) status?: InvoiceStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
}

export class MarkPaidDto {
  @ApiProperty({ description: 'Referência do pagamento (comprovante, TED, boleto)' }) @IsString() @Transform(trim) @Length(3, 120) reference!: string;
}

export class CancelInvoiceDto {
  @ApiProperty() @IsString() @Transform(trim) @Length(3, 300) reason!: string;
}

export class CorporateReportQueryDto {
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) to?: string;
  @ApiPropertyOptional({ enum: ['day', 'week', 'month'] }) @IsOptional() @IsIn(['day', 'week', 'month']) granularity?: 'day' | 'week' | 'month';
  @ApiPropertyOptional() @IsOptional() @IsUUID() costCenterId?: string;
  @ApiPropertyOptional({ enum: ['json', 'csv'] }) @IsOptional() @IsIn(['json', 'csv']) format?: 'json' | 'csv';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) table?: string;
}
