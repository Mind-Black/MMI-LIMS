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
-- Tier B (Moderate: ~19.01 €/h external, 10.50 €/h KTU, 0.05 €/h dept):
UPDATE public.tools
SET rate_category = 'B'
WHERE lower(name) LIKE '%sputter%lh a700%'
   OR lower(name) LIKE '%cubivap%'
   OR lower(name) LIKE '%renishaw%invia%';

-- Tier C (High: ~35.12 €/h external, 21.00 €/h KTU, 0.11 €/h dept):
UPDATE public.tools
SET rate_category = 'C'
WHERE lower(name) LIKE '%femtolab%'
   OR lower(name) LIKE '%quanta 200%'
   OR lower(name) LIKE '%universal optical spectroscopy%';

-- Tier D (Premium: ~48.76 €/h external, 28.50 €/h KTU, 0.14 €/h dept):
UPDATE public.tools
SET rate_category = 'D'
WHERE lower(name) LIKE '%raith%e-line%'
   OR lower(name) LIKE '%apex slr%';
