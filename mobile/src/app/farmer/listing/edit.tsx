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
import { ArrowLeft, Camera, X, Plus, Star, Check, ImagePlus, ChevronDown } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFarmerStore, Farmstand } from '@/lib/farmer-store';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { formatPhoneNumber, getPhoneDigits } from '@/lib/phone-utils';
import { uploadToSupabaseStorage, isSupabaseConfigured } from '@/lib/supabase';

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
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [mainProduct, setMainProduct] = useState<string | null>(null);
  const [showMainProductPicker, setShowMainProductPicker] = useState(false);

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
      }
      setIsLoading(false);
    }
  }, [farmstandId, getFarmstandById]);

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
   * Upload photo to Supabase Storage and return the public URL
   */
  const uploadAndGetUrl = async (localUri: string): Promise<string | null> => {
    if (!farmstandId || !isSupabaseConfigured()) {
      console.error('[FarmerListingEdit] Cannot upload: Supabase not configured or no farmstandId');
      Alert.alert('Upload Error', 'Storage is not configured.');
      return null;
    }

    setIsUploadingPhoto(true);

    try {
      const timestamp = Date.now();
      const fileExtension = localUri.split('.').pop()?.toLowerCase() || 'jpg';
      const fileName = `${timestamp}.${fileExtension}`;
      const storagePath = `${farmstandId}/${fileName}`;

      console.log('[FarmerListingEdit] Uploading photo:', storagePath);

      const { url: uploadedUrl, error: uploadError } = await uploadToSupabaseStorage(
        'farmstand-photos',
        storagePath,
        localUri,
        `image/${fileExtension === 'png' ? 'png' : 'jpeg'}`
      );

      if (uploadError || !uploadedUrl) {
        console.error('[FarmerListingEdit] Upload failed:', uploadError);
        Alert.alert('Upload Failed', 'Could not upload photo. Please try again.');
        return null;
      }

      if (!uploadedUrl.startsWith('http')) {
        console.error('[FarmerListingEdit] Invalid URL returned:', uploadedUrl);
        return null;
      }

      console.log('[FarmerListingEdit] Upload success:', uploadedUrl);
      return uploadedUrl;
    } catch (err) {
      console.error('[FarmerListingEdit] Upload error:', err);
      Alert.alert('Error', 'Failed to upload photo.');
      return null;
    } finally {
      setIsUploadingPhoto(false);
    }
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
      const localUri = result.assets[0].uri;
      const uploadedUrl = await uploadAndGetUrl(localUri);

      if (uploadedUrl) {
        setPhotos((prev) => [...prev.filter(p => p.startsWith('http')), uploadedUrl]);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
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
      const localUri = result.assets[0].uri;
      const uploadedUrl = await uploadAndGetUrl(localUri);

      if (uploadedUrl) {
        setPhotos((prev) => [...prev.filter(p => p.startsWith('http')), uploadedUrl]);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
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
          onPress: (url) => {
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
            <Pressable
              onPress={addPhoto}
              className="w-28 h-28 rounded-xl border-2 border-dashed border-sand items-center justify-center bg-white"
            >
              <ImagePlus size={28} color="#8B6F4E" />
              <Text className="text-wood text-xs mt-2 font-medium">Add Photo</Text>
            </Pressable>
          </ScrollView>

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
