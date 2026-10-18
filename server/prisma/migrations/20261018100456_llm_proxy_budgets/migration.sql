-- CreateTable
CREATE TABLE "LlmProxyRequest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "token_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "ts" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "protocol" TEXT NOT NULL,
    "model_requested" TEXT,
    "model_sent" TEXT,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cost_usd" REAL NOT NULL,
    "status" INTEGER NOT NULL,
    CONSTRAINT "LlmProxyRequest_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "LlmProxyToken" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LlmProxyToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_plaintext" TEXT,
    "expires_at" DATETIME NOT NULL,
    "token_limit" INTEGER NOT NULL,
    "tokens_used" INTEGER NOT NULL DEFAULT 0,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "budget_usd" REAL,
    "spent_usd" REAL NOT NULL DEFAULT 0,
    "spent_usd_total" REAL NOT NULL DEFAULT 0,
    "period_start" DATETIME,
    "granted_by" INTEGER,
    "granted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "LlmProxyToken_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LlmProxyToken_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LlmProxyToken" ("created_at", "expires_at", "granted_at", "granted_by", "id", "request_count", "revoked_at", "token_hash", "token_limit", "token_plaintext", "tokens_used", "updated_at", "user_id") SELECT "created_at", "expires_at", "granted_at", "granted_by", "id", "request_count", "revoked_at", "token_hash", "token_limit", "token_plaintext", "tokens_used", "updated_at", "user_id" FROM "LlmProxyToken";
DROP TABLE "LlmProxyToken";
ALTER TABLE "new_LlmProxyToken" RENAME TO "LlmProxyToken";
CREATE UNIQUE INDEX "LlmProxyToken_token_hash_key" ON "LlmProxyToken"("token_hash");
CREATE INDEX "LlmProxyToken_user_id_idx" ON "LlmProxyToken"("user_id");
CREATE INDEX "LlmProxyToken_user_id_revoked_at_expires_at_idx" ON "LlmProxyToken"("user_id", "revoked_at", "expires_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "LlmProxyRequest_token_id_ts_idx" ON "LlmProxyRequest"("token_id", "ts");

-- CreateIndex
CREATE INDEX "LlmProxyRequest_user_id_ts_idx" ON "LlmProxyRequest"("user_id", "ts");
