-- Add 'price_old' column back to fix schema drift.
ALTER TABLE Book ADD COLUMN price_old DECIMAL(10,2);