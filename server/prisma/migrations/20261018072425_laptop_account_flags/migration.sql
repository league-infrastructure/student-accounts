-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "laptop_password_hash" TEXT,
    "notification_email" TEXT,
    "allows_oauth_client" BOOLEAN NOT NULL DEFAULT false,
    "allows_llm_proxy" BOOLEAN NOT NULL DEFAULT false,
    "allows_league_account" BOOLEAN NOT NULL DEFAULT false,
    "allows_laptop_account" BOOLEAN NOT NULL DEFAULT true,
    "laptop_roster_dirty" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "User_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "Cohort" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("allows_league_account", "allows_llm_proxy", "allows_oauth_client", "approval_status", "cohort_id", "created_at", "created_via", "display_name", "id", "is_active", "laptop_password_hash", "notification_email", "onboarding_completed", "password_hash", "primary_email", "role", "updated_at", "username") SELECT "allows_league_account", "allows_llm_proxy", "allows_oauth_client", "approval_status", "cohort_id", "created_at", "created_via", "display_name", "id", "is_active", "laptop_password_hash", "notification_email", "onboarding_completed", "password_hash", "primary_email", "role", "updated_at", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_primary_email_key" ON "User"("primary_email");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "User_cohort_id_idx" ON "User"("cohort_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
