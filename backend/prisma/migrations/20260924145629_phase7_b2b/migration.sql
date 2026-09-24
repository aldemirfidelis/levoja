-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ENDED');

-- CreateEnum
CREATE TYPE "DeliveryBatchStatus" AS ENUM ('VALIDATING', 'READY', 'CONFIRMED', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryBatchSource" AS ENUM ('CSV', 'XLSX', 'API');

-- CreateEnum
CREATE TYPE "BatchItemStatus" AS ENUM ('PENDING', 'VALID', 'INVALID', 'CREATED');

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('PLANNED', 'DISPATCHING', 'ASSIGNED', 'COMPLETED', 'SPLIT', 'CANCELED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'PAID', 'OVERDUE', 'CANCELED');

-- AlterEnum
ALTER TYPE "PaymentPurpose" ADD VALUE 'INVOICE';

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "batchId" UUID,
ADD COLUMN     "contractId" UUID,
ADD COLUMN     "costCenterId" UUID,
ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "invoiceId" UUID,
ADD COLUMN     "recurrenceId" UUID,
ADD COLUMN     "routeId" UUID,
ADD COLUMN     "routeSequence" INTEGER;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "invoiceId" UUID;

-- CreateTable
CREATE TABLE "corporate_contracts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "billingDay" INTEGER NOT NULL DEFAULT 1,
    "paymentTermDays" INTEGER NOT NULL DEFAULT 10,
    "creditLimitCents" INTEGER NOT NULL,
    "minimumMonthlyCents" INTEGER NOT NULL DEFAULT 0,
    "discountBps" INTEGER NOT NULL DEFAULT 0,
    "requireCostCenter" BOOLEAN NOT NULL DEFAULT false,
    "notifyRecipients" BOOLEAN NOT NULL DEFAULT true,
    "blockAfterOverdueDays" INTEGER NOT NULL DEFAULT 5,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "activatedById" UUID,
    "endedAt" TIMESTAMP(3),
    "invoicedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corporate_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_price_rules" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "vehicleType" "VehicleType",
    "city" TEXT,
    "state" TEXT,
    "baseCents" INTEGER NOT NULL,
    "perKmCents" INTEGER NOT NULL DEFAULT 0,
    "includedKm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "perMinuteCents" INTEGER NOT NULL DEFAULT 0,
    "perKgCents" INTEGER NOT NULL DEFAULT 0,
    "includedKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minimumCents" INTEGER NOT NULL DEFAULT 0,
    "maximumCents" INTEGER,
    "nightSurchargeBps" INTEGER NOT NULL DEFAULT 0,
    "rainSurchargeBps" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_price_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyBudgetCents" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_locations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isUnit" BOOLEAN NOT NULL DEFAULT true,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "zipCode" TEXT,
    "street" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "complement" TEXT,
    "district" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "reference" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_api_keys" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdById" UUID NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_batches" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT,
    "source" "DeliveryBatchSource" NOT NULL,
    "fileName" TEXT,
    "status" "DeliveryBatchStatus" NOT NULL DEFAULT 'VALIDATING',
    "pickup" JSONB NOT NULL,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "locationId" UUID,
    "scheduledFor" TIMESTAMP(3),
    "paymentMethod" "PaymentMethod" NOT NULL,
    "costCenterId" UUID,
    "planRoutes" BOOLEAN NOT NULL DEFAULT true,
    "itemsCount" INTEGER NOT NULL DEFAULT 0,
    "validCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "totalFeeCents" INTEGER NOT NULL DEFAULT 0,
    "routesCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdById" UUID NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" UUID,
    "canceledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_batch_items" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "row" INTEGER NOT NULL,
    "externalRef" TEXT,
    "status" "BatchItemStatus" NOT NULL DEFAULT 'PENDING',
    "data" JSONB NOT NULL,
    "errors" TEXT[],
    "dropoff" JSONB,
    "vehicleType" "VehicleType",
    "distanceKm" DOUBLE PRECISION,
    "durationMin" INTEGER,
    "feeCents" INTEGER,
    "payoutCents" INTEGER,
    "costCenterId" UUID,
    "deliveryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_batch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_routes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "RouteStatus" NOT NULL DEFAULT 'PLANNED',
    "vehicleType" "VehicleType" NOT NULL,
    "stopsCount" INTEGER NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "payoutCents" INTEGER NOT NULL,
    "leadDeliveryId" UUID,
    "driverId" UUID,
    "assignedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_deliveries" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "pickupLocationId" UUID,
    "dropoffLocationId" UUID,
    "dropoff" JSONB,
    "weekdays" INTEGER[],
    "time" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "itemCategory" "ItemCategory" NOT NULL DEFAULT 'OTHER',
    "itemDescription" TEXT,
    "weightKg" DOUBLE PRECISION,
    "notes" TEXT,
    "proofMethod" "ProofMethod",
    "paymentMethod" "PaymentMethod" NOT NULL,
    "costCenterId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_runs" (
    "id" UUID NOT NULL,
    "recurrenceId" UUID NOT NULL,
    "occursOn" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "deliveryId" UUID,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurring_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "deliveriesCount" INTEGER NOT NULL,
    "deliveriesCents" INTEGER NOT NULL,
    "minimumAdjustmentCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "byCostCenter" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paidReference" TEXT,
    "canceledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "corporate_contracts_companyId_status_idx" ON "corporate_contracts"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "corporate_contracts_tenantId_number_key" ON "corporate_contracts"("tenantId", "number");

-- CreateIndex
CREATE INDEX "contract_price_rules_contractId_idx" ON "contract_price_rules"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_companyId_code_key" ON "cost_centers"("companyId", "code");

-- CreateIndex
CREATE INDEX "company_locations_companyId_isActive_idx" ON "company_locations"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "company_api_keys_prefix_key" ON "company_api_keys"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "company_api_keys_keyHash_key" ON "company_api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "company_api_keys_companyId_idx" ON "company_api_keys"("companyId");

-- CreateIndex
CREATE INDEX "delivery_batches_companyId_createdAt_idx" ON "delivery_batches"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_batches_tenantId_number_key" ON "delivery_batches"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_batch_items_deliveryId_key" ON "delivery_batch_items"("deliveryId");

-- CreateIndex
CREATE INDEX "delivery_batch_items_batchId_row_idx" ON "delivery_batch_items"("batchId", "row");

-- CreateIndex
CREATE INDEX "delivery_routes_batchId_sequence_idx" ON "delivery_routes"("batchId", "sequence");

-- CreateIndex
CREATE INDEX "delivery_routes_tenantId_status_idx" ON "delivery_routes"("tenantId", "status");

-- CreateIndex
CREATE INDEX "recurring_deliveries_tenantId_isActive_idx" ON "recurring_deliveries"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "recurring_deliveries_companyId_idx" ON "recurring_deliveries"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_runs_recurrenceId_occursOn_key" ON "recurring_runs"("recurrenceId", "occursOn");

-- CreateIndex
CREATE INDEX "invoices_companyId_status_idx" ON "invoices"("companyId", "status");

-- CreateIndex
CREATE INDEX "invoices_status_dueAt_idx" ON "invoices"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenantId_number_key" ON "invoices"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_contractId_periodStart_key" ON "invoices"("contractId", "periodStart");

-- CreateIndex
CREATE INDEX "deliveries_batchId_idx" ON "deliveries"("batchId");

-- CreateIndex
CREATE INDEX "deliveries_routeId_routeSequence_idx" ON "deliveries"("routeId", "routeSequence");

-- CreateIndex
CREATE INDEX "deliveries_companyId_paymentMethod_invoiceId_idx" ON "deliveries"("companyId", "paymentMethod", "invoiceId");

-- CreateIndex
CREATE INDEX "deliveries_costCenterId_createdAt_idx" ON "deliveries"("costCenterId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_invoiceId_idx" ON "payments"("invoiceId");

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "delivery_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "delivery_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_contracts" ADD CONSTRAINT "corporate_contracts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_price_rules" ADD CONSTRAINT "contract_price_rules_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "corporate_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_locations" ADD CONSTRAINT "company_locations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_api_keys" ADD CONSTRAINT "company_api_keys_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_batches" ADD CONSTRAINT "delivery_batches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_batch_items" ADD CONSTRAINT "delivery_batch_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "delivery_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_routes" ADD CONSTRAINT "delivery_routes_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "delivery_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_deliveries" ADD CONSTRAINT "recurring_deliveries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_runs" ADD CONSTRAINT "recurring_runs_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "recurring_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "corporate_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
