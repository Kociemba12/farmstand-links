import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Switch,
  Alert,
  ActivityIndicator,
  Image,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Plus, Edit2, Trash2, X, Package } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFarmerStore, Product } from '@/lib/farmer-store';
import * as Haptics from 'expo-haptics';

const PRODUCT_CATEGORIES = [
  'produce',
  'eggs',
  'baked_goods',
  'dairy',
  'meat',
  'honey',
  'flowers',
  'preserves',
  'soaps',
];

const UNITS = ['each', 'lb', 'oz', 'dozen', 'bunch', 'pint', 'quart', 'gallon'];

export default function ManageProductsScreen() {
  const router = useRouter();
  const { farmstandId } = useLocalSearchParams<{ farmstandId: string }>();

  const getProductsByFarmstand = useFarmerStore((s) => s.getProductsByFarmstand);
  const addProduct = useFarmerStore((s) => s.addProduct);
  const updateProduct = useFarmerStore((s) => s.updateProduct);
  const deleteProduct = useFarmerStore((s) => s.deleteProduct);

  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCategory, setFormCategory] = useState('produce');
  const [formPrice, setFormPrice] = useState('');
  const [formUnit, setFormUnit] = useState('each');
  const [formInStock, setFormInStock] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadProducts();
  }, [farmstandId]);

  const loadProducts = () => {
    if (farmstandId) {
      const data = getProductsByFarmstand(farmstandId);
      setProducts(data);
      setIsLoading(false);
    }
  };

  const handleBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  const openAddModal = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingProduct(null);
    setFormName('');
    setFormDescription('');
    setFormCategory('produce');
    setFormPrice('');
    setFormUnit('each');
    setFormInStock(true);
    setModalVisible(true);
  };

  const openEditModal = async (product: Product) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingProduct(product);
    setFormName(product.name);
    setFormDescription(product.description);
    setFormCategory(product.category);
    setFormPrice(product.price.toString());
    setFormUnit(product.unit);
    setFormInStock(product.inStock);
    setModalVisible(true);
  };

  const handleToggleStock = async (product: Product) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await updateProduct(product.id, { inStock: !product.inStock });
    loadProducts();
  };

  const handleDeleteProduct = async (product: Product) => {
    Alert.alert(
      'Delete Product',
      `Are you sure you want to delete "${product.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            await deleteProduct(product.id);
            loadProducts();
          },
        },
      ]
    );
  };

  const handleSaveProduct = async () => {
    if (!formName.trim()) {
      Alert.alert('Required', 'Please enter a product name.');
      return;
    }

    const price = parseFloat(formPrice);
    if (isNaN(price) || price < 0) {
      Alert.alert('Invalid Price', 'Please enter a valid price.');
      return;
    }

    setIsSaving(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      if (editingProduct) {
        await updateProduct(editingProduct.id, {
          name: formName.trim(),
          description: formDescription.trim(),
          category: formCategory,
          price,
          unit: formUnit,
          inStock: formInStock,
        });
      } else {
        await addProduct({
          farmstandId: farmstandId!,
          name: formName.trim(),
          description: formDescription.trim(),
          category: formCategory,
          price,
          unit: formUnit,
          inStock: formInStock,
          photos: [],
        });
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModalVisible(false);
      loadProducts();
    } catch (error) {
      Alert.alert('Error', 'Failed to save product. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#2D5A3D" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-cream">
      <SafeAreaView edges={['top']} className="bg-forest">
        <View className="flex-row items-center justify-between px-4 py-4">
          <Pressable onPress={handleBack} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#FDF8F3" />
          </Pressable>
          <Text className="text-cream text-xl font-bold">Manage Products</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="px-5 py-6">
          {products.length === 0 ? (
            <View className="bg-white rounded-2xl p-8 border border-sand items-center">
              <Package size={48} color="#C4B5A4" />
              <Text className="text-charcoal font-bold text-lg mt-4">No Products Yet</Text>
              <Text className="text-wood text-center mt-2 mb-4">
                Add your first product to start showcasing what you sell.
              </Text>
              <Pressable
                onPress={openAddModal}
                className="bg-forest px-6 py-3 rounded-xl"
              >
                <Text className="text-cream font-semibold">Add Product</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text className="text-wood mb-4">{products.length} products</Text>
              {products.map((product) => (
                <View
                  key={product.id}
                  className="bg-white rounded-2xl p-4 border border-sand mb-4"
                >
                  <View className="flex-row">
                    {product.photos[0] ? (
                      <Image
                        source={{ uri: product.photos[0] }}
                        className="w-16 h-16 rounded-xl"
                      />
                    ) : (
                      <View className="w-16 h-16 rounded-xl bg-sand items-center justify-center">
                        <Package size={24} color="#8B6F4E" />
                      </View>
                    )}
                    <View className="ml-3 flex-1">
                      <Text className="text-charcoal font-semibold">{product.name}</Text>
                      <Text className="text-wood text-sm" numberOfLines={1}>
                        {product.description || 'No description'}
                      </Text>
                      <View className="flex-row items-center mt-1">
                        <Text className="text-forest font-bold">
                          ${product.price.toFixed(2)}
                        </Text>
                        <Text className="text-wood text-sm ml-1">/ {product.unit}</Text>
                        <View
                          className={`ml-3 px-2 py-0.5 rounded-full ${
                            product.inStock ? 'bg-mint/20' : 'bg-terracotta/10'
                          }`}
                        >
                          <Text
                            className={`text-xs font-medium ${
                              product.inStock ? 'text-forest' : 'text-terracotta'
                            }`}
                          >
                            {product.inStock ? 'In Stock' : 'Out of Stock'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  <View className="flex-row mt-4 pt-4 border-t border-sand">
                    <Pressable
                      onPress={() => handleToggleStock(product)}
                      className="flex-1 flex-row items-center justify-center py-2"
                    >
                      <Switch
                        value={product.inStock}
                        onValueChange={() => handleToggleStock(product)}
                        trackColor={{ false: '#C4B5A4', true: '#7FB069' }}
                        thumbColor="#FDF8F3"
                        style={{ transform: [{ scale: 0.8 }] }}
                      />
                      <Text className="text-wood text-sm ml-1">In Stock</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => openEditModal(product)}
                      className="flex-1 flex-row items-center justify-center py-2"
                    >
                      <Edit2 size={16} color="#2D5A3D" />
                      <Text className="text-forest font-medium ml-1">Edit</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleDeleteProduct(product)}
                      className="flex-1 flex-row items-center justify-center py-2"
                    >
                      <Trash2 size={16} color="#C4653A" />
                      <Text className="text-terracotta font-medium ml-1">Delete</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </>
          )}
        </View>
      </ScrollView>

      {/* Add/Edit Product Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModalVisible(false)}
      >
        <SafeAreaView className="flex-1 bg-cream">
          <View className="flex-row items-center justify-between px-4 py-4 border-b border-sand">
            <Pressable onPress={() => setModalVisible(false)} className="p-2 -ml-2">
              <X size={24} color="#2D5A3D" />
            </Pressable>
            <Text className="text-charcoal text-xl font-bold">
              {editingProduct ? 'Edit Product' : 'Add Product'}
            </Text>
            <View className="w-10" />
          </View>

          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            <View className="px-5 py-6">
              <View className="mb-4">
                <Text className="text-charcoal font-medium mb-2">Product Name *</Text>
                <TextInput
                  className="bg-white rounded-xl px-4 py-3 text-charcoal border border-sand"
                  value={formName}
                  onChangeText={setFormName}
                  placeholder="e.g., Organic Strawberries"
                  placeholderTextColor="#8B6F4E"
                />
              </View>

              <View className="mb-4">
                <Text className="text-charcoal font-medium mb-2">Description</Text>
                <TextInput
                  className="bg-white rounded-xl px-4 py-3 text-charcoal border border-sand min-h-[80px]"
                  value={formDescription}
                  onChangeText={setFormDescription}
                  placeholder="Describe your product..."
                  placeholderTextColor="#8B6F4E"
                  multiline
                  textAlignVertical="top"
                />
              </View>

              <View className="mb-4">
                <Text className="text-charcoal font-medium mb-2">Category</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  nestedScrollEnabled={true}
                  style={{ flexGrow: 0 }}
                >
                  {PRODUCT_CATEGORIES.map((cat) => (
                    <Pressable
                      key={cat}
                      onPress={() => setFormCategory(cat)}
                      className={`px-4 py-2 rounded-full mr-2 ${
                        formCategory === cat
                          ? 'bg-forest'
                          : 'bg-white border border-sand'
                      }`}
                    >
                      <Text
                        className={
                          formCategory === cat ? 'text-cream font-medium' : 'text-charcoal'
                        }
                      >
                        {cat.replace('_', ' ')}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              <View className="flex-row mb-4">
                <View className="flex-1 mr-2">
                  <Text className="text-charcoal font-medium mb-2">Price *</Text>
                  <TextInput
                    className="bg-white rounded-xl px-4 py-3 text-charcoal border border-sand"
                    value={formPrice}
                    onChangeText={setFormPrice}
                    placeholder="0.00"
                    placeholderTextColor="#8B6F4E"
                    keyboardType="decimal-pad"
                  />
                </View>
                <View className="flex-1 ml-2">
                  <Text className="text-charcoal font-medium mb-2">Unit</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    nestedScrollEnabled={true}
                    style={{ flexGrow: 0 }}
                  >
                    {UNITS.map((unit) => (
                      <Pressable
                        key={unit}
                        onPress={() => setFormUnit(unit)}
                        className={`px-3 py-2 rounded-lg mr-1 ${
                          formUnit === unit
                            ? 'bg-forest'
                            : 'bg-white border border-sand'
                        }`}
                      >
                        <Text
                          className={
                            formUnit === unit ? 'text-cream text-sm' : 'text-charcoal text-sm'
                          }
                        >
                          {unit}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              </View>

              <View className="bg-white rounded-xl p-4 border border-sand">
                <View className="flex-row items-center justify-between">
                  <View>
                    <Text className="text-charcoal font-medium">In Stock</Text>
                    <Text className="text-wood text-sm">
                      {formInStock ? 'Available for purchase' : 'Currently unavailable'}
                    </Text>
                  </View>
                  <Switch
                    value={formInStock}
                    onValueChange={setFormInStock}
                    trackColor={{ false: '#C4B5A4', true: '#7FB069' }}
                    thumbColor="#FDF8F3"
                  />
                </View>
              </View>
            </View>
          </ScrollView>

          <SafeAreaView edges={['bottom']} className="bg-cream border-t border-sand">
            <View className="px-5 py-4">
              <Pressable
                onPress={handleSaveProduct}
                disabled={isSaving}
                className={`py-4 rounded-xl items-center ${
                  isSaving ? 'bg-sand' : 'bg-forest'
                }`}
              >
                {isSaving ? (
                  <ActivityIndicator color="#FDF8F3" />
                ) : (
                  <Text className="text-cream font-semibold text-lg">
                    {editingProduct ? 'Save Changes' : 'Add Product'}
                  </Text>
                )}
              </Pressable>
            </View>
          </SafeAreaView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
