-- CreateTable
CREATE TABLE "Login" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "provider_email" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Login_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExternalAccount" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "external_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status_changed_at" DATETIME,
    CONSTRAINT "ExternalAccount_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Login_user_id_idx" ON "Login"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "Login_provider_provider_user_id_key" ON "Login"("provider", "provider_user_id");

-- CreateIndex
CREATE INDEX "ExternalAccount_user_id_idx" ON "ExternalAccount"("user_id");

-- CreateIndex
CREATE INDEX "ExternalAccount_type_status_idx" ON "ExternalAccount"("type", "status");

-- Partial unique index: only one active or pending account per user per type.
-- Prisma DSL does not support partial indexes; this step is added manually.
-- SQLite has supported partial indexes since 3.8.9. The WHERE clause syntax is
-- identical on both SQLite and PostgreSQL.
CREATE UNIQUE INDEX IF NOT EXISTS "ExternalAccount_user_id_type_active_key"
ON "ExternalAccount"("user_id", "type")
WHERE "status" IN ('pending', 'active');
