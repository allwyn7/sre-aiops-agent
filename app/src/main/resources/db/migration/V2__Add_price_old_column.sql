-- Flyway migration script to restore the price_old column
ALTER TABLE books ADD COLUMN price_old NUMERIC(10, 2);