-- Update the CHECK constraint on ProvisioningRequest to allow llm_proxy
-- SQLite requires recreating the table to change constraints

-- CreateTable (temporary)
CREATE TABLE "ProvisioningRequest_new" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "requested_type" TEXT NOT NULL CHECK ("requested_type" IN ('workspace', 'claude', 'llm_proxy')),
    "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected', 'rejected_permanent')),
    "decided_by" INTEGER,
    "decided_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProvisioningRequest_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProvisioningRequest_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Copy data from old table
INSERT INTO "ProvisioningRequest_new" 
SELECT id, user_id, requested_type, status, decided_by, decided_at, created_at 
FROM "ProvisioningRequest";

-- DropTable
DROP TABLE "ProvisioningRequest";

-- RenameTable
ALTER TABLE "ProvisioningRequest_new" RENAME TO "ProvisioningRequest";

-- CreateIndex
CREATE INDEX "ProvisioningRequest_user_id_status_idx" ON "ProvisioningRequest"("user_id", "status");

-- CreateIndex
CREATE INDEX "ProvisioningRequest_status_created_at_idx" ON "ProvisioningRequest"("status", "created_at");
