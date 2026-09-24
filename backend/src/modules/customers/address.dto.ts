import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsLatitude, IsLongitude, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AddressDto {
  @ApiPropertyOptional({ example: 'Casa' }) @IsOptional() @IsString() @MaxLength(40) @Transform(trim) label?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) @Transform(trim) recipientName?: string;

  @ApiProperty({ example: '01310-100' })
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\D/g, '') : value))
  @Matches(/^\d{8}$/, { message: 'CEP inválido.' })
  zipCode!: string;

  @ApiProperty({ example: 'Avenida Paulista' }) @IsString() @Length(2, 150) @Transform(trim) street!: string;
  @ApiProperty({ example: '1000' }) @IsString() @Length(1, 20) @Transform(trim) number!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) @Transform(trim) complement?: string;
  @ApiProperty({ example: 'Bela Vista' }) @IsString() @Length(2, 80) @Transform(trim) district!: string;
  @ApiProperty({ example: 'São Paulo' }) @IsString() @Length(2, 80) @Transform(trim) city!: string;

  @ApiProperty({ example: 'SP' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{2}$/, { message: 'UF inválida.' })
  state!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) @Transform(trim) reference?: string;
  @ApiPropertyOptional({ example: -23.5614 }) @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional({ example: -46.6559 }) @IsOptional() @IsLongitude() lng?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}
