-- AddColumn: provider_username to Login
-- Additive nullable column — no data migration required.
-- Safe for both SQLite and PostgreSQL.

ALTER TABLE "Login" ADD COLUMN "provider_username" TEXT;
