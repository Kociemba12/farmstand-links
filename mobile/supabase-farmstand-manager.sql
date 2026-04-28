-- ============================================
-- FARMSTAND MANAGER TABLES
-- ============================================
-- Run this SQL in your Supabase SQL Editor
-- These tables are ISOLATED from existing claim/approval/listing logic
--
-- Ownership is determined via the farmstand_owners table.
-- RLS policies scope all rows to the signed-in user's owned farmstands.

-- ============================================================
-- 1. INVENTORY TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.farmstand_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmstand_id UUID NOT NULL REFERENCES public.farmstands(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  category TEXT,
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 0,
  unit TEXT DEFAULT 'each',
  price NUMERIC(10, 2),
  low_stock_threshold NUMERIC(10, 2) DEFAULT 5,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS farmstand_inventory_farmstand_id_idx ON public.farmstand_inventory(farmstand_id);
CREATE INDEX IF NOT EXISTS farmstand_inventory_is_active_idx ON public.farmstand_inventory(is_active);

ALTER TABLE public.farmstand_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can read own inventory" ON public.farmstand_inventory;
CREATE POLICY "Owners can read own inventory"
  ON public.farmstand_inventory FOR SELECT
  USING (
    farmstand_id IN (
      SELECT farmstand_id FROM public.farmstand_owners WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can insert own inventory" ON public.farmstand_inventory;
CREATE POLICY "Owners can insert own inventory"
  ON public.farmstand_inventory FOR INSERT
  WITH CHECK (
    farmstand_id IN (
      SELECT farmstand_id FROM public.farmstand_owners WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can update own inventory" ON public.farmstand_inventory;
CREATE POLICY "Owners can update own inventory"
  ON public.farmstand_inventory FOR UPDATE
  USING (
    farmstand_id IN (
      SELECT farmstand_id FROM public.farmstand_owners WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can delete own inventory" ON public.farmstand_inventory;
CREATE POLICY "Owners can delete own inventory"
  ON public.farmstand_inventory FOR DELETE
  USING (
    farmstand_id IN (
      SELECT farmstand_id FROM public.farmstand_owners WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- 2. SALES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.farmstand_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmstand_id UUID NOT NULL REFERENCES public.farmstands(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES public.farmstand_inventory(id) ON DELETE SET NULL,
  item_name_snapshot TEXT NOT NULL,
  category TEXT,
  quantity NUMERIC(10, 2),
  unit TEXT,
  unit_price NUMERIC(10, 2),
  total_amount NUMERIC(10, 2) NOT NULL,
  payment_method TEXT DEFAULT 'cash',
  sold_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS farmstand_sales_farmstand_id_idx ON public.farmstand_sales(farmstand_id);
CREATE INDEX IF NOT EXISTS farmstand_sales_sold_at_idx ON public.farmstand_sales(sold_at DESC);
CREATE INDEX IF NOT EXISTS farmstand_sales_inventory_item_idx ON public.farmstand_sales(inventory_item_id);

ALTER TABLE public.farmstand_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can read own sales" ON public.farmstand_sales;
CREATE POLICY "Owners can read own sales"
  ON public.farmstand_sales FOR SELECT
  USING (
    farmstand_id IN (
      SELECT farmstand_id FROM public.farmstand_owners WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can insert own sales" ON public.farmstand_sales;
CREATE POLICY "Owners can insert own sales"
  ON public.farmstand_sales FOR INSERT
  WITH CHECK (
    farmstand_id IN (
      SELECT farmstand_id FROM public.farmstand_owners WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can update own sales" ON public.farmstand_sales;
CREATE POLICY "Owners can update own sales"
  ON public.farmstand_sales FOR UPDATE
  USING (
    farmstand_id IN (
      SELECT farmstand_id FROM public.farmstand_owners WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can delete own sales" ON public.farmstand_sales;
CREATE POLICY "Owners can delete own sales"
  ON public.farmstand_sales FOR DELETE
  USING (
    farmstand_id IN (
      SELECT farmstand_id FROM public.farmstand_owners WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- 3. EXPENSES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.farmstand_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmstand_id UUID NOT NULL REFERENCES public.farmstands(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'other',
  vendor TEXT,
  amount NUMERIC(10, 2) NOT NULL,
  spent_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS farmstand_expenses_farmstand_id_idx ON public.farmstand_expenses(farmstand_id);
CREATE INDEX IF NOT EXISTS farmstand_expenses_spent_at_idx ON public.farmstand_expenses(spent_at DESC);

ALTER TABLE public.farmstand_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can read own expenses" ON public.farmstand_expenses;
CREATE POLICY "Owners can read own expenses"
  ON public.farmstand_expenses FOR SELECT
  USING (
    farmstand_id IN (
      SELECT farmstand_id FROM public.farmstand_owners WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can insert own expenses" ON public.farmstand_expenses;
CREATE POLICY "Owners can insert own expenses"
  ON public.farmstand_expenses FOR INSERT
  WITH CHECK (
    farmstand_id IN (
      SELECT farmstand_id FROM public.farmstand_owners WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can update own expenses" ON public.farmstand_expenses;
CREATE POLICY "Owners can update own expenses"
  ON public.farmstand_expenses FOR UPDATE
  USING (
    farmstand_id IN (
      SELECT farmstand_id FROM public.farmstand_owners WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can delete own expenses" ON public.farmstand_expenses;
CREATE POLICY "Owners can delete own expenses"
  ON public.farmstand_expenses FOR DELETE
  USING (
    farmstand_id IN (
      SELECT farmstand_id FROM public.farmstand_owners WHERE user_id = auth.uid()
    )
  );
