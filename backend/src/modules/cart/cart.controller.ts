import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { CartService } from './cart.service';

class AddCartItemDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty({ minimum: 1, maximum: 99 }) @IsInt() @Min(1) @Max(99) quantity!: number;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) optionIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) notes?: string;
}

class UpdateCartItemDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(99) quantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) notes?: string;
}

@ApiTags('Carrinho')
@ApiBearerAuth()
@Controller('cart')
@RequirePermissions('customer.orders.create')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiOperation({ summary: 'Carrinhos abertos (um por loja)' })
  list(@CurrentUser() user: AuthUser) {
    return this.cart.listCarts(user);
  }

  @Get(':companyId')
  get(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.cart.getCart(user, companyId);
  }

  @Post('items')
  @ApiOperation({ summary: 'Adicionar produto (com opções) ao carrinho da loja' })
  add(@CurrentUser() user: AuthUser, @Body() dto: AddCartItemDto) {
    return this.cart.addItem(user, dto);
  }

  @Patch('items/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCartItemDto) {
    return this.cart.updateItem(user, id, dto);
  }

  @Delete('items/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.cart.removeItem(user, id);
  }

  @Delete(':companyId')
  @HttpCode(204)
  async clear(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string) {
    await this.cart.clear(user, companyId);
  }
}
