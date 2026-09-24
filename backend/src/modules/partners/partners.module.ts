import { Global, Module } from '@nestjs/common';
import { BankAccountsService } from './bank-accounts.service';

/** Recursos compartilhados entre empresas e entregadores (parceiros). */
@Global()
@Module({
  providers: [BankAccountsService],
  exports: [BankAccountsService],
})
export class PartnersModule {}
