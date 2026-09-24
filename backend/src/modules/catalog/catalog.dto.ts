import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination';
import { ProductStatus, ProductType, ServiceAreaType } from '../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CategoryDto {
  @ApiProperty() @IsString() @Length(1, 60) @Transform(trim) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) description?: string;
  @ApiPropertyOptional({ description: 'Categoria pai (subcategoria)' }) @IsOptional() @IsUUID() parentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateCategoryDto extends PartialType(CategoryDto) {}

export class OptionDto {
  @ApiProperty() @IsString() @Length(1, 60) @Transform(trim) name!: string;
  @ApiPropertyOptional({ description: 'Acréscimo no preço, em centavos' }) @IsOptional() @IsInt() @Min(-1_000_000) @Max(1_000_000) priceDeltaCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) sku?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() trackStock?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) stockQuantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class OptionGroupDto {
  @ApiProperty({ example: 'Tamanho' }) @IsString() @Length(1, 60) @Transform(trim) name!: string;
  @ApiProperty({ example: 1 }) @IsInt() @Min(0) @Max(50) minSelect!: number;
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) @Max(50) maxSelect!: number;
  @ApiProperty({ type: [OptionDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OptionDto)
  options!: OptionDto[];
}

export class ComboItemDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(50) quantity!: number;
}

export class ProductDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ enum: ProductType }) @IsOptional() @IsEnum(ProductType) type?: ProductType;
  @ApiProperty() @IsString() @Length(2, 120) @Transform(trim) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) sku?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) barcode?: string;
  @ApiProperty({ description: 'Preço em centavos' }) @IsInt() @Min(0) @Max(100_000_000) priceCents!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000_000) promoPriceCents?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() promoStartsAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() promoEndsAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() trackStock?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000_000) stockQuantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(2_000_000) weightGrams?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1000) lengthCm?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1000) widthCm?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1000) heightCm?: number;
  @ApiPropertyOptional({ enum: ProductStatus }) @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isRegulated?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresPrescription?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(21) minimumAge?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;

  @ApiPropertyOptional({ type: [OptionGroupDto], description: 'Substitui os grupos existentes' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OptionGroupDto)
  optionGroups?: OptionGroupDto[];

  @ApiPropertyOptional({ type: [ComboItemDto], description: 'Itens do combo (type=COMBO)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ComboItemDto)
  comboItems?: ComboItemDto[];
}

export class UpdateProductDto extends PartialType(ProductDto) {}

export class StockAdjustmentDto {
  @ApiProperty({ description: 'Variação (+ entrada, - saída)' }) @IsInt() @Min(-1_000_000) @Max(1_000_000) delta!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class ProductsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ enum: ProductStatus }) @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  lowStock?: boolean;
}

export class ServiceAreaDto {
  @ApiProperty() @IsString() @Length(2, 60) name!: string;
  @ApiProperty({ enum: ServiceAreaType }) @IsEnum(ServiceAreaType) type!: ServiceAreaType;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0.1) @Max(100) radiusKm?: number;
  @ApiPropertyOptional({ description: '[[lng, lat], ...]' }) @IsOptional() @IsArray() @ArrayMaxSize(500) polygon?: [number, number][];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) districts?: string[];
  @ApiPropertyOptional({ type: [String], example: ['São Paulo/SP'] }) @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) cities?: string[];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(-100_000) @Max(100_000) feeAdjustmentCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) minimumOrderCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(240) extraMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class StoresQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
  @ApiPropertyOptional({ description: 'Endereço salvo do cliente (alternativa a lat/lng)' }) @IsOptional() @IsUUID() addressId?: string;
  @ApiPropertyOptional({ description: 'Slug do segmento' }) @IsOptional() @IsString() segment?: string;
  @ApiPropertyOptional({ enum: ['distance', 'rating'] }) @IsOptional() @IsIn(['distance', 'rating']) sort?: 'distance' | 'rating';
}
