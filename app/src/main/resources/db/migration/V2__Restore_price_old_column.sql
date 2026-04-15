-- Flyway migration to restore price_old column
ALTER TABLE book ADD COLUMN IF NOT EXISTS price_old NUMERIC(19,2);