import { Global, Module } from '@nestjs/common';
import { MapsService } from './geo/maps.service';
import { SettingsService } from './settings/settings.service';
import { PricingService } from './pricing/pricing.service';
import { PricingController } from './pricing/pricing.controller';
import { CatalogService } from './catalog/catalog.service';
import { ServiceAreasService } from './catalog/service-areas.service';
import { StoresService } from './catalog/stores.service';
import { CompanyCatalogController, StoresController } from './catalog/catalog.controller';
import { CartService } from './cart/cart.service';
import { CartController } from './cart/cart.controller';
import { OrdersService } from './orders/orders.service';
import { AdminOrdersController, CompanyOrdersController, CustomerOrdersController } from './orders/orders.controller';
import { OrderEventsListener } from './orders/order-events.listener';
import { CouponsService } from './coupons/coupons.service';

/**
 * Fase 2 — Marketplace: mapas, configurações, precificação, catálogo, áreas de atendimento,
 * vitrine, carrinho e pedidos. Serviços globais para uso pela logística (Fase 3) e pelo financeiro (Fase 4).
 */
@Global()
@Module({
  providers: [
    MapsService,
    SettingsService,
    PricingService,
    CatalogService,
    ServiceAreasService,
    StoresService,
    CartService,
    CouponsService,
    OrdersService,
    OrderEventsListener,
  ],
  controllers: [
    PricingController,
    StoresController,
    CompanyCatalogController,
    CartController,
    CustomerOrdersController,
    CompanyOrdersController,
    AdminOrdersController,
  ],
  exports: [MapsService, SettingsService, PricingService, CatalogService, ServiceAreasService, CouponsService, OrdersService],
})
export class MarketplaceModule {}
