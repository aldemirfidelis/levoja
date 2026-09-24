import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Period } from '../../common/time-range';
import type { HeatLayer, HeatPrecision } from './operations.service';
import type { Granularity } from './reports.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);
const PERIODS: Period[] = ['today', 'week', 'month'];
const LAYERS: HeatLayer[] = ['demand', 'orders', 'deliveries', 'drivers'];
const PRECISIONS: HeatPrecision[] = ['fine', 'medium', 'coarse'];
const GRANULARITIES: Granularity[] = ['day', 'week', 'month'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class SnapshotQueryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(80) city?: string;
}

export class HeatmapQueryDto {
  @ApiPropertyOptional({ enum: LAYERS, default: 'demand' }) @IsOptional() @IsIn(LAYERS) layer: HeatLayer = 'demand';
  @ApiPropertyOptional({ enum: PERIODS, default: 'week' }) @IsOptional() @IsIn(PERIODS) period: Period = 'week';
  @ApiPropertyOptional({ enum: PRECISIONS, default: 'medium' }) @IsOptional() @IsIn(PRECISIONS) precision?: HeatPrecision;
  @ApiPropertyOptional({ minimum: 0, maximum: 23 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(23) fromHour?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 23 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(23) toHour?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(80) city?: string;

  @ApiPropertyOptional({ description: 'Recorte do mapa: sul,oeste,norte,leste' })
  @IsOptional()
  @Matches(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/, { message: 'bbox deve ser "sul,oeste,norte,leste".' })
  bbox?: string;
}

export class ReportQueryDto {
  @ApiPropertyOptional({ description: 'Data inicial (AAAA-MM-DD)' }) @IsOptional() @Matches(DATE, { message: 'Use AAAA-MM-DD.' }) from?: string;
  @ApiPropertyOptional({ description: 'Data final, inclusiva (AAAA-MM-DD)' }) @IsOptional() @Matches(DATE, { message: 'Use AAAA-MM-DD.' }) to?: string;
  @ApiPropertyOptional({ enum: GRANULARITIES }) @IsOptional() @IsIn(GRANULARITIES) granularity?: Granularity;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(80) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() segmentId?: string;
  @ApiPropertyOptional({ description: 'Centro de custo (relatório corporativo)' }) @IsOptional() @IsUUID() costCenterId?: string;
  @ApiPropertyOptional({ enum: ['json', 'csv'], default: 'json' }) @IsOptional() @IsIn(['json', 'csv']) format?: 'json' | 'csv';
  @ApiPropertyOptional({ description: 'Tabela exportada no CSV (padrão: a principal do relatório)' }) @IsOptional() @IsString() @MaxLength(40) table?: string;
}

export class CompanyDashboardQueryDto {
  @ApiPropertyOptional({ enum: PERIODS, default: 'today' }) @IsOptional() @IsIn(PERIODS) period: Period = 'today';
}
