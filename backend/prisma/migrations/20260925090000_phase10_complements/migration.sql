-- CreateEnum
CREATE TYPE "LoyaltyTransactionType" AS ENUM ('EARN', 'REDEEM', 'EXPIRE', 'ADJUST');

-- CreateEnum
CREATE TYPE "ReferralProgram" AS ENUM ('CUSTOMER', 'DRIVER', 'COMPANY');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'REWARDED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FleetInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELED', 'EXPIRED');

-- AlterEnum
ALTER TYPE "RiskSignalType" ADD VALUE 'REFERRAL_ABUSE';

-- AlterTable
ALTER TABLE "coupons" ADD COLUMN     "minTier" TEXT,
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'CODE';

-- CreateTable
CREATE TABLE "favorite_stores" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_accounts" (
    "customerId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "lifetimePoints" INTEGER NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'bronze',
    "lastEarnedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("customerId")
);

-- CreateTable
CREATE TABLE "loyalty_transactions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "type" "LoyaltyTransactionType" NOT NULL,
    "points" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "orderId" UUID,
    "referenceKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_codes" (
    "userId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "program" "ReferralProgram" NOT NULL,
    "referrerUserId" UUID NOT NULL,
    "referredUserId" UUID NOT NULL,
    "referredCompanyId" UUID,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "rewardedAt" TIMESTAMP(3),
    "referrerRewardCents" INTEGER NOT NULL DEFAULT 0,
    "referredRewardCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_invitations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "status" "FleetInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "invitedById" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "favorite_stores_customerId_createdAt_idx" ON "favorite_stores"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "favorite_stores_customerId_companyId_key" ON "favorite_stores"("customerId", "companyId");

-- CreateIndex
CREATE INDEX "loyalty_accounts_tenantId_tier_idx" ON "loyalty_accounts"("tenantId", "tier");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_transactions_referenceKey_key" ON "loyalty_transactions"("referenceKey");

-- CreateIndex
CREATE INDEX "loyalty_transactions_customerId_createdAt_idx" ON "loyalty_transactions"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "loyalty_transactions_tenantId_type_createdAt_idx" ON "loyalty_transactions"("tenantId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_tenantId_code_key" ON "referral_codes"("tenantId", "code");

-- CreateIndex
CREATE INDEX "referrals_tenantId_referrerUserId_createdAt_idx" ON "referrals"("tenantId", "referrerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "referrals_status_expiresAt_idx" ON "referrals"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_program_referredUserId_key" ON "referrals"("program", "referredUserId");

-- CreateIndex
CREATE INDEX "fleet_invitations_driverId_status_idx" ON "fleet_invitations"("driverId", "status");

-- CreateIndex
CREATE INDEX "fleet_invitations_companyId_status_idx" ON "fleet_invitations"("companyId", "status");

