import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { AddressesService } from './addresses.service';
import { AddressDto } from './address.dto';

@ApiTags('Endereços')
@ApiBearerAuth()
@Controller('me/addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  @ApiOperation({ summary: 'Meus endereços' })
  list(@CurrentUser() user: AuthUser) {
    return this.addresses.list(user.userId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: AddressDto) {
    return this.addresses.create(user.userId, dto);
  }

  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddressDto) {
    return this.addresses.update(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.addresses.remove(user.userId, id);
  }
}
