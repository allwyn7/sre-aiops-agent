-- Flyway Migration V2: Reintroduce `price_old` column to Books table
ALTER TABLE Books ADD COLUMN price_old DECIMAL(10, 2);