-- CreateTable
CREATE TABLE "wifi_access_points" (
    "id" UUID NOT NULL,
    "bssid" VARCHAR(17) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "floor_key" VARCHAR(10) NOT NULL,
    "floor_level" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "zone_id" UUID,
    "rssi_at_1m" DOUBLE PRECISION,
    "path_loss_exponent" DOUBLE PRECISION,
    "calibrated_at" TIMESTAMPTZ,
    "vendor" VARCHAR(40),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "data_origin" VARCHAR(12) NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "wifi_access_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wifi_collectors" (
    "id" UUID NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "mode" VARCHAR(10) NOT NULL,
    "vendor" VARCHAR(40),
    "key_hash" VARCHAR(128) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMPTZ,
    "last_batch" JSONB,
    "data_origin" VARCHAR(12) NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wifi_collectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wifi_device_bindings" (
    "id" UUID NOT NULL,
    "device_hash" VARCHAR(64) NOT NULL,
    "device_kind" VARCHAR(20) NOT NULL,
    "display_hint" VARCHAR(20),
    "patient_id" UUID NOT NULL,
    "consent_basis" VARCHAR(20) NOT NULL,
    "consent_note" VARCHAR(200),
    "bound_by_id" UUID,
    "bound_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unbound_at" TIMESTAMPTZ,
    "unbound_by_id" UUID,
    "unbound_reason" VARCHAR(200),
    "data_origin" VARCHAR(12) NOT NULL,

    CONSTRAINT "wifi_device_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wifi_position_fixes" (
    "id" UUID NOT NULL,
    "device_hash" VARCHAR(64) NOT NULL,
    "patient_id" UUID,
    "binding_id" UUID,
    "collector_id" UUID,
    "observed_at" TIMESTAMPTZ NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "floor_key" VARCHAR(10) NOT NULL,
    "floor_level" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "accuracy_m" DOUBLE PRECISION NOT NULL,
    "ap_count" INTEGER NOT NULL,
    "quality" VARCHAR(8) NOT NULL,
    "floor_share" DOUBLE PRECISION NOT NULL,
    "uncalibrated" BOOLEAN NOT NULL,
    "zone_id" UUID,
    "granularity" VARCHAR(10) NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "readings" JSONB NOT NULL,
    "truth_zone_id" UUID,
    "location_id" UUID,

    CONSTRAINT "wifi_position_fixes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wifi_access_points_bssid_key" ON "wifi_access_points"("bssid");

-- CreateIndex
CREATE INDEX "wifi_access_points_floor_key_idx" ON "wifi_access_points"("floor_key");

-- CreateIndex
CREATE INDEX "wifi_collectors_key_hash_idx" ON "wifi_collectors"("key_hash");

-- CreateIndex
CREATE INDEX "wifi_device_bindings_device_hash_unbound_at_idx" ON "wifi_device_bindings"("device_hash", "unbound_at");

-- CreateIndex
CREATE INDEX "wifi_device_bindings_patient_id_unbound_at_idx" ON "wifi_device_bindings"("patient_id", "unbound_at");

-- CreateIndex
CREATE INDEX "wifi_position_fixes_patient_id_observed_at_idx" ON "wifi_position_fixes"("patient_id", "observed_at");

-- CreateIndex
CREATE INDEX "wifi_position_fixes_device_hash_observed_at_idx" ON "wifi_position_fixes"("device_hash", "observed_at");

-- CreateIndex
CREATE INDEX "wifi_position_fixes_observed_at_idx" ON "wifi_position_fixes"("observed_at");

-- CreateIndex
CREATE INDEX "wifi_position_fixes_source_observed_at_idx" ON "wifi_position_fixes"("source", "observed_at");

