-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('ORDER', 'DELIVERY', 'DEBT_SETTLEMENT');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "WalletOwnerType" AS ENUM ('DRIVER', 'COMPANY', 'CUSTOMER', 'PLATFORM');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('SALE', 'COMMISSION', 'EARNING', 'TIP', 'FEE', 'CASH_COLLECTED', 'REFUND', 'CREDIT', 'ADJUSTMENT', 'DISCOUNT', 'WITHDRAWAL', 'WITHDRAWAL_REVERSAL', 'PAYMENT');

-- CreateEnum
CREATE TYPE "LedgerEntryStatus" AS ENUM ('PENDING', 'AVAILABLE', 'CANCELED');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'PAID', 'REJECTED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('PERCENT', 'FIXED', 'FREE_DELIVERY');

-- CreateEnum
CREATE TYPE "CouponFunding" AS ENUM ('PLATFORM', 'COMPANY');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "couponId" UUID,
ADD COLUMN     "platformCommissionCents" INTEGER,
ADD COLUMN     "settledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL DEFAULT 'ORDER',
    "orderId" UUID,
    "deliveryId" UUID,
    "walletId" UUID,
    "payerUserId" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amountCents" INTEGER NOT NULL,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "pixCopyPaste" TEXT,
    "pixExpiresAt" TIMESTAMP(3),
    "cardBrand" TEXT,
    "cardLast4" TEXT,
    "failureReason" TEXT,
    "authorizedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "paymentId" UUID,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "providerRefundId" TEXT,
    "toWallet" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "ownerType" "WalletOwnerType" NOT NULL,
    "driverId" UUID,
    "companyId" UUID,
    "customerId" UUID,
    "platformTenantId" UUID,
    "availableCents" INTEGER NOT NULL DEFAULT 0,
    "pendingCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "LedgerEntryStatus" NOT NULL,
    "availableAt" TIMESTAMP(3),
    "description" TEXT NOT NULL,
    "orderId" UUID,
    "deliveryId" UUID,
    "paymentId" UUID,
    "withdrawalId" UUID,
    "referenceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
    "destination" TEXT NOT NULL,
    "destinationEncrypted" TEXT,
    "requestedById" UUID NOT NULL,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "providerTransferId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" UUID,
    "segmentId" UUID,
    "percentBps" INTEGER NOT NULL DEFAULT 0,
    "fixedCents" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "type" "CouponType" NOT NULL,
    "percentBps" INTEGER,
    "amountCents" INTEGER,
    "maxDiscountCents" INTEGER,
    "minOrderCents" INTEGER NOT NULL DEFAULT 0,
    "companyId" UUID,
    "segmentId" UUID,
    "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "weekdays" INTEGER[],
    "fromTime" TEXT,
    "toTime" TEXT,
    "maxRedemptions" INTEGER,
    "maxPerCustomer" INTEGER NOT NULL DEFAULT 1,
    "redemptions" INTEGER NOT NULL DEFAULT 0,
    "fundedBy" "CouponFunding" NOT NULL DEFAULT 'PLATFORM',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "discountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");

-- CreateIndex
CREATE INDEX "payments_deliveryId_idx" ON "payments"("deliveryId");

-- CreateIndex
CREATE INDEX "payments_tenantId_status_createdAt_idx" ON "payments"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_providerPaymentId_key" ON "payments"("provider", "providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_providerEventId_key" ON "payment_events"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "refunds_paymentId_idx" ON "refunds"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_driverId_key" ON "wallets"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_companyId_key" ON "wallets"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_customerId_key" ON "wallets"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_platformTenantId_key" ON "wallets"("platformTenantId");

-- CreateIndex
CREATE INDEX "wallets_tenantId_ownerType_idx" ON "wallets"("tenantId", "ownerType");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_referenceKey_key" ON "wallet_transactions"("referenceKey");

-- CreateIndex
CREATE INDEX "wallet_transactions_walletId_createdAt_idx" ON "wallet_transactions"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "wallet_transactions_status_availableAt_idx" ON "wallet_transactions"("status", "availableAt");

-- CreateIndex
CREATE INDEX "wallet_transactions_orderId_idx" ON "wallet_transactions"("orderId");

-- CreateIndex
CREATE INDEX "withdrawals_tenantId_status_createdAt_idx" ON "withdrawals"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "commission_rules_tenantId_isActive_idx" ON "commission_rules"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "coupons_tenantId_isActive_idx" ON "coupons"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_tenantId_code_key" ON "coupons"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_orderId_key" ON "coupon_redemptions"("orderId");

-- CreateIndex
CREATE INDEX "coupon_redemptions_couponId_customerId_idx" ON "coupon_redemptions"("couponId", "customerId");

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
