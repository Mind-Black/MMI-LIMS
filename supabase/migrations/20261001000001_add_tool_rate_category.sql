-- ==============================================================================
-- 20261001000001_add_tool_rate_category.sql
-- Add rate_category (A, B, C, D) to public.tools with backfill for existing tools
-- ==============================================================================

-- 1. Add rate_category column to public.tools with default 'A' and check constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tools' AND column_name = 'rate_category'
  ) THEN
    ALTER TABLE public.tools ADD COLUMN rate_category text NOT NULL DEFAULT 'A';
  END IF;
END $$;

-- 2. Ensure CHECK constraint on rate_category (A, B, C, D)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'tools_rate_category_check'
  ) THEN
    ALTER TABLE public.tools ADD CONSTRAINT tools_rate_category_check 
      CHECK (rate_category IN ('A', 'B', 'C', 'D'));
  END IF;
END $$;

-- 3. Create index for rate_category querying and filtering
CREATE INDEX IF NOT EXISTS idx_tools_rate_category ON public.tools(rate_category);

-- 4. Backfill existing 7 database tools with their respective rate categories
-- Tier B (Standard: 38.02 €/h external, 21.00 €/h university, 0.10 €/h dept, hourly excl. VAT):
UPDATE public.tools
SET rate_category = 'B'
WHERE lower(name) LIKE '%sputter%lh a700%'
   OR lower(name) LIKE '%cubivap%'
   OR lower(name) LIKE '%renishaw%invia%';

-- Tier C (Advanced: 70.24 €/h external, 42.00 €/h university, 0.22 €/h dept, hourly excl. VAT):
UPDATE public.tools
SET rate_category = 'C'
WHERE lower(name) LIKE '%femtolab%'
   OR lower(name) LIKE '%quanta 200%'
   OR lower(name) LIKE '%universal optical spectroscopy%';

-- Tier D (Premium: 97.52 €/h external, 57.00 €/h university, 0.28 €/h dept, hourly excl. VAT):
UPDATE public.tools
SET rate_category = 'D'
WHERE lower(name) LIKE '%raith%e-line%'
   OR lower(name) LIKE '%apex slr%';
