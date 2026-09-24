import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  NotEquals,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination';
import { CouponType, PaymentMethod, PaymentPurpose, PaymentStatus, WalletOwnerType, WithdrawalStatus } from '../../generated/prisma/enums';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class WithdrawalRequestDto {
  @ApiProperty({ description: 'Valor em centavos' }) @IsInt() @Min(1) @Max(100_000_000) amountCents!: number;
}

export class ReasonDto {
  @ApiProperty() @IsString() @Length(3, 300) reason!: string;
}

export class MarkPaidDto {
  @ApiProperty({ description: 'Identificador/comprovante da transferência' }) @IsString() @Length(3, 120) transferReference!: string;
}

export class RefundDto {
  @ApiProperty({ description: 'Valor em centavos' }) @IsInt() @Min(1) amountCents!: number;
  @ApiProperty() @IsString() @Length(3, 300) reason!: string;
  @ApiPropertyOptional({ description: 'Creditar na carteira do cliente em vez do meio original' }) @IsOptional() @IsBoolean() toWallet?: boolean;
}

export class AdjustmentDto {
  @ApiProperty({ description: 'Centavos: positivo = crédito, negativo = débito' }) @IsInt() @NotEquals(0) @Min(-10_000_000) @Max(10_000_000) amountCents!: number;
  @ApiProperty() @IsString() @Length(5, 300) reason!: string;
}

export class CommissionRuleDto {
  @ApiProperty() @IsString() @Length(2, 80) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() segmentId?: string | null;
  @ApiProperty({ description: 'Pontos-base (1200 = 12%)' }) @IsInt() @Min(0) @Max(5_000) percentBps!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000) fixedCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(-1000) @Max(1000) priority?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validFrom?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validTo?: string | null;
}

export class UpdateCommissionRuleDto extends PartialType(CommissionRuleDto) {}

export class CouponDto {
  @ApiProperty({ example: 'BEMVINDO10' }) @Matches(/^[A-Za-z0-9_-]{3,40}$/, { message: 'Código: 3 a 40 letras, números, "-" ou "_".' }) code!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) description?: string;
  @ApiProperty({ enum: CouponType }) @IsEnum(CouponType) type!: CouponType;
  @ApiPropertyOptional({ description: 'PERCENT: pontos-base (1000 = 10%)' }) @IsOptional() @IsInt() @Min(1) @Max(10_000) percentBps?: number;
  @ApiPropertyOptional({ description: 'FIXED: centavos' }) @IsOptional() @IsInt() @Min(1) @Max(1_000_000) amountCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) maxDiscountCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) minOrderCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() segmentId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() firstOrderOnly?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startsAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endsAt?: string | null;
  @ApiPropertyOptional({ type: [Number], description: '0 = domingo … 6 = sábado' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];
  @ApiPropertyOptional({ example: '18:00' }) @IsOptional() @Matches(HHMM) fromTime?: string | null;
  @ApiPropertyOptional({ example: '23:00' }) @IsOptional() @Matches(HHMM) toTime?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) maxRedemptions?: number | null;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(1000) maxPerCustomer?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateCouponDto extends PartialType(CouponDto) {}

/** Painel: cupom da plataforma, opcionalmente restrito a uma loja e/ou financiado por ela. */
export class AdminCouponDto extends CouponDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional({ enum: ['PLATFORM', 'COMPANY'], default: 'PLATFORM' }) @IsOptional() @IsIn(['PLATFORM', 'COMPANY']) fundedBy?: 'PLATFORM' | 'COMPANY';
}

export class PaymentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PaymentStatus }) @IsOptional() @IsEnum(PaymentStatus) status?: PaymentStatus;
  @ApiPropertyOptional({ enum: PaymentMethod }) @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @ApiPropertyOptional({ enum: PaymentPurpose }) @IsOptional() @IsEnum(PaymentPurpose) purpose?: PaymentPurpose;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

export class WithdrawalsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: WithdrawalStatus }) @IsOptional() @IsEnum(WithdrawalStatus) status?: WithdrawalStatus;
}

export class WalletsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: WalletOwnerType }) @IsOptional() @IsEnum(WalletOwnerType) ownerType?: WalletOwnerType;
  @ApiPropertyOptional({ enum: ['negative', 'positive'] }) @IsOptional() @IsIn(['negative', 'positive']) balance?: 'negative' | 'positive';
}

export class PeriodQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

export class VerifyWalletsDto {
  @ApiPropertyOptional({ default: 500 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5_000) limit?: number;
}
