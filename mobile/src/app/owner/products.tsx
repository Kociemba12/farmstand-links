import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Image,
  ActivityIndicator,
  Alert,
  Modal,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Plus,
  Package,
  DollarSign,
  Edit3,
  Trash2,
  X,
  Check,
  CheckCircle,
  XCircle,
  ImagePlus,
  Camera,
  ChevronDown,
  ChevronRight,
  Tag,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown, FadeIn, SlideInRight } from 'react-native-reanimated';
import { useUserStore } from '@/lib/user-store';
import { useAdminStore } from '@/lib/admin-store';
import {
  useProductsStore,
  Product,
  ProductCategory,
  ProductUnit,
  PRODUCT_CATEGORY_LABELS,
  PRODUCT_UNIT_LABELS,
} from '@/lib/products-store';
import { logFarmstandEdit } from '@/lib/analytics-events';
import { FarmerRouteGuard } from '@/components/FarmerRouteGuard';

const CATEGORY_OPTIONS: { id: ProductCategory; label: string }[] = [
  { id: 'produce', label: 'Fresh Produce' },
  { id: 'eggs', label: 'Eggs' },
  { id: 'dairy', label: 'Dairy' },
  { id: 'meat', label: 'Meat' },
  { id: 'baked_goods', label: 'Baked Goods' },
  { id: 'preserves', label: 'Preserves & Jams' },
  { id: 'honey', label: 'Honey' },
  { id: 'flowers', label: 'Flowers' },
  { id: 'plants', label: 'Plants & Seedlings' },
  { id: 'crafts', label: 'Crafts' },
  { id: 'other', label: 'Other' },
];

const UNIT_OPTIONS: { id: ProductUnit; label: string }[] = [
  { id: 'each', label: 'each' },
  { id: 'dozen', label: 'dozen' },
  { id: 'lb', label: 'lb' },
  { id: 'bunch', label: 'bunch' },
  { id: 'jar', label: 'jar' },
  { id: 'bag', label: 'bag' },
  { id: 'box', label: 'box' },
  { id: 'quart', label: 'quart' },
  { id: 'pint', label: 'pint' },
  { id: 'gallon', label: 'gallon' },
];

interface ProductFormData {
  name: string;
  category: ProductCategory;
  description: string;
  unit: ProductUnit;
  price: string;
  is_in_stock: boolean;
  stock_note: string;
  seasonal: string;
  photo_url: string;
}

const initialFormData: ProductFormData = {
  name: '',
  category: 'produce',
  description: '',
  unit: 'each',
  price: '',
  is_in_stock: true,
  stock_note: '',
  seasonal: '',
  photo_url: '',
};

export default function ProductsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const farmstandId = params.id;

  const user = useUserStore((s) => s.user);
  const isLoggedIn = useUserStore((s) => s.isLoggedIn);
  const isGuest = useUserStore((s) => s.isGuest);

  const getFarmstandById = useAdminStore((s) => s.getFarmstandById);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);

  const products = useProductsStore((s) => s.products);
  const loadProducts = useProductsStore((s) => s.loadProducts);
  const getProductsForFarmstand = useProductsStore((s) => s.getProductsForFarmstand);
  const addProduct = useProductsStore((s) => s.addProduct);
  const updateProduct = useProductsStore((s) => s.updateProduct);
  const deleteProduct = useProductsStore((s) => s.deleteProduct);
  const markAllInStock = useProductsStore((s) => s.markAllInStock);
  const markAllOutOfStock = useProductsStore((s) => s.markAllOutOfStock);

  const isGuestUser = isGuest();

  const [isLoading, setIsLoading] = useState(true);
  const [farmstandProducts, setFarmstandProducts] = useState<Product[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState<ProductFormData>(initialFormData);
  const [isSaving, setIsSaving] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showUnitPicker, setShowUnitPicker] = useState(false);
  const [showPhotoOptions, setShowPhotoOptions] = useState(false);

  // Check authorization
  useEffect(() => {
    if (!isLoggedIn) {
      router.replace('/auth/login');
    }
  }, [isLoggedIn]);

  // Load data
  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      await loadAdminData();
      await loadProducts();

      if (farmstandId) {
        const fs = getFarmstandById(farmstandId);
        if (fs) {
          // Log auth debug info
          console.log('[Products] Checking ownership:');
          console.log('  user.id:', user?.id);
          console.log('  user.email:', user?.email);
          console.log('  fs.ownerUserId:', fs.ownerUserId);
          console.log('  fs.claimedByUserId:', fs.claimedByUserId);

          // Verify ownership - check multiple possible owner identifiers
          // claimedByUserId is the Supabase auth.uid() from claimed_by column
          const isOwner =
            fs.claimedByUserId === user?.id ||
            fs.ownerUserId === user?.id ||
            fs.ownerUserId === user?.email ||
            fs.claimedByUserId === user?.email;

          console.log('  isOwner:', isOwner);

          if (!isOwner) {
            console.log('[Products] Access denied - no ownership match');
            Alert.alert('Unauthorized', 'You do not have permission to edit this farmstand. Please log out and log in again.', [
              { text: 'OK', onPress: () => router.back() },
            ]);
            return;
          }
        }
      }
      setIsLoading(false);
    };

    load();
  }, [farmstandId]);

  // Update product list when products change
  useEffect(() => {
    if (farmstandId) {
      setFarmstandProducts(getProductsForFarmstand(farmstandId));
    }
  }, [products, farmstandId]);

  const openAddModal = useCallback(() => {
    setFormData(initialFormData);
    setEditingProduct(null);
    setShowAddModal(true);
  }, []);

  const openEditModal = useCallback((product: Product) => {
    setFormData({
      name: product.name,
      category: product.category,
      description: product.description || '',
      unit: product.unit,
      price: product.price.toString(),
      is_in_stock: product.is_in_stock,
      stock_note: product.stock_note || '',
      seasonal: product.seasonal || '',
      photo_url: product.photo_url || '',
    });
    setEditingProduct(product);
    setShowAddModal(true);
  }, []);

  const closeModal = useCallback(() => {
    setShowAddModal(false);
    setEditingProduct(null);
    setFormData(initialFormData);
  }, []);

  const updateField = useCallback(<K extends keyof ProductFormData>(field: K, value: ProductFormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSaveProduct = async () => {
    if (!formData.name.trim()) {
      Alert.alert('Required', 'Please enter a product name');
      return;
    }

    if (!formData.price || isNaN(parseFloat(formData.price))) {
      Alert.alert('Required', 'Please enter a valid price');
      return;
    }

    if (!farmstandId || !user?.id) return;

    setIsSaving(true);

    try {
      const productData = {
        farmstand_id: farmstandId,
        name: formData.name.trim(),
        category: formData.category,
        description: formData.description.trim() || null,
        unit: formData.unit,
        price: parseFloat(formData.price),
        is_in_stock: formData.is_in_stock,
        stock_note: formData.stock_note.trim() || null,
        seasonal: formData.seasonal.trim() || null,
        photo_url: formData.photo_url || null,
        sort_order: editingProduct?.sort_order ?? farmstandProducts.length,
        is_active: true,
      };

      if (editingProduct) {
        await updateProduct(editingProduct.id, productData, user.id, 'owner');
      } else {
        await addProduct(productData);
      }

      logFarmstandEdit(farmstandId, ['products'], user.id);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      closeModal();
    } catch (error) {
      console.error('Save error:', error);
      Alert.alert('Error', 'Failed to save product');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProduct = (product: Product) => {
    Alert.alert(
      'Delete Product',
      `Are you sure you want to delete "${product.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteProduct(product.id);
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ]
    );
  };

  const handleToggleStock = async (product: Product) => {
    if (!user?.id) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await updateProduct(product.id, { is_in_stock: !product.is_in_stock }, user.id, 'owner');
  };

  const handleMarkAllInStock = async () => {
    if (!farmstandId || !user?.id) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await markAllInStock(farmstandId, user.id);
  };

  const handleMarkAllOutOfStock = async () => {
    if (!farmstandId || !user?.id) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await markAllOutOfStock(farmstandId, user.id);
  };

  const pickImage = async () => {
    setShowPhotoOptions(false);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your photo library.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      updateField('photo_url', result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    setShowPhotoOptions(false);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your camera.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      updateField('photo_url', result.assets[0].uri);
    }
  };

  // Show guard for guests - AFTER all hooks
  if (isGuestUser) {
    return <FarmerRouteGuard title="Manage Products" />;
  }

  if (isLoading) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#2D5A3D" />
      </View>
    );
  }

  const inStockCount = farmstandProducts.filter((p) => p.is_in_stock).length;
  const outOfStockCount = farmstandProducts.length - inStockCount;

  return (
    <View className="flex-1 bg-gray-50">
      <SafeAreaView edges={['top']} className="bg-forest">
        <View className="flex-row items-center justify-between px-5 py-4">
          <Pressable onPress={() => router.back()} className="p-2 -ml-2">
            <ArrowLeft size={24} color="white" />
          </Pressable>
          <Text className="text-lg font-semibold text-white">Products</Text>
          <Pressable onPress={openAddModal} className="p-2 -mr-2">
            <Plus size={24} color="white" />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Stats Bar */}
        <Animated.View entering={FadeInDown.delay(0)} className="flex-row mx-4 mt-4 mb-2">
          <View className="flex-1 bg-white rounded-xl p-4 mr-2 border border-gray-100">
            <View className="flex-row items-center">
              <View className="w-8 h-8 bg-green-100 rounded-full items-center justify-center">
                <CheckCircle size={16} color="#16a34a" />
              </View>
              <View className="ml-3">
                <Text className="text-2xl font-bold text-gray-900">{inStockCount}</Text>
                <Text className="text-xs text-gray-500">In Stock</Text>
              </View>
            </View>
          </View>
          <View className="flex-1 bg-white rounded-xl p-4 ml-2 border border-gray-100">
            <View className="flex-row items-center">
              <View className="w-8 h-8 bg-red-100 rounded-full items-center justify-center">
                <XCircle size={16} color="#ef4444" />
              </View>
              <View className="ml-3">
                <Text className="text-2xl font-bold text-gray-900">{outOfStockCount}</Text>
                <Text className="text-xs text-gray-500">Out of Stock</Text>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* Bulk Actions */}
        {farmstandProducts.length > 0 && (
          <Animated.View entering={FadeInDown.delay(100)} className="flex-row mx-4 mb-4">
            <Pressable
              onPress={handleMarkAllInStock}
              className="flex-1 bg-green-50 border border-green-200 rounded-xl py-3 mr-2 items-center"
            >
              <Text className="text-green-700 font-medium text-sm">Mark All In Stock</Text>
            </Pressable>
            <Pressable
              onPress={handleMarkAllOutOfStock}
              className="flex-1 bg-red-50 border border-red-200 rounded-xl py-3 ml-2 items-center"
            >
              <Text className="text-red-700 font-medium text-sm">Mark All Out</Text>
            </Pressable>
          </Animated.View>
        )}

        {/* Product List */}
        {farmstandProducts.length === 0 ? (
          <Animated.View entering={FadeInDown.delay(200)} className="items-center px-8 py-12">
            <View className="w-20 h-20 bg-gray-100 rounded-full items-center justify-center mb-4">
              <Package size={40} color="#9ca3af" />
            </View>
            <Text className="text-gray-900 font-bold text-lg text-center mb-2">No Products Yet</Text>
            <Text className="text-gray-500 text-center mb-6">
              Add your products so customers know what you have for sale
            </Text>
            <Pressable onPress={openAddModal} className="bg-forest px-6 py-3 rounded-xl flex-row items-center">
              <Plus size={18} color="white" />
              <Text className="text-white font-semibold ml-2">Add First Product</Text>
            </Pressable>
          </Animated.View>
        ) : (
          <View className="px-4">
            {farmstandProducts
              .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
              .map((product, index) => (
              <Animated.View
                key={product.id}
                entering={SlideInRight.delay(index * 50)}
                className="mb-4"
              >
                <Pressable
                  onPress={() => openEditModal(product)}
                  className="bg-white rounded-2xl overflow-hidden"
                  style={{
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.08,
                    shadowRadius: 12,
                    elevation: 3,
                  }}
                >
                  {/* Product Image - Full width on top */}
                  {product.photo_url ? (
                    <Image
                      source={{ uri: product.photo_url }}
                      className="w-full h-40"
                      resizeMode="cover"
                    />
                  ) : (
                    <View className="w-full h-32 bg-gray-100 items-center justify-center">
                      <Package size={40} color="#d1d5db" />
                      <Text className="text-gray-400 text-sm mt-2">No photo</Text>
                    </View>
                  )}

                  {/* Stock Badge - Absolute positioned on image */}
                  <View
                    className={`absolute top-3 left-3 px-3 py-1.5 rounded-full flex-row items-center ${
                      product.is_in_stock ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  >
                    {product.is_in_stock ? (
                      <>
                        <CheckCircle size={12} color="white" />
                        <Text className="text-white font-semibold text-xs ml-1">In Stock</Text>
                      </>
                    ) : (
                      <>
                        <XCircle size={12} color="white" />
                        <Text className="text-white font-semibold text-xs ml-1">Out of Stock</Text>
                      </>
                    )}
                  </View>

                  {/* Content */}
                  <View className="p-4">
                    {/* Title and Price Row */}
                    <View className="flex-row items-start justify-between mb-1">
                      <View className="flex-1 mr-3">
                        <Text className="text-gray-900 font-bold text-lg" numberOfLines={1}>
                          {product.name}
                        </Text>
                      </View>
                      <View className="items-end">
                        <Text className="text-forest font-bold text-xl">
                          ${product.price.toFixed(2)}
                        </Text>
                        <Text className="text-gray-400 text-xs">per {product.unit}</Text>
                      </View>
                    </View>

                    {/* Category */}
                    <Text className="text-gray-500 text-sm mb-2">
                      {PRODUCT_CATEGORY_LABELS[product.category]}
                    </Text>

                    {/* Description */}
                    {product.description && (
                      <Text className="text-gray-600 text-sm leading-5 mb-2" numberOfLines={2}>
                        {product.description}
                      </Text>
                    )}

                    {/* Stock Note */}
                    {product.stock_note && (
                      <View className="bg-amber-50 rounded-lg px-3 py-2 mb-2">
                        <Text className="text-amber-700 text-xs">{product.stock_note}</Text>
                      </View>
                    )}

                    {/* Bottom Actions */}
                    <View className="flex-row items-center justify-between pt-3 border-t border-gray-100 mt-2">
                      {/* Toggle Stock Button */}
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          handleToggleStock(product);
                        }}
                        className={`flex-row items-center px-3 py-2 rounded-xl ${
                          product.is_in_stock ? 'bg-red-50' : 'bg-green-50'
                        }`}
                      >
                        {product.is_in_stock ? (
                          <>
                            <XCircle size={14} color="#ef4444" />
                            <Text className="text-red-600 font-medium text-xs ml-1.5">Mark Out</Text>
                          </>
                        ) : (
                          <>
                            <CheckCircle size={14} color="#16a34a" />
                            <Text className="text-green-600 font-medium text-xs ml-1.5">Mark In Stock</Text>
                          </>
                        )}
                      </Pressable>

                      {/* Edit and Delete */}
                      <View className="flex-row items-center">
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            handleDeleteProduct(product);
                          }}
                          className="p-2 mr-1"
                        >
                          <Trash2 size={18} color="#ef4444" />
                        </Pressable>
                        <View className="flex-row items-center">
                          <Text className="text-gray-400 text-sm mr-1">Edit</Text>
                          <ChevronRight size={18} color="#9ca3af" />
                        </View>
                      </View>
                    </View>
                  </View>
                </Pressable>
              </Animated.View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Floating Add Button */}
      {farmstandProducts.length > 0 && (
        <SafeAreaView edges={['bottom']} className="absolute bottom-0 left-0 right-0 px-4 pb-4 bg-transparent">
          <Pressable
            onPress={openAddModal}
            className="bg-forest py-4 rounded-xl flex-row items-center justify-center shadow-lg"
          >
            <Plus size={20} color="white" />
            <Text className="text-white font-semibold text-base ml-2">Add Product</Text>
          </Pressable>
        </SafeAreaView>
      )}

      {/* Add/Edit Product Modal */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="flex-1"
        >
          <SafeAreaView edges={['top']} className="bg-white flex-1">
            <View className="flex-row items-center justify-between px-5 py-4 border-b border-gray-100">
              <Pressable onPress={closeModal} className="p-2 -ml-2">
                <X size={24} color="#6b7280" />
              </Pressable>
              <Text className="text-lg font-semibold text-gray-900">
                {editingProduct ? 'Edit Product' : 'Add Product'}
              </Text>
              <Pressable onPress={handleSaveProduct} disabled={isSaving} className="p-2 -mr-2">
                {isSaving ? (
                  <ActivityIndicator size="small" color="#2D5A3D" />
                ) : (
                  <Check size={24} color="#2D5A3D" />
                )}
              </Pressable>
            </View>

            <ScrollView
              className="flex-1"
              contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={true}
            >
            {/* Photo */}
            <Pressable
              onPress={() => setShowPhotoOptions(true)}
              className="items-center mb-6"
            >
              {formData.photo_url ? (
                <View className="relative">
                  <Image
                    source={{ uri: formData.photo_url }}
                    className="w-32 h-32 rounded-2xl"
                    resizeMode="cover"
                  />
                  <Pressable
                    onPress={() => updateField('photo_url', '')}
                    className="absolute -top-2 -right-2 w-8 h-8 bg-red-500 rounded-full items-center justify-center"
                  >
                    <X size={16} color="white" />
                  </Pressable>
                </View>
              ) : (
                <View className="w-32 h-32 rounded-2xl bg-gray-100 items-center justify-center border-2 border-dashed border-gray-300">
                  <ImagePlus size={32} color="#9ca3af" />
                  <Text className="text-gray-500 text-sm mt-2">Add Photo</Text>
                </View>
              )}
            </Pressable>

            {/* Name */}
            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-2">Product Name *</Text>
              <TextInput
                value={formData.name}
                onChangeText={(v) => updateField('name', v)}
                placeholder="e.g., Fresh Strawberries"
                placeholderTextColor="#9ca3af"
                className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900"
              />
            </View>

            {/* Category */}
            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-2">Category</Text>
              <Pressable
                onPress={() => setShowCategoryPicker(true)}
                className="flex-row items-center justify-between bg-gray-100 rounded-xl px-4 py-3"
              >
                <View className="flex-row items-center">
                  <Tag size={18} color="#6b7280" />
                  <Text className="text-gray-900 ml-2">{PRODUCT_CATEGORY_LABELS[formData.category]}</Text>
                </View>
                <ChevronDown size={20} color="#6b7280" />
              </Pressable>
            </View>

            {/* Price and Unit */}
            <View className="flex-row mb-4">
              <View className="flex-1 mr-2">
                <Text className="text-sm font-medium text-gray-700 mb-2">Price *</Text>
                <View className="flex-row items-center bg-gray-100 rounded-xl px-4 py-3">
                  <DollarSign size={18} color="#6b7280" />
                  <TextInput
                    value={formData.price}
                    onChangeText={(v) => updateField('price', v)}
                    placeholder="0.00"
                    placeholderTextColor="#9ca3af"
                    keyboardType="decimal-pad"
                    className="flex-1 text-base text-gray-900 ml-1"
                  />
                </View>
              </View>
              <View className="flex-1 ml-2">
                <Text className="text-sm font-medium text-gray-700 mb-2">Unit</Text>
                <Pressable
                  onPress={() => setShowUnitPicker(true)}
                  className="flex-row items-center justify-between bg-gray-100 rounded-xl px-4 py-3"
                >
                  <Text className="text-gray-900">per {formData.unit}</Text>
                  <ChevronDown size={20} color="#6b7280" />
                </Pressable>
              </View>
            </View>

            {/* Description */}
            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-2">Description</Text>
              <TextInput
                value={formData.description}
                onChangeText={(v) => updateField('description', v)}
                placeholder="Tell customers about this product..."
                placeholderTextColor="#9ca3af"
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900 min-h-[80px]"
              />
            </View>

            {/* In Stock Toggle */}
            <View className="flex-row items-center justify-between bg-gray-100 rounded-xl px-4 py-3 mb-4">
              <View className="flex-row items-center">
                <View
                  className={`w-8 h-8 rounded-full items-center justify-center ${
                    formData.is_in_stock ? 'bg-green-100' : 'bg-red-100'
                  }`}
                >
                  {formData.is_in_stock ? (
                    <CheckCircle size={18} color="#16a34a" />
                  ) : (
                    <XCircle size={18} color="#ef4444" />
                  )}
                </View>
                <Text className="text-gray-900 font-medium ml-3">
                  {formData.is_in_stock ? 'In Stock' : 'Out of Stock'}
                </Text>
              </View>
              <Switch
                value={formData.is_in_stock}
                onValueChange={(v) => updateField('is_in_stock', v)}
                trackColor={{ false: '#fca5a5', true: '#86efac' }}
                thumbColor={formData.is_in_stock ? '#16a34a' : '#ef4444'}
              />
            </View>

            {/* Stock Note */}
            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-2">Stock Note (optional)</Text>
              <TextInput
                value={formData.stock_note}
                onChangeText={(v) => updateField('stock_note', v)}
                placeholder="e.g., 'Limited supply' or 'Back next week'"
                placeholderTextColor="#9ca3af"
                className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900"
              />
            </View>

            {/* Seasonal */}
            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-2">Seasonal Availability (optional)</Text>
              <TextInput
                value={formData.seasonal}
                onChangeText={(v) => updateField('seasonal', v)}
                placeholder="e.g., 'June - September'"
                placeholderTextColor="#9ca3af"
                className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900"
              />
            </View>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>

        {/* Category Picker Modal */}
        <Modal visible={showCategoryPicker} transparent animationType="fade">
          <Pressable
            className="flex-1 bg-black/50 justify-end"
            onPress={() => setShowCategoryPicker(false)}
          >
            <View className="bg-white rounded-t-3xl pt-2 pb-8 max-h-[60%]">
              <View className="w-10 h-1 bg-gray-300 rounded-full self-center mb-4" />
              <Text className="text-lg font-semibold text-gray-900 px-5 mb-3">Select Category</Text>
              <ScrollView>
                {CATEGORY_OPTIONS.map((cat) => (
                  <Pressable
                    key={cat.id}
                    onPress={() => {
                      updateField('category', cat.id);
                      setShowCategoryPicker(false);
                    }}
                    className="flex-row items-center px-5 py-4 active:bg-gray-50"
                  >
                    <Text className="text-base text-gray-700 flex-1">{cat.label}</Text>
                    {formData.category === cat.id && (
                      <CheckCircle size={20} color="#2D5A3D" />
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </Pressable>
        </Modal>

        {/* Unit Picker Modal */}
        <Modal visible={showUnitPicker} transparent animationType="fade">
          <Pressable
            className="flex-1 bg-black/50 justify-end"
            onPress={() => setShowUnitPicker(false)}
          >
            <View className="bg-white rounded-t-3xl pt-2 pb-8 max-h-[60%]">
              <View className="w-10 h-1 bg-gray-300 rounded-full self-center mb-4" />
              <Text className="text-lg font-semibold text-gray-900 px-5 mb-3">Select Unit</Text>
              <ScrollView>
                {UNIT_OPTIONS.map((unit) => (
                  <Pressable
                    key={unit.id}
                    onPress={() => {
                      updateField('unit', unit.id);
                      setShowUnitPicker(false);
                    }}
                    className="flex-row items-center px-5 py-4 active:bg-gray-50"
                  >
                    <Text className="text-base text-gray-700 flex-1">per {unit.label}</Text>
                    {formData.unit === unit.id && (
                      <CheckCircle size={20} color="#2D5A3D" />
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </Pressable>
        </Modal>

        {/* Photo Options Modal */}
        <Modal visible={showPhotoOptions} transparent animationType="fade">
          <Pressable
            className="flex-1 bg-black/50 justify-end"
            onPress={() => setShowPhotoOptions(false)}
          >
            <Animated.View entering={FadeIn} className="bg-white rounded-t-3xl pt-2 pb-8">
              <View className="w-10 h-1 bg-gray-300 rounded-full self-center mb-4" />
              <Text className="text-lg font-semibold text-gray-900 px-5 mb-4">Add Photo</Text>

              <Pressable onPress={takePhoto} className="flex-row items-center px-5 py-4 active:bg-gray-50">
                <View className="w-10 h-10 bg-green-100 rounded-full items-center justify-center">
                  <Camera size={20} color="#16a34a" />
                </View>
                <Text className="text-gray-900 font-medium ml-4">Take Photo</Text>
              </Pressable>

              <Pressable onPress={pickImage} className="flex-row items-center px-5 py-4 active:bg-gray-50">
                <View className="w-10 h-10 bg-green-100 rounded-full items-center justify-center">
                  <ImagePlus size={20} color="#16a34a" />
                </View>
                <Text className="text-gray-900 font-medium ml-4">Choose from Library</Text>
              </Pressable>

              <Pressable
                onPress={() => setShowPhotoOptions(false)}
                className="mx-5 mt-4 py-3 bg-gray-100 rounded-xl items-center"
              >
                <Text className="text-gray-600 font-semibold">Cancel</Text>
              </Pressable>
            </Animated.View>
          </Pressable>
        </Modal>
      </Modal>
    </View>
  );
}
