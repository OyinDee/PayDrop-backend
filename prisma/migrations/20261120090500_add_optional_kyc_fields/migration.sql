-- Optional KYC: status, tier and encrypted BVN (never stored in clear text)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "kyc_status" TEXT NOT NULL DEFAULT 'NOT_STARTED';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "kyc_tier" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "kyc_bvn_encrypted" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "kyc_bvn_last4" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "kyc_rejection_reason" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "kyc_submitted_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "kyc_verified_at" TIMESTAMP(3);

-- Existing data held duplicate emails (registration never enforced uniqueness).
-- Keep the address on the oldest account and clear it from the later copies so
-- the app cannot resolve an email to two accounts.
UPDATE "users" u
SET "email" = NULL
WHERE u."email" IS NOT NULL
  AND u."id" <> (
    SELECT keep."id"
    FROM "users" keep
    WHERE keep."email" = u."email"
    ORDER BY keep."created_at" ASC, keep."id" ASC
    LIMIT 1
  );

-- Email is unique when present; NULLs stay allowed.
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");

-- Existing verified users keep their state consistent with the new status field.
UPDATE "users" SET "kyc_status" = 'VERIFIED', "kyc_tier" = 1 WHERE "kyc_verified" = true;
