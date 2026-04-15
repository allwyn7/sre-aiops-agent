-- Drop column removed from Book entity in PR #52
ALTER TABLE book DROP COLUMN IF EXISTS price_old;
