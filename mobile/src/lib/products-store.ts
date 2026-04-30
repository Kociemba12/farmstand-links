import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from './supabase';
import { notifyStandUpdate } from './stand-update-notifier';

// Product unit types
export type ProductUnit = 'each' | 'dozen' | 'lb' | 'bunch' | 'jar' | 'bag' | 'box' | 'quart' | 'gallon' | 'pint';

// Product category types
export type ProductCategory =
  | 'produce'
  | 'eggs'
  | 'dairy'
  | 'meat'
  | 'baked_goods'
  | 'preserves'
  | 'honey'
  | 'flowers'
  | 'plants'
  | 'crafts'
  | 'other';

// Local Product interface (UI-facing)
export interface Product {
  id: string;
  farmstand_id: string;
  name: string;
  category: ProductCategory;
  description: string | null;
  unit: ProductUnit;
  price: number;          // display price (dollars)
  is_in_stock: boolean;
  stock_note: string | null;
  seasonal: string | null;
  photo_url: string | null;
  sort_order: number;
  is_active: boolean;
  updated_at: string;
}

// Actual farmstand_products table schema
// Valid columns: id, farmstand_id, owner_user_id, title, description,
//                price_cents, currency, photo_url, in_stock, stock_note,
//                seasonal_availability, sort_order, created_at, updated_at
interface SupabaseProductRow {
  id: string;
  farmstand_id: string;
  owner_user_id: string | null;
  title: string;
  description: string | null;
  price_cents: number | null;
  currency: string | null;
  photo_url: string | null;
  in_stock: boolean | null;
  stock_note: string | null;
  seasonal_availability: string | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
}

// Edit history record
export interface FarmstandEditHistory {
  id: string;
  farmstand_id: string;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  timestamp: string;
  edited_by_user_id: string;
  edited_by_role: 'owner' | 'admin';
}

// Detect if an ID is a Supabase-generated UUID
function isSupabaseUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// Map a Supabase row to the app's Product interface
function rowToProduct(row: SupabaseProductRow): Product {
  return {
    id: row.id,
    farmstand_id: row.farmstand_id,
    name: row.title,
    category: 'other',               // not stored in DB — default
    description: row.description,
    unit: 'each',                     // not stored in DB — default
    price: (row.price_cents ?? 0) / 100,
    is_in_stock: row.in_stock ?? true,
    stock_note: row.stock_note ?? null,
    seasonal: row.seasonal_availability ?? null,
    photo_url: row.photo_url,
    sort_order: row.sort_order ?? 0,
    is_active: true,                  // not stored in DB
    updated_at: row.updated_at,
  };
}

// Build the Supabase payload for insert — ONLY valid columns
function productToInsertPayload(
  product: Omit<Product, 'id' | 'updated_at'>,
  userId: string
): Record<string, unknown> {
  const priceCents = Math.round((product.price ?? 0) * 100);
  return {
    farmstand_id: product.farmstand_id,
    owner_user_id: userId,
    title: product.name?.trim() || '',
    description: product.description?.trim() || null,
    price_cents: priceCents,
    currency: 'USD',
    photo_url: product.photo_url || null,
    in_stock: product.is_in_stock ?? true,
    stock_note: product.stock_note?.trim() || null,
    seasonal_availability: product.seasonal?.trim() || null,
    sort_order: product.sort_order ?? 0,
  };
}

// Map local Product field names to Supabase column names for updates
function mapUpdateFields(updates: Partial<Product>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (key === 'name') {
      mapped['title'] = typeof value === 'string' ? value.trim() : value;
    } else if (key === 'price') {
      mapped['price_cents'] = Math.round((value as number) * 100);
    } else if (key === 'is_in_stock') {
      mapped['in_stock'] = value;
    } else if (key === 'description' || key === 'photo_url') {
      mapped[key] = value;
    } else if (key === 'stock_note') {
      mapped['stock_note'] = typeof value === 'string' ? (value.trim() || null) : null;
    } else if (key === 'seasonal') {
      mapped['seasonal_availability'] = typeof value === 'string' ? (value.trim() || null) : null;
    } else if (key === 'sort_order') {
      mapped['sort_order'] = value;
    }
    // Skip: category, unit, is_active, id, farmstand_id, updated_at — not stored in DB
  }
  return mapped;
}

interface ProductsState {
  products: Product[];
  editHistory: FarmstandEditHistory[];
  isLoading: boolean;

  // Actions
  loadProducts: () => Promise<void>;
  fetchProductsForFarmstand: (farmstand_id: string) => Promise<void>;
  getProductsForFarmstand: (farmstand_id: string) => Product[];
  getActiveProductsForFarmstand: (farmstand_id: string) => Product[];

  // Product CRUD
  addProduct: (product: Omit<Product, 'id' | 'updated_at'>, userId: string) => Promise<Product>;
  updateProduct: (id: string, updates: Partial<Product>, userId: string, userRole: 'owner' | 'admin') => Promise<boolean>;
  deleteProduct: (id: string) => Promise<boolean>;

  // Bulk actions
  markAllInStock: (farmstand_id: string, userId: string) => Promise<void>;
  markAllOutOfStock: (farmstand_id: string, userId: string) => Promise<void>;
  reorderProducts: (farmstand_id: string, productIds: string[]) => Promise<void>;

  // Edit history
  logEdit: (
    farmstand_id: string,
    field_changed: string,
    old_value: string | null,
    new_value: string | null,
    edited_by_user_id: string,
    edited_by_role: 'owner' | 'admin'
  ) => Promise<void>;
  getEditHistory: (farmstand_id: string) => FarmstandEditHistory[];
}

export const useProductsStore = create<ProductsState>((set, get) => ({
  products: [],
  editHistory: [],
  isLoading: false,

  // ── loadProducts: Load from AsyncStorage (local cache) ─────
  loadProducts: async () => {
    set({ isLoading: true });
    try {
      const productsData = await AsyncStorage.getItem('farmstand_products');
      const historyData = await AsyncStorage.getItem('farmstand_edit_history');
      set({
        products: productsData ? JSON.parse(productsData) : [],
        editHistory: historyData ? JSON.parse(historyData) : [],
        isLoading: false,
      });
    } catch (error) {
      console.error('[Products] Error loading from local cache:', error);
      set({ isLoading: false });
    }
  },

  // ── fetchProductsForFarmstand: Supabase source of truth ────
  fetchProductsForFarmstand: async (farmstand_id: string) => {
    if (__DEV__) console.log('[Products] fetchProductsForFarmstand — farmstand_id:', farmstand_id);

    if (!farmstand_id) {
      if (__DEV__) console.log('[Products] fetchProductsForFarmstand: no farmstand_id, aborting');
      return;
    }

    set({ isLoading: true });

    if (!isSupabaseConfigured()) {
      if (__DEV__) console.log('[Products] Supabase not configured — falling back to local cache');
      await get().loadProducts();
      return;
    }

    try {
      // Prefer an authenticated read so RLS SELECT policies allow access.
      // farmstand_products may require auth.uid() IS NOT NULL to SELECT.
      // Falls back to anon key for public/guest visitors with no session.
      let result = await supabase
        .from<SupabaseProductRow>('farmstand_products')
        .select('*')
        .eq('farmstand_id', farmstand_id)
        .order('created_at', { ascending: true })
        .requireAuth()
        .execute();

      if (result.error?.message === 'AUTH_REQUIRED') {
        if (__DEV__) console.log('[Products] fetchProductsForFarmstand — no session, retrying with anon key');
        result = await supabase
          .from<SupabaseProductRow>('farmstand_products')
          .select('*')
          .eq('farmstand_id', farmstand_id)
          .order('created_at', { ascending: true })
          .execute();
      }

      const { data, error } = result;

      if (error) {
        if (__DEV__) console.warn('[Products] fetchProductsForFarmstand — Supabase error:', error.message);
        const cached = get().products;
        if (cached.length === 0) {
          await get().loadProducts();
        } else {
          set({ isLoading: false });
        }
        return;
      }

      const rows = data ?? [];
      if (__DEV__) console.log('[Products] fetchProductsForFarmstand — rows returned from farmstand_products:', rows.length, '| farmstand_id:', farmstand_id);

      // Safety net: if Supabase returned 0 rows but the local cache already has
      // UUID-format products for this farmstand, preserve the cache instead of
      // overwriting it with empty. This prevents a silent RLS read failure (where
      // the table returns [] instead of an error) from wiping valid cached data.
      const hadCachedUuidProducts = get().products.some(
        (p) => p.farmstand_id === farmstand_id && isSupabaseUuid(p.id)
      );
      if (rows.length === 0 && hadCachedUuidProducts) {
        if (__DEV__) console.log('[Products] fetchProductsForFarmstand — 0 rows from Supabase but cache has UUID products; preserving cache to avoid silent-RLS wipe');
        set({ isLoading: false });
        return;
      }

      const fetched = rows.map(rowToProduct);
      const supabaseIds = new Set(fetched.map((p) => p.id));

      const otherProducts = get().products.filter((p) => p.farmstand_id !== farmstand_id);
      const localOnlyProducts = get().products.filter(
        (p) => p.farmstand_id === farmstand_id && !isSupabaseUuid(p.id) && !supabaseIds.has(p.id)
      );
      if (localOnlyProducts.length > 0) {
        if (__DEV__) console.log('[Products] Preserving', localOnlyProducts.length, 'local-only product(s) pending Supabase sync');
      }
      const merged = [...otherProducts, ...localOnlyProducts, ...fetched];

      await AsyncStorage.setItem('farmstand_products', JSON.stringify(merged));
      set({ products: merged, isLoading: false });

      if (__DEV__) console.log('[Products] fetchProductsForFarmstand — store updated | rows for this farmstand:', fetched.length, '| total store:', merged.length);
    } catch (err) {
      if (__DEV__) console.log('[Products] fetchProductsForFarmstand unexpected error:', err);
      await get().loadProducts();
    }
  },

  getProductsForFarmstand: (farmstand_id) => {
    return get().products
      .filter((p) => p.farmstand_id === farmstand_id)
      .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
  },

  getActiveProductsForFarmstand: (farmstand_id) => {
    return get().products
      .filter((p) => p.farmstand_id === farmstand_id && p.is_active)
      .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
  },

  // ── addProduct: Insert to Supabase ─────────────────────────
  addProduct: async (productData, userId) => {
    console.log('[Products][addProduct] ▶ ENTERED');
    console.log('[Products][addProduct] user.id:', userId);
    console.log('[Products][addProduct] farmstand_id:', productData.farmstand_id);
    console.log('[Products][addProduct] name:', productData.name);
    console.log('[Products][addProduct] price:', productData.price);

    // ── Validation ──────────────────────────────────────────
    if (!productData.farmstand_id) {
      const msg = 'Missing farmstand ID — cannot save product';
      console.log('[Products][addProduct] VALIDATION FAIL:', msg);
      throw new Error(msg);
    }

    if (!productData.name?.trim()) {
      const msg = 'Product title is required';
      console.log('[Products][addProduct] VALIDATION FAIL:', msg);
      throw new Error(msg);
    }

    const priceCents = Math.round((productData.price ?? 0) * 100);
    if (isNaN(priceCents) || priceCents < 0) {
      const msg = 'Invalid price — please enter a valid number';
      console.log('[Products][addProduct] VALIDATION FAIL:', msg);
      throw new Error(msg);
    }

    // ── Optimistic local update ──────────────────────────────
    const tempId = `prod-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newProduct: Product = {
      ...productData,
      id: tempId,
      updated_at: new Date().toISOString(),
    };

    const optimisticProducts = [...get().products, newProduct];
    await AsyncStorage.setItem('farmstand_products', JSON.stringify(optimisticProducts));
    set({ products: optimisticProducts });

    console.log('[Products][addProduct] Optimistic local update done — tempId:', tempId);

    if (!isSupabaseConfigured()) {
      console.log('[Products][addProduct] ⚠️ Supabase NOT configured — product saved locally only');
      notifyStandUpdate(newProduct.farmstand_id, newProduct.is_in_stock);
      return newProduct;
    }

    // ── Build exact insert payload (valid columns only) ──────
    const payload = productToInsertPayload(productData, userId);
    console.log('SAVE PAYLOAD:', JSON.stringify(payload));

    try {
      const { data, error } = await supabase
        .from<SupabaseProductRow>('farmstand_products')
        .insert(payload)
        .execute();

      console.log('[Products][addProduct] Insert data:', JSON.stringify(data));
      console.log('RETURNED ROW:', JSON.stringify(data?.[0]));
      console.log('[Products][addProduct] Insert error:', JSON.stringify(error));

      if (error) {
        console.log('[Products][addProduct] ❌ Insert FAILED:', error.message);
        // Remove optimistic entry so UI is honest about failure
        const reverted = get().products.filter((p) => p.id !== tempId);
        await AsyncStorage.setItem('farmstand_products', JSON.stringify(reverted));
        set({ products: reverted });
        throw error;
      }

      const savedRow = data?.[0];
      if (savedRow) {
        console.log('[Products][addProduct] ✅ Insert confirmed, Supabase id:', savedRow.id);
        const savedProduct = rowToProduct(savedRow);
        const updated = get().products.map((p) => (p.id === tempId ? savedProduct : p));
        await AsyncStorage.setItem('farmstand_products', JSON.stringify(updated));
        set({ products: updated });
        notifyStandUpdate(savedProduct.farmstand_id, savedProduct.is_in_stock);
        return savedProduct;
      } else {
        // 204 / empty body — insert succeeded but no row returned
        console.log('[Products][addProduct] ⚠️ Insert succeeded (no row returned) — refetching');
        setTimeout(() => get().fetchProductsForFarmstand(productData.farmstand_id), 500);
      }
    } catch (err) {
      console.log('[Products][addProduct] ❌ EXCEPTION during insert:', err);
      throw err;
    }

    notifyStandUpdate(newProduct.farmstand_id, newProduct.is_in_stock);
    console.log('[Products][addProduct] ◀ EXITING (empty-body path)');
    return newProduct;
  },

  // ── updateProduct: PATCH in Supabase + update local ────────
  updateProduct: async (id, updates, userId, userRole) => {
    const state = get();
    const existingProduct = state.products.find((p) => p.id === id);
    if (!existingProduct) {
      console.log('[Products] updateProduct: product not found, id:', id);
      return false;
    }

    console.log('[Products] updateProduct — id:', id, 'is UUID:', isSupabaseUuid(id));

    for (const [key, newValue] of Object.entries(updates)) {
      const oldValue = existingProduct[key as keyof Product];
      if (oldValue !== newValue) {
        await get().logEdit(
          existingProduct.farmstand_id,
          `product.${key}`,
          oldValue != null ? String(oldValue) : null,
          newValue != null ? String(newValue) : null,
          userId,
          userRole
        );
      }
    }

    const updatedProduct = {
      ...existingProduct,
      ...updates,
      updated_at: new Date().toISOString(),
    };

    const products = state.products.map((p) => (p.id === id ? updatedProduct : p));
    await AsyncStorage.setItem('farmstand_products', JSON.stringify(products));
    set({ products });

    if (isSupabaseConfigured() && isSupabaseUuid(id)) {
      const supabaseUpdates = mapUpdateFields(updates);

      if (Object.keys(supabaseUpdates).length > 0) {
        console.log('[Products] Updating Supabase product id:', id, '| fields:', JSON.stringify(supabaseUpdates));
        try {
          const { error } = await supabase
            .from<SupabaseProductRow>('farmstand_products')
            .update(supabaseUpdates)
            .eq('id', id)
            .execute();

          if (error) {
            console.log('[Products] Supabase update ERROR:', error.message);
          } else {
            console.log('[Products] Supabase update SUCCESS');
          }
        } catch (err) {
          console.log('[Products] updateProduct Supabase exception:', err);
        }
      }
    }

    const becameAvailable = updates.is_in_stock === true && existingProduct.is_in_stock === false;
    notifyStandUpdate(existingProduct.farmstand_id, becameAvailable);

    return true;
  },

  // ── deleteProduct: DELETE from Supabase + remove local ─────
  deleteProduct: async (id) => {
    console.log('[Products] deleteProduct — id:', id, 'is UUID:', isSupabaseUuid(id));

    const products = get().products.filter((p) => p.id !== id);
    await AsyncStorage.setItem('farmstand_products', JSON.stringify(products));
    set({ products });

    if (isSupabaseConfigured() && isSupabaseUuid(id)) {
      try {
        const { error } = await supabase
          .from<SupabaseProductRow>('farmstand_products')
          .delete()
          .eq('id', id)
          .execute();

        if (error) {
          console.log('[Products] Supabase delete ERROR:', error.message);
        } else {
          console.log('[Products] Supabase delete SUCCESS');
        }
      } catch (err) {
        console.log('[Products] deleteProduct Supabase exception:', err);
      }
    }

    return true;
  },

  // ── markAllInStock: bulk update ─────────────────────────────
  markAllInStock: async (farmstand_id, userId) => {
    console.log('[Products] markAllInStock — farmstand_id:', farmstand_id);

    const products = get().products.map((p) =>
      p.farmstand_id === farmstand_id
        ? { ...p, is_in_stock: true, updated_at: new Date().toISOString() }
        : p
    );
    await AsyncStorage.setItem('farmstand_products', JSON.stringify(products));
    set({ products });

    if (isSupabaseConfigured()) {
      try {
        const { error } = await supabase
          .from<SupabaseProductRow>('farmstand_products')
          .update({ in_stock: true })
          .eq('farmstand_id', farmstand_id)
          .execute();

        if (error) {
          console.log('[Products] markAllInStock Supabase ERROR:', error.message);
        } else {
          console.log('[Products] markAllInStock Supabase SUCCESS');
        }
      } catch (err) {
        console.log('[Products] markAllInStock Supabase exception:', err);
      }
    }

    await get().logEdit(farmstand_id, 'products.bulk_stock_update', null, 'all_in_stock', userId, 'owner');
    notifyStandUpdate(farmstand_id, true);
  },

  // ── markAllOutOfStock: bulk update ──────────────────────────
  markAllOutOfStock: async (farmstand_id, userId) => {
    console.log('[Products] markAllOutOfStock — farmstand_id:', farmstand_id);

    const products = get().products.map((p) =>
      p.farmstand_id === farmstand_id
        ? { ...p, is_in_stock: false, updated_at: new Date().toISOString() }
        : p
    );
    await AsyncStorage.setItem('farmstand_products', JSON.stringify(products));
    set({ products });

    if (isSupabaseConfigured()) {
      try {
        const { error } = await supabase
          .from<SupabaseProductRow>('farmstand_products')
          .update({ in_stock: false })
          .eq('farmstand_id', farmstand_id)
          .execute();

        if (error) {
          console.log('[Products] markAllOutOfStock Supabase ERROR:', error.message);
        } else {
          console.log('[Products] markAllOutOfStock Supabase SUCCESS');
        }
      } catch (err) {
        console.log('[Products] markAllOutOfStock Supabase exception:', err);
      }
    }

    await get().logEdit(farmstand_id, 'products.bulk_stock_update', null, 'all_out_of_stock', userId, 'owner');
    notifyStandUpdate(farmstand_id, false);
  },

  reorderProducts: async (farmstand_id, productIds) => {
    const products = get().products.map((p) => {
      if (p.farmstand_id !== farmstand_id) return p;
      const newOrder = productIds.indexOf(p.id);
      return newOrder >= 0 ? { ...p, sort_order: newOrder } : p;
    });

    await AsyncStorage.setItem('farmstand_products', JSON.stringify(products));
    set({ products });
    // sort_order not in DB — local only
  },

  logEdit: async (farmstand_id, field_changed, old_value, new_value, edited_by_user_id, edited_by_role) => {
    const newEntry: FarmstandEditHistory = {
      id: `edit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      farmstand_id,
      field_changed,
      old_value,
      new_value,
      timestamp: new Date().toISOString(),
      edited_by_user_id,
      edited_by_role,
    };

    const editHistory = [...get().editHistory, newEntry];
    await AsyncStorage.setItem('farmstand_edit_history', JSON.stringify(editHistory));
    set({ editHistory });
  },

  getEditHistory: (farmstand_id) => {
    return get().editHistory
      .filter((h) => h.farmstand_id === farmstand_id)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  },
}));

// Export product category labels
export const PRODUCT_CATEGORY_LABELS: { [key in ProductCategory]: string } = {
  produce: 'Fresh Produce',
  eggs: 'Eggs',
  dairy: 'Dairy',
  meat: 'Meat',
  baked_goods: 'Baked Goods',
  preserves: 'Preserves & Jams',
  honey: 'Honey',
  flowers: 'Flowers',
  plants: 'Plants & Seedlings',
  crafts: 'Crafts',
  other: 'Other',
};

// Export unit labels
export const PRODUCT_UNIT_LABELS: { [key in ProductUnit]: string } = {
  each: 'each',
  dozen: 'dozen',
  lb: 'lb',
  bunch: 'bunch',
  jar: 'jar',
  bag: 'bag',
  box: 'box',
  quart: 'quart',
  gallon: 'gallon',
  pint: 'pint',
};
