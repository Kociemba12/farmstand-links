-- Add is_seasonal boolean field to farmstands table
-- Used by the Explore "Seasonal Stands" section.
-- Only farmstands with is_seasonal = true will appear there.
-- Defaults to false so no existing farmstand appears in Seasonal Stands
-- until an admin explicitly marks it.

ALTER TABLE farmstands
  ADD COLUMN IF NOT EXISTS is_seasonal BOOLEAN NOT NULL DEFAULT false;
