import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination';
import { FulfillmentType, OrderStatus, PaymentMethod } from '../../generated/prisma/enums';

export class QuoteOrderDto {
  @ApiProperty() @IsUUID() companyId!: string;
  @ApiPropertyOptional({ enum: FulfillmentType, default: 'DELIVERY' }) @IsOptional() @IsEnum(FulfillmentType) fulfillment?: FulfillmentType;
  @ApiPropertyOptional({ description: 'Obrigatório para entrega' }) @IsOptional() @IsUUID() addressId?: string;
  @ApiPropertyOptional({ description: 'Entrega/retirada agendada (ISO 8601)' }) @IsOptional() @IsDateString() scheduledFor?: string;
  @ApiPropertyOptional({ description: 'Gorjeta para o entregador, em centavos' }) @IsOptional() @IsInt() @Min(0) @Max(100_000) tipCents?: number;
  @ApiPropertyOptional({ example: 'BEMVINDO10' }) @IsOptional() @IsString() @Length(3, 40) couponCode?: string;
}

export class CheckoutDto extends QuoteOrderDto {
  @ApiProperty({ enum: PaymentMethod }) @IsEnum(PaymentMethod) paymentMethod!: PaymentMethod;
  @ApiPropertyOptional({ description: 'Troco para (dinheiro), em centavos' }) @IsOptional() @IsInt() @Min(0) changeForCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiPropertyOptional({ description: 'Receita enviada previamente (produtos que exigem receita)' }) @IsOptional() @IsUUID() prescriptionId?: string;
  @ApiPropertyOptional({ description: 'Token do cartão gerado pelo SDK do provedor (nunca o número do cartão)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cardToken?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(12) installments?: number;
  @ApiPropertyOptional({ description: 'Bandeira identificada na tokenização (ex.: visa, master)' }) @IsOptional() @IsString() @MaxLength(40) cardPaymentMethodId?: string;
  @ApiPropertyOptional({ description: 'Emissor identificado na tokenização' }) @IsOptional() @IsString() @MaxLength(40) cardIssuerId?: string;
}

export class CancelOrderDto {
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class HandoffDto {
  @ApiProperty({ description: 'Código de 4 dígitos informado pelo cliente' }) @Matches(/^\d{4}$/) code!: string;
}

export class OrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OrderStatus }) @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
  @ApiPropertyOptional({ enum: ['active', 'finished'] }) @IsOptional() @IsIn(['active', 'finished']) scope?: 'active' | 'finished';
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

export class AdminOrdersQueryDto extends OrdersQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
}
