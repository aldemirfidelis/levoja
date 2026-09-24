import { Module } from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { AddressesController } from './addresses.controller';

@Module({
  providers: [AddressesService],
  controllers: [AddressesController],
  exports: [AddressesService],
})
export class CustomersModule {}
