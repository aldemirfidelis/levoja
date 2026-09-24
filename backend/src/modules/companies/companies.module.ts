import { Module } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CompanyReviewService } from './company-review.service';
import { CompanyMembersService } from './company-members.service';
import { AdminCompaniesController, CompaniesController } from './companies.controller';
import { CompanyEventsListener } from './company-events.listener';

@Module({
  providers: [CompaniesService, CompanyReviewService, CompanyMembersService, CompanyEventsListener],
  controllers: [CompaniesController, AdminCompaniesController],
  exports: [CompaniesService],
})
export class CompaniesModule {}
