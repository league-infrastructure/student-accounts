-- DropIndex
DROP INDEX "ExternalAccount_user_id_type_active_key";

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "actor_user_id" INTEGER,
    "action" TEXT NOT NULL,
    "target_user_id" INTEGER,
    "target_entity_type" TEXT,
    "target_entity_id" TEXT,
    "details" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditEvent_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProvisioningRequest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "requested_type" TEXT NOT NULL CHECK ("requested_type" IN ('workspace', 'claude')),
    "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected')),
    "decided_by" INTEGER,
    "decided_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProvisioningRequest_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProvisioningRequest_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MergeSuggestion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_a_id" INTEGER NOT NULL,
    "user_b_id" INTEGER NOT NULL,
    "haiku_confidence" REAL NOT NULL,
    "haiku_rationale" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected', 'deferred')),
    "decided_by" INTEGER,
    "decided_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MergeSuggestion_user_a_id_fkey" FOREIGN KEY ("user_a_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MergeSuggestion_user_b_id_fkey" FOREIGN KEY ("user_b_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MergeSuggestion_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AuditEvent_actor_user_id_created_at_idx" ON "AuditEvent"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "AuditEvent_target_user_id_created_at_idx" ON "AuditEvent"("target_user_id", "created_at");

-- CreateIndex
CREATE INDEX "AuditEvent_action_created_at_idx" ON "AuditEvent"("action", "created_at");

-- CreateIndex
CREATE INDEX "ProvisioningRequest_user_id_status_idx" ON "ProvisioningRequest"("user_id", "status");

-- CreateIndex
CREATE INDEX "ProvisioningRequest_status_created_at_idx" ON "ProvisioningRequest"("status", "created_at");

-- CreateIndex
CREATE INDEX "MergeSuggestion_status_created_at_idx" ON "MergeSuggestion"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "MergeSuggestion_user_a_id_user_b_id_key" ON "MergeSuggestion"("user_a_id", "user_b_id");

-- Restore the partial unique index on ExternalAccount that was dropped above.
-- Prisma drops it because it was added as raw SQL (outside Prisma's DSL) in the
-- previous migration and Prisma regenerates the table without it. We recreate it
-- here to preserve the constraint.
-- SQLite has supported partial indexes since 3.8.9; identical syntax on PostgreSQL.
CREATE UNIQUE INDEX "ExternalAccount_user_id_type_active_key"
ON "ExternalAccount"("user_id", "type")
WHERE "status" IN ('pending', 'active');
