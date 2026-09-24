import { Global, Module } from '@nestjs/common';
import { DeliveriesService } from './deliveries.service';
import { DispatchService } from './dispatch.service';
import { TrackingService } from './tracking.service';
import { ReviewsService } from './reviews.service';
import { LogisticsEventsListener } from './logistics-events.listener';
import {
  AdminLogisticsController,
  CompanyDeliveriesController,
  CustomerDeliveriesController,
  DriverOperationsController,
  PublicTrackingController,
} from './logistics.controller';

/**
 * Fase 3 — Logística: entregas (pedidos e avulsas), despacho, rastreamento, geofence,
 * prova de entrega, entregas agendadas, multipedidos e avaliações.
 */
@Global()
@Module({
  providers: [DeliveriesService, DispatchService, TrackingService, ReviewsService, LogisticsEventsListener],
  controllers: [DriverOperationsController, CustomerDeliveriesController, CompanyDeliveriesController, PublicTrackingController, AdminLogisticsController],
  exports: [DeliveriesService, DispatchService, TrackingService, ReviewsService],
})
export class LogisticsModule {}
