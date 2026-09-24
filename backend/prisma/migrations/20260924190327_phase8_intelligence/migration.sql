-- CreateEnum
CREATE TYPE "RiskSignalType" AS ENUM ('SHARED_DEVICE', 'COUPON_ABUSE', 'NEW_ACCOUNT_HIGH_VALUE', 'ORDER_VELOCITY', 'PAYMENT_FAILURES', 'CARD_TESTING', 'MOCK_LOCATION', 'IMPOSSIBLE_SPEED', 'PROOF_FAR_FROM_DROPOFF', 'ABNORMAL_CANCELLATIONS', 'DRIVER_RELEASES', 'MANUAL');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "RiskCaseStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'DISMISSED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "AnomalyKind" AS ENUM ('DEMAND_SPIKE', 'DEMAND_DROP', 'CANCELLATION_SPIKE', 'PAYMENT_FAILURE_SPIKE', 'DISPATCH_DELAY');

-- CreateEnum
CREATE TYPE "AnomalySeverity" AS ENUM ('WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AnomalyStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReviewSentiment" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'APPLIED', 'DISMISSED', 'EXPIRED');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "learnedPrepMinutes" INTEGER;

-- AlterTable
ALTER TABLE "delivery_tracking_points" ADD COLUMN     "mocked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "drivers" ADD COLUMN     "lastLocationMocked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "analysisSource" TEXT,
ADD COLUMN     "analyzedAt" TIMESTAMP(3),
ADD COLUMN     "sentiment" "ReviewSentiment",
ADD COLUMN     "themes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "device_sightings" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "lastIp" TEXT,
    "userAgent" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logins" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "device_sightings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_signals" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "RiskSignalType" NOT NULL,
    "points" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "relatedUserIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "orderId" UUID,
    "deliveryId" UUID,
    "paymentId" UUID,
    "dedupeKey" TEXT,
    "caseId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_profiles" (
    "userId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "level" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "signals" INTEGER NOT NULL DEFAULT 0,
    "lastSignalAt" TIMESTAMP(3),
    "trustedUntil" TIMESTAMP(3),
    "trustedReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "risk_cases" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "userId" UUID NOT NULL,
    "status" "RiskCaseStatus" NOT NULL DEFAULT 'OPEN',
    "level" "RiskLevel" NOT NULL,
    "score" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "assigneeId" UUID,
    "resolution" TEXT,
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demand_forecasts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "city" TEXT NOT NULL,
    "hourStart" TIMESTAMP(3) NOT NULL,
    "predicted" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "driversNeeded" INTEGER NOT NULL,
    "driversExpected" DOUBLE PRECISION,
    "actual" INTEGER,
    "driversOnline" DOUBLE PRECISION,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demand_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eta_calibrations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "city" TEXT NOT NULL,
    "vehicle" TEXT NOT NULL,
    "band" INTEGER NOT NULL,
    "transitFactor" DOUBLE PRECISION NOT NULL,
    "pickupMinutes" DOUBLE PRECISION,
    "dispatchMinutes" DOUBLE PRECISION,
    "samples" INTEGER NOT NULL,
    "maeBeforeMin" DOUBLE PRECISION,
    "maeAfterMin" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eta_calibrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_anomalies" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "AnomalyKind" NOT NULL,
    "severity" "AnomalySeverity" NOT NULL,
    "status" "AnomalyStatus" NOT NULL DEFAULT 'OPEN',
    "city" TEXT,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "observed" DOUBLE PRECISION NOT NULL,
    "expected" DOUBLE PRECISION NOT NULL,
    "zScore" DOUBLE PRECISION NOT NULL,
    "message" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "acknowledgedById" UUID,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_anomalies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_suggestions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "city" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "surchargeBps" INTEGER NOT NULL,
    "predicted" DOUBLE PRECISION NOT NULL,
    "driversNeeded" INTEGER NOT NULL,
    "driversExpected" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "surchargeId" UUID,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_surcharges" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "city" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "surchargeBps" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "canceledAt" TIMESTAMP(3),
    "canceledById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_surcharges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_interactions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID,
    "companyId" UUID,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "status" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_sightings_userId_idx" ON "device_sightings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "device_sightings_tenantId_deviceHash_userId_key" ON "device_sightings"("tenantId", "deviceHash", "userId");

-- CreateIndex
CREATE INDEX "risk_signals_tenantId_userId_createdAt_idx" ON "risk_signals"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "risk_signals_tenantId_type_createdAt_idx" ON "risk_signals"("tenantId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "risk_signals_caseId_idx" ON "risk_signals"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "risk_signals_tenantId_dedupeKey_key" ON "risk_signals"("tenantId", "dedupeKey");

-- CreateIndex
CREATE INDEX "risk_profiles_tenantId_level_score_idx" ON "risk_profiles"("tenantId", "level", "score");

-- CreateIndex
CREATE INDEX "risk_cases_tenantId_status_level_idx" ON "risk_cases"("tenantId", "status", "level");

-- CreateIndex
CREATE INDEX "risk_cases_userId_status_idx" ON "risk_cases"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "risk_cases_tenantId_number_key" ON "risk_cases"("tenantId", "number");

-- CreateIndex
CREATE INDEX "demand_forecasts_tenantId_hourStart_idx" ON "demand_forecasts"("tenantId", "hourStart");

-- CreateIndex
CREATE UNIQUE INDEX "demand_forecasts_tenantId_city_hourStart_key" ON "demand_forecasts"("tenantId", "city", "hourStart");

-- CreateIndex
CREATE UNIQUE INDEX "eta_calibrations_tenantId_city_vehicle_band_key" ON "eta_calibrations"("tenantId", "city", "vehicle", "band");

-- CreateIndex
CREATE INDEX "ops_anomalies_tenantId_status_createdAt_idx" ON "ops_anomalies"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ops_anomalies_tenantId_dedupeKey_key" ON "ops_anomalies"("tenantId", "dedupeKey");

-- CreateIndex
CREATE INDEX "pricing_suggestions_tenantId_status_windowStart_idx" ON "pricing_suggestions"("tenantId", "status", "windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_suggestions_tenantId_city_windowStart_key" ON "pricing_suggestions"("tenantId", "city", "windowStart");

-- CreateIndex
CREATE INDEX "pricing_surcharges_tenantId_startsAt_endsAt_idx" ON "pricing_surcharges"("tenantId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "ai_interactions_tenantId_feature_createdAt_idx" ON "ai_interactions"("tenantId", "feature", "createdAt");

-- CreateIndex
CREATE INDEX "ai_interactions_userId_createdAt_idx" ON "ai_interactions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "reviews_tenantId_sentiment_createdAt_idx" ON "reviews"("tenantId", "sentiment", "createdAt");

-- AddForeignKey
ALTER TABLE "risk_signals" ADD CONSTRAINT "risk_signals_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "risk_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
