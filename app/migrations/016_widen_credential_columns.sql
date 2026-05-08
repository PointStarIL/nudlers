-- Migration: widen the encrypted credential columns from VARCHAR(100) to TEXT.
--
-- Issue #88: long credit-card login emails (e.g. "user.name@long-domain.com")
-- triggered an internal server error. Root cause: vendor_credentials.username
-- was VARCHAR(100), but the encrypted form is `IV(24-hex):cipher(2*N hex):tag(32-hex)`
-- with two `:` separators — so a 23-byte plaintext expands to 24 + 1 + 46 + 1 + 32 = 104
-- characters. Anything longer than ~16 plaintext characters overflows the column,
-- Postgres returns `value too long for type character varying(100)`, and the API
-- bubbles a 500.
--
-- The same latent overflow exists on every encrypted column declared in
-- 001_init_schema.sql. We widen them all here. TEXT in PostgreSQL has no
-- length limit and is a strict superset of VARCHAR(100) — existing data is
-- preserved untouched and no application code needs to change.
--
-- Idempotent: ALTER COLUMN ... TYPE TEXT is a no-op when the column is already
-- TEXT, but we guard with information_schema checks anyway so the migration
-- can be re-run safely against partially-migrated databases.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vendor_credentials'
      AND column_name = 'username'
      AND data_type = 'character varying'
  ) THEN
    ALTER TABLE vendor_credentials ALTER COLUMN username TYPE TEXT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vendor_credentials'
      AND column_name = 'password'
      AND data_type = 'character varying'
  ) THEN
    ALTER TABLE vendor_credentials ALTER COLUMN password TYPE TEXT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vendor_credentials'
      AND column_name = 'id_number'
      AND data_type = 'character varying'
  ) THEN
    ALTER TABLE vendor_credentials ALTER COLUMN id_number TYPE TEXT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vendor_credentials'
      AND column_name = 'card6_digits'
      AND data_type = 'character varying'
  ) THEN
    ALTER TABLE vendor_credentials ALTER COLUMN card6_digits TYPE TEXT;
  END IF;
END $$;
