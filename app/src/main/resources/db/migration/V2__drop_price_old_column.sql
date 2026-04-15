-- V2: Drop deprecated price_old column (fix for INC-2024-002)
-- The Book entity no longer maps price_old after PR #52.
-- This migration brings the DB schema in sync with the JPA entity.

ALTER TABLE book DROP COLUMN IF EXISTS price_old;
