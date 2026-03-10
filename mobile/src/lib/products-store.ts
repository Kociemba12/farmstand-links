import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

// Product record
export interface Product {
  id: string;
  farmstand_id: string;
  name: string;
  category: ProductCategory;
  description: string | null;
  unit: ProductUnit;
  price: number;
  is_in_stock: boolean;
  stock_note: string | null;
  seasonal: string | null;
  photo_url: string | null;
  sort_order: number;
  is_active: boolean;
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

interface ProductsState {
  products: Product[];
  editHistory: FarmstandEditHistory[];
  isLoading: boolean;

  // Actions
  loadProducts: () => Promise<void>;
  getProductsForFarmstand: (farmstand_id: string) => Product[];
  getActiveProductsForFarmstand: (farmstand_id: string) => Product[];

  // Product CRUD
  addProduct: (product: Omit<Product, 'id' | 'updated_at'>) => Promise<Product>;
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
      console.error('Error loading products:', error);
      set({ isLoading: false });
    }
  },

  getProductsForFarmstand: (farmstand_id) => {
    return get().products
      .filter((p) => p.farmstand_id === farmstand_id)
      .sort((a, b) => a.sort_order - b.sort_order);
  },

  getActiveProductsForFarmstand: (farmstand_id) => {
    return get().products
      .filter((p) => p.farmstand_id === farmstand_id && p.is_active)
      .sort((a, b) => a.sort_order - b.sort_order);
  },

  addProduct: async (productData) => {
    const newProduct: Product = {
      ...productData,
      id: `prod-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      updated_at: new Date().toISOString(),
    };

    const products = [...get().products, newProduct];
    await AsyncStorage.setItem('farmstand_products', JSON.stringify(products));
    set({ products });

    return newProduct;
  },

  updateProduct: async (id, updates, userId, userRole) => {
    const state = get();
    const existingProduct = state.products.find((p) => p.id === id);
    if (!existingProduct) return false;

    // Log changes to edit history
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

    const products = state.products.map((p) =>
      p.id === id
        ? { ...p, ...updates, updated_at: new Date().toISOString() }
        : p
    );

    await AsyncStorage.setItem('farmstand_products', JSON.stringify(products));
    set({ products });

    return true;
  },

  deleteProduct: async (id) => {
    const products = get().products.filter((p) => p.id !== id);
    await AsyncStorage.setItem('farmstand_products', JSON.stringify(products));
    set({ products });
    return true;
  },

  markAllInStock: async (farmstand_id, userId) => {
    const products = get().products.map((p) =>
      p.farmstand_id === farmstand_id
        ? { ...p, is_in_stock: true, updated_at: new Date().toISOString() }
        : p
    );

    await AsyncStorage.setItem('farmstand_products', JSON.stringify(products));
    set({ products });

    // Log the bulk action
    await get().logEdit(
      farmstand_id,
      'products.bulk_stock_update',
      null,
      'all_in_stock',
      userId,
      'owner'
    );
  },

  markAllOutOfStock: async (farmstand_id, userId) => {
    const products = get().products.map((p) =>
      p.farmstand_id === farmstand_id
        ? { ...p, is_in_stock: false, updated_at: new Date().toISOString() }
        : p
    );

    await AsyncStorage.setItem('farmstand_products', JSON.stringify(products));
    set({ products });

    // Log the bulk action
    await get().logEdit(
      farmstand_id,
      'products.bulk_stock_update',
      null,
      'all_out_of_stock',
      userId,
      'owner'
    );
  },

  reorderProducts: async (farmstand_id, productIds) => {
    const products = get().products.map((p) => {
      if (p.farmstand_id !== farmstand_id) return p;
      const newOrder = productIds.indexOf(p.id);
      return newOrder >= 0 ? { ...p, sort_order: newOrder } : p;
    });

    await AsyncStorage.setItem('farmstand_products', JSON.stringify(products));
    set({ products });
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
