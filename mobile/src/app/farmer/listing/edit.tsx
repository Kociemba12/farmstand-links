import React, { useEffect, useState, useRef } from 'react';
import NetInfo from '@react-native-community/netinfo';
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
import { ArrowLeft, Camera, X, Plus, Star, Check, ImagePlus, ChevronDown, RefreshCw } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFarmerStore, Farmstand } from '@/lib/farmer-store';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import { formatPhoneNumber, getPhoneDigits } from '@/lib/phone-utils';
import { uploadToSupabaseStorage, isSupabaseConfigured } from '@/lib/supabase';
import { compressImage } from '@/lib/compress-image';
import {
  addToQueue,
  removeFromQueue,
  getQueueForFarmstand,
  incrementAttempts,
} from '@/lib/photo-upload-queue';

const PRODUCT_CATEGORIES = [
  'Fruits',
  'Vegetables',
  'Eggs',
  'Dairy',
  'Meat',
  'Honey',
  'Flowers',
  'Baked Goods',
  'Preserves',
  'Herbs',
];

const CATEGORIES = [
  { id: 'produce', label: 'Produce' },
  { id: 'eggs', label: 'Eggs' },
  { id: 'baked_goods', label: 'Baked Goods' },
  { id: 'dairy', label: 'Dairy' },
  { id: 'meat', label: 'Meat' },
  { id: 'honey', label: 'Honey' },
  { id: 'flowers', label: 'Flowers' },
  { id: 'preserves', label: 'Preserves' },
  { id: 'soaps', label: 'Soaps & Crafts' },
];

// Main product options for AI image generation
const MAIN_PRODUCT_OPTIONS = [
  { id: 'eggs', label: 'Eggs' },
  { id: 'honey', label: 'Honey' },
  { id: 'flowers', label: 'Flowers' },
  { id: 'produce', label: 'Produce' },
  { id: 'beef', label: 'Beef' },
  { id: 'pork', label: 'Pork' },
  { id: 'chicken', label: 'Chicken' },
  { id: 'dairy', label: 'Dairy' },
  { id: 'fruit', label: 'Fruit' },
  { id: 'veggies', label: 'Vegetables' },
  { id: 'baked_goods', label: 'Baked Goods' },
  { id: 'jams', label: 'Jams & Preserves' },
  { id: 'crafts', label: 'Crafts' },
  { id: 'plants', label: 'Plants & Seedlings' },
  { id: 'u_pick', label: 'U-Pick' },
  { id: 'pumpkins', label: 'Pumpkins' },
  { id: 'christmas_trees', label: 'Christmas Trees' },
  { id: 'other', label: 'Other' },
];

export default function EditListingScreen() {
  const router = useRouter();
  const { farmstandId } = useLocalSearchParams<{ farmstandId: string }>();

  const getFarmstandById = useFarmerStore((s) => s.getFarmstandById);
  const updateFarmstand = useFarmerStore((s) => s.updateFarmstand);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [farmstand, setFarmstand] = useState<Farmstand | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [description, setDescription] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [mainPhotoIndex, setMainPhotoIndex] = useState(0);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [showPhotoOptions, setShowPhotoOptions] = useState(false);
  const [mainProduct, setMainProduct] = useState<string | null>(null);
  const [showMainProductPicker, setShowMainProductPicker] = useState(false);
  const [selectedProductCategories, setSelectedProductCategories] = useState<string[]>([]);
  const [otherProductItems, setOtherProductItems] = useState<string[]>([]);
  const [otherProductInput, setOtherProductInput] = useState('');

  // Pending local photos — shown immediately while uploading or queued for retry
  interface LocalPhotoItem {
    tempId: string;
    localUri: string;
    uploading: boolean;
    pendingUpload: boolean;
  }
  const [pendingPhotos, setPendingPhotos] = useState<LocalPhotoItem[]>([]);

  useEffect(() => {
    if (farmstandId) {
      const data = getFarmstandById(farmstandId);
      if (data) {
        setFarmstand(data);
        setName(data.name);
        setShortDescription(data.shortDescription);
        setDescription(data.description);
        setCategories(data.categories);
        setPhotos(data.photos);
        setMainPhotoIndex(data.mainPhotoIndex ?? 0);
        setPhone(data.phone || '');
        setEmail(data.email || '');
        setIsActive(data.isActive);
        setMainProduct(data.mainProduct || null);
        console.log('[EditListing] Loaded mainProduct:', data.mainProduct);

        // Initialize product categories and other products from offerings
        const existingProductCats = (data.offerings || []).filter((o: string) =>
          PRODUCT_CATEGORIES.includes(o)
        );
        setSelectedProductCategories(existingProductCats);
        setOtherProductItems(data.otherProducts || []);
      }
      setIsLoading(false);

      // Restore any pending uploads from queue (survives app restarts)
      getQueueForFarmstand(farmstandId).then((pending) => {
        if (pending.length > 0) {
          console.log('[FarmerListingEdit] Restoring', pending.length, 'pending uploads');
          setPendingPhotos(
            pending.map((q) => ({
              tempId: q.tempId,
              localUri: q.localUri,
              uploading: false,
              pendingUpload: true,
            }))
          );
        }
      });
    }
  }, [farmstandId, getFarmstandById]);

  // Refs so the NetInfo listener always sees current state without stale closures
  const pendingPhotosRef = useRef<LocalPhotoItem[]>([]);
  useEffect(() => {
    pendingPhotosRef.current = pendingPhotos;
  }, [pendingPhotos]);

  const retryPendingRef = useRef<(item: LocalPhotoItem) => void>(() => {});
  useEffect(() => {
    retryPendingRef.current = retryPendingPhoto;
  });

  // Auto-retry pending uploads when connection is restored
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        const pending = pendingPhotosRef.current.filter((p) => p.pendingUpload && !p.uploading);
        if (pending.length > 0) {
          console.log('[FarmerListingEdit] Connection restored, retrying', pending.length, 'uploads');
          pending.forEach((item) => retryPendingRef.current(item));
        }
      }
    });
    return () => unsubscribe();
  }, []);

  const handleBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  const toggleCategory = async (categoryId: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCategories((prev) =>
      prev.includes(categoryId)
        ? prev.filter((c) => c !== categoryId)
        : [...prev, categoryId]
    );
  };

  const toggleProductCategory = async (category: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedProductCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
  };

  const addOtherProductItem = async () => {
    const trimmed = otherProductInput.trim();
    if (!trimmed) return;
    const isDuplicate = otherProductItems.some(
      (p) => p.toLowerCase() === trimmed.toLowerCase()
    );
    if (isDuplicate) {
      Alert.alert('Duplicate', 'This product has already been added.');
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOtherProductItems((prev) => [...prev, trimmed]);
    setOtherProductInput('');
  };

  const removeOtherProductItem = async (product: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOtherProductItems((prev) => prev.filter((p) => p !== product));
  };

  const removePhoto = async (index: number) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    // Adjust mainPhotoIndex if needed
    if (index === mainPhotoIndex) {
      setMainPhotoIndex(0);
    } else if (index < mainPhotoIndex) {
      setMainPhotoIndex((prev) => prev - 1);
    }
  };

  const setAsMainPhoto = async (index: number) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMainPhotoIndex(index);
  };

  const addPhoto = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowPhotoOptions(true);
  };

  /**
   * Show the photo immediately, compress and upload in background.
   * If upload fails, persist to queue and retry automatically when connection returns.
   */
  const startLocalUpload = (localUri: string) => {
    if (!farmstandId || !isSupabaseConfigured()) {
      console.error('[FarmerListingEdit] Cannot upload: Supabase not configured or no farmstandId');
      return;
    }

    const tempId = `temp-${Date.now()}`;
    // Pre-compute path so retries reuse it (prevents duplicate uploads)
    const storagePath = `${farmstandId}/${Date.now()}.jpg`;

    setPendingPhotos((prev) => [...prev, { tempId, localUri, uploading: true, pendingUpload: false }]);
    console.log('[FarmerListingEdit] Photo selected, compressing and uploading:', localUri);

    compressImage(localUri)
      .then((compressedUri) => {
        console.log('[FarmerListingEdit] Compressed, uploading to:', storagePath);
        return uploadToSupabaseStorage('farmstand-photos', storagePath, compressedUri, 'image/jpeg');
      })
      .then(async ({ url: uploadedUrl, error: uploadError }) => {
        if (uploadError || !uploadedUrl || !uploadedUrl.startsWith('http')) {
          throw new Error(uploadError?.message || 'Upload failed');
        }
        console.log('[FarmerListingEdit] Upload succeeded:', uploadedUrl);
        setPendingPhotos((prev) => prev.filter((p) => p.tempId !== tempId));
        setPhotos((prev) => [...prev.filter((p) => p.startsWith('http')), uploadedUrl]);
        await removeFromQueue(tempId);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      })
      .catch(async (err) => {
        console.error('[FarmerListingEdit] Upload failed, queuing for retry:', err);
        await addToQueue({
          tempId,
          localUri,
          farmstandId: farmstandId!,
          storagePath,
          bucket: 'farmstand-photos',
          addedAt: Date.now(),
          attempts: 1,
        });
        setPendingPhotos((prev) =>
          prev.map((p) => p.tempId === tempId ? { ...p, uploading: false, pendingUpload: true } : p)
        );
      });
  };

  const retryPendingPhoto = async (item: LocalPhotoItem) => {
    setPendingPhotos((prev) =>
      prev.map((p) => p.tempId === item.tempId ? { ...p, uploading: true, pendingUpload: false } : p)
    );

    const queueItems = await getQueueForFarmstand(farmstandId!);
    const queueItem = queueItems.find((q) => q.tempId === item.tempId);
    const storagePath = queueItem?.storagePath || `${farmstandId}/${Date.now()}.jpg`;

    console.log('[FarmerListingEdit] Retrying upload:', item.tempId);

    compressImage(item.localUri)
      .then((compressedUri) =>
        uploadToSupabaseStorage('farmstand-photos', storagePath, compressedUri, 'image/jpeg')
      )
      .then(async ({ url: uploadedUrl, error: uploadError }) => {
        if (uploadError || !uploadedUrl || !uploadedUrl.startsWith('http')) {
          throw new Error(uploadError?.message || 'Upload failed');
        }
        console.log('[FarmerListingEdit] Retry succeeded:', uploadedUrl);
        setPendingPhotos((prev) => prev.filter((p) => p.tempId !== item.tempId));
        setPhotos((prev) => [...prev.filter((p) => p.startsWith('http')), uploadedUrl]);
        await removeFromQueue(item.tempId);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      })
      .catch(async (err) => {
        console.error('[FarmerListingEdit] Retry failed:', err);
        await incrementAttempts(item.tempId);
        setPendingPhotos((prev) =>
          prev.map((p) => p.tempId === item.tempId ? { ...p, uploading: false, pendingUpload: true } : p)
        );
      });
  };

  const removePendingPhoto = async (tempId: string) => {
    setPendingPhotos((prev) => prev.filter((p) => p.tempId !== tempId));
    await removeFromQueue(tempId);
  };

  const pickImageFromLibrary = async () => {
    setShowPhotoOptions(false);

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your photo library to add images.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      startLocalUpload(result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    setShowPhotoOptions(false);

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your camera to take photos.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      startLocalUpload(result.assets[0].uri);
    }
  };

  const addPhotoUrl = async () => {
    setShowPhotoOptions(false);
    Alert.prompt(
      'Add Photo URL',
      'Enter the URL of the image you want to add:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add',
          onPress: (url: string | undefined) => {
            if (url && url.trim()) {
              setPhotos((prev) => [...prev, url.trim()]);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
          },
        },
      ],
      'plain-text',
      '',
      'url'
    );
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Required', 'Please enter a name for your farm stand.');
      return;
    }

    setIsSaving(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      // Filter to only valid https URLs
      const validPhotos = photos.filter(p => p.startsWith('http'));
      // Set hero_image_url to the main photo
      const mainPhotoUrl = validPhotos[mainPhotoIndex] ?? validPhotos[0] ?? null;

      console.log('[FarmerListingEdit] Saving with validPhotos:', validPhotos.length);
      console.log('[FarmerListingEdit] Setting heroImageUrl to:', mainPhotoUrl);
      console.log('[FarmerListingEdit] Selected mainProduct:', mainProduct);

      await updateFarmstand(farmstandId!, {
        name: name.trim(),
        shortDescription: shortDescription.trim(),
        description: description.trim(),
        categories,
        photos: validPhotos,
        mainPhotoIndex,
        heroImageUrl: mainPhotoUrl,
        phone: phone.trim() || null,
        email: email.trim() || null,
        isActive,
        mainProduct,
        offerings: [...selectedProductCategories, ...otherProductItems],
        otherProducts: otherProductItems,
      });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', 'Your listing has been updated.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error) {
      Alert.alert('Error', 'Failed to save changes. Please try again.');
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

  if (!farmstand) {
    return (
      <View className="flex-1 bg-cream items-center justify-center px-6">
        <Text className="text-charcoal font-bold text-lg mb-2">Listing Not Found</Text>
        <Text className="text-wood text-center mb-4">
          We couldn't find this farm stand listing.
        </Text>
        <Pressable
          onPress={handleBack}
          className="bg-forest px-6 py-3 rounded-xl"
        >
          <Text className="text-cream font-semibold">Go Back</Text>
        </Pressable>
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
          <Text className="text-cream text-xl font-bold">Edit Listing</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="px-5 py-6">
          {/* Active Toggle */}
          <View className="bg-white rounded-2xl p-4 border border-sand mb-6">
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-charcoal font-semibold">Listing Active</Text>
                <Text className="text-wood text-sm">
                  {isActive ? 'Visible to customers' : 'Hidden from customers'}
                </Text>
              </View>
              <Switch
                value={isActive}
                onValueChange={setIsActive}
                trackColor={{ false: '#C4B5A4', true: '#7FB069' }}
                thumbColor="#FDF8F3"
              />
            </View>
          </View>

          {/* Basic Info */}
          <Text className="text-charcoal font-bold text-lg mb-3">Basic Info</Text>
          <View className="bg-white rounded-2xl p-4 border border-sand mb-6">
            <View className="mb-4">
              <Text className="text-charcoal font-medium mb-2">Farm Stand Name *</Text>
              <TextInput
                className="bg-cream rounded-xl px-4 py-3 text-charcoal border border-sand"
                value={name}
                onChangeText={setName}
                placeholder="Your farm stand name"
                placeholderTextColor="#8B6F4E"
              />
            </View>

            <View className="mb-4">
              <Text className="text-charcoal font-medium mb-2">Short Description</Text>
              <TextInput
                className="bg-cream rounded-xl px-4 py-3 text-charcoal border border-sand"
                value={shortDescription}
                onChangeText={setShortDescription}
                placeholder="A brief tagline"
                placeholderTextColor="#8B6F4E"
                maxLength={100}
              />
              <Text className="text-wood text-xs mt-1 text-right">
                {shortDescription.length}/100
              </Text>
            </View>

            <View>
              <Text className="text-charcoal font-medium mb-2">Full Description</Text>
              <TextInput
                className="bg-cream rounded-xl px-4 py-3 text-charcoal border border-sand min-h-[120px]"
                value={description}
                onChangeText={setDescription}
                placeholder="Tell customers about your farm..."
                placeholderTextColor="#8B6F4E"
                multiline
                textAlignVertical="top"
              />
            </View>
          </View>

          {/* Product Categories */}
          <View className="bg-white rounded-2xl p-4 border border-sand mb-6">
            <Text className="text-charcoal font-semibold text-base mb-1">
              Product Categories
            </Text>
            <Text className="text-wood text-sm mb-4">
              Select all that apply
            </Text>
            <View className="flex-row flex-wrap">
              {PRODUCT_CATEGORIES.map((category, index) => {
                const isSelected = selectedProductCategories.includes(category);
                return (
                  <Animated.View
                    key={category}
                    entering={FadeInUp.delay(index * 30).springify()}
                  >
                    <Pressable
                      onPress={() => toggleProductCategory(category)}
                      className={`px-4 py-3 rounded-full mr-2 mb-3 border-2 ${
                        isSelected ? 'bg-forest border-forest' : 'bg-white border-sand/60'
                      }`}
                      style={{
                        shadowColor: isSelected ? '#2D5A3D' : 'transparent',
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: isSelected ? 0.2 : 0,
                        shadowRadius: 4,
                        elevation: isSelected ? 3 : 0,
                      }}
                    >
                      <View className="flex-row items-center">
                        {isSelected && (
                          <Check size={14} color="#FDF8F3" style={{ marginRight: 6 }} />
                        )}
                        <Text
                          className={`font-medium ${
                            isSelected ? 'text-cream' : 'text-charcoal'
                          }`}
                        >
                          {category}
                        </Text>
                      </View>
                    </Pressable>
                  </Animated.View>
                );
              })}
            </View>
          </View>

          {/* Other Products */}
          <View className="bg-white rounded-2xl p-4 border border-sand mb-6">
            <Text className="text-charcoal font-semibold text-base mb-1">
              Other Products
            </Text>
            <Text className="text-wood text-sm mb-4">
              Add individual items not in categories above
            </Text>
            <View className="flex-row items-center mb-3">
              <TextInput
                className="flex-1 bg-cream rounded-xl px-4 py-3 text-charcoal border border-sand text-base"
                value={otherProductInput}
                onChangeText={setOtherProductInput}
                placeholder="e.g., Maple Syrup"
                placeholderTextColor="#8B6F4E"
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={addOtherProductItem}
              />
              <Pressable
                onPress={addOtherProductItem}
                disabled={!otherProductInput.trim()}
                className={`ml-3 w-12 h-12 rounded-xl items-center justify-center ${
                  otherProductInput.trim() ? 'bg-forest' : 'bg-sand/40'
                }`}
                style={{
                  shadowColor: otherProductInput.trim() ? '#2D5A3D' : 'transparent',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: otherProductInput.trim() ? 0.2 : 0,
                  shadowRadius: 4,
                  elevation: otherProductInput.trim() ? 3 : 0,
                }}
              >
                <Plus size={22} color={otherProductInput.trim() ? '#FDF8F3' : '#8B6F4E'} />
              </Pressable>
            </View>
            {(otherProductItems || []).length > 0 && (
              <View className="flex-row flex-wrap mt-2">
                {(otherProductItems || []).map((product, index) => (
                  <Animated.View
                    key={`${product}-${index}`}
                    entering={FadeInUp.delay(index * 30).springify()}
                  >
                    <Pressable
                      onPress={() => removeOtherProductItem(product)}
                      className="flex-row items-center px-4 py-2.5 rounded-full mr-2 mb-2 bg-terracotta/10 border border-terracotta/30"
                    >
                      <Text className="text-terracotta font-medium mr-2">{product}</Text>
                      <X size={14} color="#C45C3E" />
                    </Pressable>
                  </Animated.View>
                ))}
              </View>
            )}
          </View>

          {/* Photos */}
          <Text className="text-charcoal font-bold text-lg mb-2">Photos</Text>
          <Text className="text-wood text-sm mb-3">
            Tap a photo to set it as your main display image
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled={true}
            className="mb-6"
            style={{ flexGrow: 0 }}
          >
            {photos.map((photo, index) => (
              <Animated.View
                key={index}
                entering={FadeIn.delay(index * 50)}
                className="mr-3 relative"
              >
                <Pressable onPress={() => setAsMainPhoto(index)}>
                  <Image
                    source={{ uri: photo }}
                    className="w-28 h-28 rounded-xl"
                    resizeMode="cover"
                  />
                  {/* Main photo indicator */}
                  {index === mainPhotoIndex && (
                    <View className="absolute bottom-1 left-1 right-1 bg-forest/90 rounded-lg py-1 px-2 flex-row items-center justify-center">
                      <Star size={12} color="#FDF8F3" fill="#FDF8F3" />
                      <Text className="text-cream text-xs font-semibold ml-1">Main</Text>
                    </View>
                  )}
                  {/* Selection ring */}
                  {index === mainPhotoIndex && (
                    <View className="absolute inset-0 rounded-xl border-3 border-forest" style={{ borderWidth: 3 }} />
                  )}
                </Pressable>
                <Pressable
                  onPress={() => removePhoto(index)}
                  className="absolute -top-2 -right-2 w-7 h-7 bg-terracotta rounded-full items-center justify-center shadow-sm"
                >
                  <X size={16} color="#FDF8F3" />
                </Pressable>
              </Animated.View>
            ))}
            {/* Pending local uploads — shown immediately, upload in background */}
            {pendingPhotos.map((item) => (
              <Animated.View
                key={item.tempId}
                entering={FadeIn}
                className="mr-3 relative"
              >
                <Image
                  source={{ uri: item.localUri }}
                  className="w-28 h-28 rounded-xl"
                  resizeMode="cover"
                  style={{ opacity: item.uploading ? 0.6 : 0.8 }}
                />
                {item.uploading && (
                  <View className="absolute inset-0 rounded-xl items-center justify-center bg-black/30">
                    <ActivityIndicator size="small" color="#ffffff" />
                    <Text className="text-white text-[9px] mt-1 font-semibold">Uploading...</Text>
                  </View>
                )}
                {item.pendingUpload && !item.uploading && (
                  <Pressable
                    onPress={() => retryPendingPhoto(item)}
                    className="absolute inset-0 rounded-xl items-center justify-center bg-amber-900/40"
                  >
                    <RefreshCw size={16} color="#ffffff" />
                    <Text className="text-white text-[9px] mt-0.5 font-semibold">Pending</Text>
                  </Pressable>
                )}
                {!item.uploading && (
                  <Pressable
                    onPress={() => removePendingPhoto(item.tempId)}
                    className="absolute -top-2 -right-2 w-7 h-7 bg-terracotta rounded-full items-center justify-center shadow-sm"
                  >
                    <X size={16} color="#FDF8F3" />
                  </Pressable>
                )}
              </Animated.View>
            ))}
            <Pressable
              onPress={addPhoto}
              className="w-28 h-28 rounded-xl border-2 border-dashed border-sand items-center justify-center bg-white"
            >
              <ImagePlus size={28} color="#8B6F4E" />
              <Text className="text-wood text-xs mt-2 font-medium">Add Photo</Text>
            </Pressable>
          </ScrollView>

          {/* Categories */}
          <Text className="text-charcoal font-bold text-lg mb-3">Categories</Text>
          <View className="flex-row flex-wrap mb-6">
            {CATEGORIES.map((cat) => (
              <Pressable
                key={cat.id}
                onPress={() => toggleCategory(cat.id)}
                className={`px-4 py-2 rounded-full mr-2 mb-2 ${
                  categories.includes(cat.id)
                    ? 'bg-forest'
                    : 'bg-white border border-sand'
                }`}
              >
                <Text
                  className={
                    categories.includes(cat.id) ? 'text-cream font-medium' : 'text-charcoal'
                  }
                >
                  {cat.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Main Product - for AI image generation */}
          <Text className="text-charcoal font-bold text-lg mb-2">Main Product</Text>
          <Text className="text-wood text-sm mb-3">
            Select the main product you sell. This will be used to generate a unique AI image if you don't upload a photo.
          </Text>
          <Pressable
            onPress={() => setShowMainProductPicker(true)}
            className="bg-white rounded-2xl p-4 border border-sand mb-6 flex-row items-center justify-between"
          >
            <Text className={mainProduct ? 'text-charcoal font-medium' : 'text-wood'}>
              {mainProduct
                ? MAIN_PRODUCT_OPTIONS.find(p => p.id === mainProduct)?.label || mainProduct
                : 'Select main product...'}
            </Text>
            <ChevronDown size={20} color="#8B6F4E" />
          </Pressable>

          {/* Contact Info */}
          <Text className="text-charcoal font-bold text-lg mb-3">Contact Info</Text>
          <View className="bg-white rounded-2xl p-4 border border-sand mb-6">
            <View className="mb-4">
              <Text className="text-charcoal font-medium mb-2">Phone Number</Text>
              <TextInput
                className="bg-cream rounded-xl px-4 py-3 text-charcoal border border-sand"
                value={formatPhoneNumber(phone)}
                onChangeText={(v) => setPhone(getPhoneDigits(v))}
                placeholder="(555) 555-5555"
                placeholderTextColor="#8B6F4E"
                keyboardType="phone-pad"
                maxLength={14}
              />
            </View>

            <View>
              <Text className="text-charcoal font-medium mb-2">Email</Text>
              <TextInput
                className="bg-cream rounded-xl px-4 py-3 text-charcoal border border-sand"
                value={email}
                onChangeText={setEmail}
                placeholder="contact@yourfarm.com"
                placeholderTextColor="#8B6F4E"
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Save Button */}
      <SafeAreaView edges={['bottom']} className="bg-cream border-t border-sand">
        <View className="px-5 py-4">
          <Pressable
            onPress={handleSave}
            disabled={isSaving}
            className={`py-4 rounded-xl items-center ${
              isSaving ? 'bg-sand' : 'bg-forest'
            }`}
          >
            {isSaving ? (
              <ActivityIndicator color="#FDF8F3" />
            ) : (
              <Text className="text-cream font-semibold text-lg">Save Changes</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Photo Options Modal */}
      <Modal
        visible={showPhotoOptions}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPhotoOptions(false)}
      >
        <Pressable
          className="flex-1 bg-black/50 justify-end"
          onPress={() => setShowPhotoOptions(false)}
        >
          <Animated.View
            entering={FadeInDown.duration(200)}
            className="bg-white rounded-t-3xl pt-2 pb-8"
          >
            <View className="w-10 h-1 bg-sand rounded-full self-center mb-4" />
            <Text className="text-charcoal font-bold text-lg px-5 mb-4">
              Add Photo
            </Text>

            <Pressable
              onPress={takePhoto}
              className="flex-row items-center px-5 py-4 active:bg-sand/50"
            >
              <View className="w-10 h-10 bg-forest/10 rounded-full items-center justify-center">
                <Camera size={20} color="#2D5A3D" />
              </View>
              <View className="ml-4">
                <Text className="text-charcoal font-semibold">Take Photo</Text>
                <Text className="text-wood text-sm">Use your camera</Text>
              </View>
            </Pressable>

            <Pressable
              onPress={pickImageFromLibrary}
              className="flex-row items-center px-5 py-4 active:bg-sand/50"
            >
              <View className="w-10 h-10 bg-forest/10 rounded-full items-center justify-center">
                <ImagePlus size={20} color="#2D5A3D" />
              </View>
              <View className="ml-4">
                <Text className="text-charcoal font-semibold">Choose from Library</Text>
                <Text className="text-wood text-sm">Select an existing photo</Text>
              </View>
            </Pressable>

            <Pressable
              onPress={addPhotoUrl}
              className="flex-row items-center px-5 py-4 active:bg-sand/50"
            >
              <View className="w-10 h-10 bg-forest/10 rounded-full items-center justify-center">
                <Plus size={20} color="#2D5A3D" />
              </View>
              <View className="ml-4">
                <Text className="text-charcoal font-semibold">Add from URL</Text>
                <Text className="text-wood text-sm">Paste an image link</Text>
              </View>
            </Pressable>

            <Pressable
              onPress={() => setShowPhotoOptions(false)}
              className="mx-5 mt-4 py-3 bg-sand rounded-xl items-center"
            >
              <Text className="text-bark font-semibold">Cancel</Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>

      {/* Main Product Picker Modal */}
      <Modal
        visible={showMainProductPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMainProductPicker(false)}
      >
        <Pressable
          className="flex-1 bg-black/50 justify-end"
          onPress={() => setShowMainProductPicker(false)}
        >
          <Animated.View
            entering={FadeInDown.duration(200)}
            className="bg-white rounded-t-3xl pt-2 pb-8 max-h-[70%]"
          >
            <View className="w-10 h-1 bg-sand rounded-full self-center mb-4" />
            <Text className="text-charcoal font-bold text-lg px-5 mb-4">
              Select Main Product
            </Text>

            <ScrollView className="px-5" showsVerticalScrollIndicator={false}>
              {MAIN_PRODUCT_OPTIONS.map((product) => (
                <Pressable
                  key={product.id}
                  onPress={async () => {
                    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    console.log('[EditListing] Selected mainProduct:', product.id);
                    setMainProduct(product.id);
                    setShowMainProductPicker(false);
                  }}
                  className={`flex-row items-center justify-between py-4 border-b border-sand/50 ${
                    mainProduct === product.id ? 'bg-forest/5' : ''
                  }`}
                >
                  <Text className={`text-base ${
                    mainProduct === product.id ? 'text-forest font-semibold' : 'text-charcoal'
                  }`}>
                    {product.label}
                  </Text>
                  {mainProduct === product.id && (
                    <Check size={20} color="#2D5A3D" />
                  )}
                </Pressable>
              ))}
            </ScrollView>

            <Pressable
              onPress={() => setShowMainProductPicker(false)}
              className="mx-5 mt-4 py-3 bg-sand rounded-xl items-center"
            >
              <Text className="text-bark font-semibold">Cancel</Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>
    </View>
  );
}
