import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { BankAccountType, PixKeyType } from '../../generated/prisma/enums';

const digits = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/[^\dXx]/g, '') : value);

export class BankAccountDto {
  @ApiProperty() @IsString() @Length(3, 120) holderName!: string;

  @ApiProperty({ description: 'CPF ou CNPJ do titular' })
  @IsString()
  @Length(11, 18)
  holderDocument!: string;

  @ApiProperty({ example: '260', description: 'Código COMPE do banco (3 dígitos)' })
  @Matches(/^\d{3}$/, { message: 'Código do banco deve ter 3 dígitos.' })
  bankCode!: string;

  @ApiProperty({ example: '0001' })
  @Transform(digits)
  @Matches(/^\d{1,6}$/, { message: 'Agência inválida.' })
  branch!: string;

  @ApiProperty({ example: '12345678-9' })
  @Transform(digits)
  @Matches(/^\d{3,20}[\dXx]?$/, { message: 'Conta inválida.' })
  accountNumber!: string;

  @ApiProperty({ enum: BankAccountType }) @IsEnum(BankAccountType) accountType!: BankAccountType;
  @ApiPropertyOptional({ enum: PixKeyType }) @IsOptional() @IsEnum(PixKeyType) pixKeyType?: PixKeyType;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 140) pixKey?: string;
}
