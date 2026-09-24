import { Global, Module } from '@nestjs/common';
import { CompanyDashboardController, OperationsController, ReportsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { ReportsService } from './reports.service';

@Global()
@Module({
  controllers: [OperationsController, ReportsController, CompanyDashboardController],
  providers: [OperationsService, ReportsService],
  exports: [OperationsService, ReportsService],
})
export class OperationsModule {}
