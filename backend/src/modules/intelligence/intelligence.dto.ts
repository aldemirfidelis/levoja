import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination';
import { AnomalyStatus, ReviewSubject, RiskCaseStatus, RiskLevel, RiskSignalType, SuggestionStatus } from '../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RiskCasesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RiskCaseStatus, description: 'Sem filtro: casos abertos e em análise' }) @IsOptional() @IsEnum(RiskCaseStatus) status?: RiskCaseStatus;
  @ApiPropertyOptional({ enum: RiskLevel }) @IsOptional() @IsEnum(RiskLevel) level?: RiskLevel;
}

export class RiskSignalsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RiskSignalType }) @IsOptional() @IsEnum(RiskSignalType) type?: RiskSignalType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
}

export class DismissCaseDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 500) reason!: string;
  @ApiPropertyOptional({ description: 'Dias em que a conta fica isenta das ações automáticas (0 = nenhum)', default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(180)
  trustDays = 30;
}

export class ConfirmCaseDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 500) reason!: string;
}

export class ManualSignalDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 500) message!: string;
  @ApiProperty({ minimum: 1, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) points!: number;
}

export class CityQueryDto {
  @ApiPropertyOptional({ description: 'Cidade normalizada ("sao paulo/sp")' }) @IsOptional() @IsString() @MaxLength(120) city?: string;
}

export class AnomaliesQueryDto {
  @ApiPropertyOptional({ enum: AnomalyStatus, description: 'Sem filtro: abertas e em acompanhamento' }) @IsOptional() @IsEnum(AnomalyStatus) status?: AnomalyStatus;
}

export class SuggestionsQueryDto {
  @ApiPropertyOptional({ enum: SuggestionStatus, description: 'Sem filtro: pendentes ainda válidas' }) @IsOptional() @IsEnum(SuggestionStatus) status?: SuggestionStatus;
}

export class ApplySuggestionDto {
  @ApiPropertyOptional({ description: 'Ajuste do percentual sugerido, em pontos-base (100 = 1%)' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000) surchargeBps?: number;
}

export class SurchargeDto {
  @ApiPropertyOptional({ description: 'Cidade (vazio = todas)' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(120) city?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 2) state?: string;
  @ApiProperty() @IsDateString() startsAt!: string;
  @ApiProperty() @IsDateString() endsAt!: string;
  @ApiProperty({ description: 'Pontos-base (100 = 1%)' }) @Type(() => Number) @IsInt() @Min(1) @Max(10_000) surchargeBps!: number;
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 300) reason!: string;
}

export class ReviewSummaryQueryDto {
  @ApiPropertyOptional({ enum: ReviewSubject }) @IsOptional() @IsEnum(ReviewSubject) subjectType?: ReviewSubject;
  @ApiPropertyOptional() @IsOptional() @IsUUID() subjectId?: string;
  @ApiPropertyOptional({ default: 90 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days = 90;
}

export class AssistantMessageDto {
  @ApiProperty({ enum: ['user', 'assistant'] }) @IsIn(['user', 'assistant']) role!: 'user' | 'assistant';
  @ApiProperty() @IsString() @Length(1, 4000) content!: string;
}

export class AskAssistantDto {
  @ApiProperty({ type: [AssistantMessageDto], description: 'Conversa (a última mensagem é a pergunta). Não é guardada no servidor.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AssistantMessageDto)
  messages!: AssistantMessageDto[];
}
