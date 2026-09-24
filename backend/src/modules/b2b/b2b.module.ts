import { Global, Module } from '@nestjs/common';
import { AdminB2bController, CompanyB2bController, DeliveryBatchesController } from './b2b.controller';
import { B2bEventsListener } from './b2b-events.listener';
import { BatchesService } from './batches.service';
import { CompanyB2bService } from './company-b2b.service';
import { ContractsService } from './contracts.service';
import { InvoicesService } from './invoices.service';
import { RecurringService } from './recurring.service';

/** Corporativo: contratos, tabelas especiais, centros de custo, unidades, lotes, rotas, recorrências, faturas e API. */
@Global()
@Module({
  controllers: [CompanyB2bController, DeliveryBatchesController, AdminB2bController],
  providers: [ContractsService, CompanyB2bService, BatchesService, InvoicesService, RecurringService, B2bEventsListener],
  exports: [ContractsService, CompanyB2bService, BatchesService, InvoicesService],
})
export class B2bModule {}
