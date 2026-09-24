-- CreateEnum
CREATE TYPE "DriverAvailability" AS ENUM ('OFFLINE', 'ONLINE', 'BUSY');

-- CreateEnum
CREATE TYPE "DeliveryKind" AS ENUM ('ORDER', 'ON_DEMAND');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SCHEDULED', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'AT_DROPOFF', 'DELIVERED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ItemCategory" AS ENUM ('FOOD', 'DOCUMENT', 'PACKAGE', 'GIFT', 'MEDICINE', 'ELECTRONICS', 'CLOTHING', 'OTHER');

-- CreateEnum
CREATE TYPE "ProofMethod" AS ENUM ('CODE', 'QR_CODE', 'PHOTO', 'SIGNATURE');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ReviewSubject" AS ENUM ('COMPANY', 'DRIVER', 'CUSTOMER');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "ratingAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "ratingCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "drivers" ADD COLUMN     "acceptedOffers" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "availability" "DriverAvailability" NOT NULL DEFAULT 'OFFLINE',
ADD COLUMN     "canceledDeliveries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "completedDeliveries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "declinedOffers" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "expiredOffers" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastLat" DOUBLE PRECISION,
ADD COLUMN     "lastLng" DOUBLE PRECISION,
ADD COLUMN     "lastLocationAt" TIMESTAMP(3),
ADD COLUMN     "onlineSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "DeliveryKind" NOT NULL,
    "orderId" UUID,
    "requesterUserId" UUID NOT NULL,
    "companyId" UUID,
    "status" "DeliveryStatus" NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "pickup" JSONB NOT NULL,
    "dropoff" JSONB NOT NULL,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "dropoffLat" DOUBLE PRECISION NOT NULL,
    "dropoffLng" DOUBLE PRECISION NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "itemCategory" "ItemCategory" NOT NULL DEFAULT 'OTHER',
    "itemDescription" TEXT,
    "weightKg" DOUBLE PRECISION,
    "lengthCm" DOUBLE PRECISION,
    "widthCm" DOUBLE PRECISION,
    "heightCm" DOUBLE PRECISION,
    "declaredValueCents" INTEGER,
    "notes" TEXT,
    "vehicleType" "VehicleType" NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "payoutCents" INTEGER NOT NULL,
    "tipCents" INTEGER NOT NULL DEFAULT 0,
    "paymentMethod" "PaymentMethod",
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "proofMethod" "ProofMethod" NOT NULL DEFAULT 'CODE',
    "dropoffCode" TEXT NOT NULL,
    "requiresIdCheck" BOOLEAN NOT NULL DEFAULT false,
    "driverId" UUID,
    "vehicleId" UUID,
    "searchStartedAt" TIMESTAMP(3),
    "dispatchAttempts" INTEGER NOT NULL DEFAULT 0,
    "searchRadiusKm" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "assignedAt" TIMESTAMP(3),
    "arrivedPickupAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "arrivedDropoffAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failReason" TEXT,
    "canceledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_offers" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "payoutCents" INTEGER NOT NULL,
    "distanceToPickupKm" DOUBLE PRECISION NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_status_history" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "fromStatus" "DeliveryStatus",
    "toStatus" "DeliveryStatus" NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" UUID,
    "reason" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_tracking_points" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_tracking_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_proofs" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "method" "ProofMethod" NOT NULL,
    "codeVerified" BOOLEAN NOT NULL DEFAULT false,
    "fileKey" TEXT,
    "recipientName" TEXT,
    "idChecked" BOOLEAN NOT NULL DEFAULT false,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID,
    "deliveryId" UUID,
    "authorUserId" UUID NOT NULL,
    "authorType" "ActorType" NOT NULL,
    "subjectType" "ReviewSubject" NOT NULL,
    "subjectId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "tags" TEXT[],
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "hiddenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_code_key" ON "deliveries"("code");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_orderId_key" ON "deliveries"("orderId");

-- CreateIndex
CREATE INDEX "deliveries_tenantId_status_createdAt_idx" ON "deliveries"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "deliveries_driverId_status_idx" ON "deliveries"("driverId", "status");

-- CreateIndex
CREATE INDEX "deliveries_requesterUserId_createdAt_idx" ON "deliveries"("requesterUserId", "createdAt");

-- CreateIndex
CREATE INDEX "deliveries_companyId_createdAt_idx" ON "deliveries"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "deliveries_status_scheduledFor_idx" ON "deliveries"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "delivery_offers_deliveryId_status_idx" ON "delivery_offers"("deliveryId", "status");

-- CreateIndex
CREATE INDEX "delivery_offers_driverId_status_idx" ON "delivery_offers"("driverId", "status");

-- CreateIndex
CREATE INDEX "delivery_status_history_deliveryId_createdAt_idx" ON "delivery_status_history"("deliveryId", "createdAt");

-- CreateIndex
CREATE INDEX "delivery_tracking_points_deliveryId_recordedAt_idx" ON "delivery_tracking_points"("deliveryId", "recordedAt");

-- CreateIndex
CREATE INDEX "delivery_proofs_deliveryId_idx" ON "delivery_proofs"("deliveryId");

-- CreateIndex
CREATE INDEX "reviews_subjectType_subjectId_createdAt_idx" ON "reviews"("subjectType", "subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "reviews_tenantId_createdAt_idx" ON "reviews"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_authorUserId_deliveryId_subjectType_key" ON "reviews"("authorUserId", "deliveryId", "subjectType");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_authorUserId_orderId_subjectType_key" ON "reviews"("authorUserId", "orderId", "subjectType");

-- CreateIndex
CREATE INDEX "drivers_tenantId_availability_lastLat_lastLng_idx" ON "drivers"("tenantId", "availability", "lastLat", "lastLng");

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_offers" ADD CONSTRAINT "delivery_offers_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_offers" ADD CONSTRAINT "delivery_offers_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_status_history" ADD CONSTRAINT "delivery_status_history_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_tracking_points" ADD CONSTRAINT "delivery_tracking_points_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
