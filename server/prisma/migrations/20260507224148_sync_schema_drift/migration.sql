-- DropIndex
DROP INDEX "ExternalAccount_user_id_type_active_key";

-- AlterTable
ALTER TABLE "ExternalAccount" ADD COLUMN "scheduled_delete_at" DATETIME;

-- AlterTable
ALTER TABLE "Login" ADD COLUMN "directory_metadata" JSONB;
ALTER TABLE "Login" ADD COLUMN "provider_payload" JSONB;
ALTER TABLE "Login" ADD COLUMN "provider_payload_updated_at" DATETIME;

-- CreateTable
CREATE TABLE "Group" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "signup_passphrase" TEXT,
    "signup_passphrase_grant_llm_proxy" BOOLEAN NOT NULL DEFAULT false,
    "signup_passphrase_expires_at" DATETIME,
    "signup_passphrase_created_at" DATETIME,
    "signup_passphrase_created_by" INTEGER
);

-- CreateTable
CREATE TABLE "UserGroup" (
    "user_id" INTEGER NOT NULL,
    "group_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("user_id", "group_id"),
    CONSTRAINT "UserGroup_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserGroup_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoginEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "login_id" INTEGER NOT NULL,
    "occurred_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    CONSTRAINT "LoginEvent_login_id_fkey" FOREIGN KEY ("login_id") REFERENCES "Login" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OAuthClient" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "client_id" TEXT NOT NULL,
    "client_secret_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "redirect_uris" JSONB NOT NULL,
    "allowed_scopes" JSONB NOT NULL,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "disabled_at" DATETIME,
    CONSTRAINT "OAuthClient_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OAuthAccessToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "oauth_client_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "token_hash" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "revoked_at" DATETIME,
    "last_used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthAccessToken_oauth_client_id_fkey" FOREIGN KEY ("oauth_client_id") REFERENCES "OAuthClient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OAuthAccessToken_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OAuthAuthorizationCode" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code_hash" TEXT NOT NULL,
    "oauth_client_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "code_challenge_method" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "consumed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthAuthorizationCode_oauth_client_id_fkey" FOREIGN KEY ("oauth_client_id") REFERENCES "OAuthClient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OAuthAuthorizationCode_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OAuthRefreshToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "token_hash" TEXT NOT NULL,
    "oauth_client_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "scopes" JSONB NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "revoked_at" DATETIME,
    "replaced_by_id" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" DATETIME,
    CONSTRAINT "OAuthRefreshToken_oauth_client_id_fkey" FOREIGN KEY ("oauth_client_id") REFERENCES "OAuthClient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OAuthRefreshToken_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OAuthRefreshToken_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "OAuthRefreshToken" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OAuthConsent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "oauth_client_id" INTEGER NOT NULL,
    "scopes" JSONB NOT NULL,
    "granted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthConsent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OAuthConsent_oauth_client_id_fkey" FOREIGN KEY ("oauth_client_id") REFERENCES "OAuthClient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LlmProxyToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_plaintext" TEXT,
    "expires_at" DATETIME NOT NULL,
    "token_limit" INTEGER NOT NULL,
    "tokens_used" INTEGER NOT NULL DEFAULT 0,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "granted_by" INTEGER,
    "granted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "LlmProxyToken_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LlmProxyToken_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Cohort" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "google_ou_path" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signup_passphrase" TEXT,
    "signup_passphrase_grant_llm_proxy" BOOLEAN NOT NULL DEFAULT false,
    "signup_passphrase_expires_at" DATETIME,
    "signup_passphrase_created_at" DATETIME,
    "signup_passphrase_created_by" INTEGER
);
INSERT INTO "new_Cohort" ("created_at", "google_ou_path", "id", "name") SELECT "created_at", "google_ou_path", "id", "name" FROM "Cohort";
DROP TABLE "Cohort";
ALTER TABLE "new_Cohort" RENAME TO "Cohort";
CREATE UNIQUE INDEX "Cohort_name_key" ON "Cohort"("name");
CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "display_name" TEXT NOT NULL,
    "primary_email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'student',
    "created_via" TEXT NOT NULL,
    "cohort_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "approval_status" TEXT NOT NULL DEFAULT 'approved',
    "onboarding_completed" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "username" TEXT,
    "password_hash" TEXT,
    "notification_email" TEXT,
    "allows_oauth_client" BOOLEAN NOT NULL DEFAULT false,
    "allows_llm_proxy" BOOLEAN NOT NULL DEFAULT false,
    "allows_league_account" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "User_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "Cohort" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("cohort_id", "created_at", "created_via", "display_name", "id", "primary_email", "role", "updated_at") SELECT "cohort_id", "created_at", "created_via", "display_name", "id", "primary_email", "role", "updated_at" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_primary_email_key" ON "User"("primary_email");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "User_cohort_id_idx" ON "User"("cohort_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Group_name_key" ON "Group"("name");

-- CreateIndex
CREATE INDEX "UserGroup_group_id_idx" ON "UserGroup"("group_id");

-- CreateIndex
CREATE INDEX "UserGroup_user_id_idx" ON "UserGroup"("user_id");

-- CreateIndex
CREATE INDEX "LoginEvent_login_id_idx" ON "LoginEvent"("login_id");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthClient_client_id_key" ON "OAuthClient"("client_id");

-- CreateIndex
CREATE INDEX "OAuthClient_client_id_idx" ON "OAuthClient"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAccessToken_token_hash_key" ON "OAuthAccessToken"("token_hash");

-- CreateIndex
CREATE INDEX "OAuthAccessToken_token_hash_idx" ON "OAuthAccessToken"("token_hash");

-- CreateIndex
CREATE INDEX "OAuthAccessToken_oauth_client_id_idx" ON "OAuthAccessToken"("oauth_client_id");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAuthorizationCode_code_hash_key" ON "OAuthAuthorizationCode"("code_hash");

-- CreateIndex
CREATE INDEX "OAuthAuthorizationCode_oauth_client_id_idx" ON "OAuthAuthorizationCode"("oauth_client_id");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthRefreshToken_token_hash_key" ON "OAuthRefreshToken"("token_hash");

-- CreateIndex
CREATE INDEX "OAuthRefreshToken_oauth_client_id_idx" ON "OAuthRefreshToken"("oauth_client_id");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthConsent_user_id_oauth_client_id_key" ON "OAuthConsent"("user_id", "oauth_client_id");

-- CreateIndex
CREATE UNIQUE INDEX "LlmProxyToken_token_hash_key" ON "LlmProxyToken"("token_hash");

-- CreateIndex
CREATE INDEX "LlmProxyToken_user_id_idx" ON "LlmProxyToken"("user_id");

-- CreateIndex
CREATE INDEX "LlmProxyToken_user_id_revoked_at_expires_at_idx" ON "LlmProxyToken"("user_id", "revoked_at", "expires_at");
