import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Switch,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Save,
  Trash2,
  Image as ImageIcon,
  Phone,
  Mail,
  Globe,
  ChevronDown,
  Plus,
  X,
  Camera,
  Star,
  ImagePlus,
  Award,
  RotateCcw,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { AdminGuard } from '@/components/AdminGuard';
import { useAdminStore, generateVerificationCode } from '@/lib/admin-store';
import { Farmstand, FarmstandStatus, GoldVerifiedSource, OwnershipDisputeStatus, ClaimStatus } from '@/lib/farmer-store';
import { useUserStore } from '@/lib/user-store';
import { evaluateGoldVerification, MIN_REVIEWS_FOR_GOLD, MIN_DAYS_ACTIVE, MIN_RATING_FOR_GOLD } from '@/lib/gold-verification';
import { formatPhoneNumber, getPhoneDigits } from '@/lib/phone-utils';
import { GeocodeSource, GeocodeConfidence } from '@/lib/resolve-farmstand-coordinates';
import {
  AddressMapPicker,
  AddressMapPickerData,
  createDefaultAddressMapData,
  AddressMapPickerSource,
} from '@/components/AddressMapPicker';
import { uploadToSupabaseStorage, isSupabaseConfigured } from '@/lib/supabase';

const OFFERING_OPTIONS = [
  'Eggs',
  'Produce',
  'Meats',
  'Baked Goods',
  'Dairy',
  'Honey',
  'Flowers',
  'Preserves',
  'Herbs',
  'Fruits',
  'Vegetables',
];

const PAYMENT_OPTIONS = [
  { id: 'cash', label: 'Cash' },
  { id: 'card', label: 'Credit/Debit Card' },
  { id: 'venmo', label: 'Venmo' },
  { id: 'paypal', label: 'PayPal' },
  { id: 'check', label: 'Check' },
];

const STATUS_OPTIONS: { id: FarmstandStatus; label: string; color: string }[] = [
  { id: 'draft', label: 'Draft', color: '#6b7280' },
  { id: 'pending', label: 'Pending Approval', color: '#f59e0b' },
  { id: 'active', label: 'Active', color: '#16a34a' },
  { id: 'hidden', label: 'Hidden', color: '#ef4444' },
];

interface PhotoItem {
  id: string;
  uri: string;
  uploading?: boolean;
  failed?: boolean;
  isLocalPreview?: boolean;
}

interface FormData {
  name: string;
  description: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  latitude: string;
  longitude: string;
  offerings: string[];
  otherProducts: string[];
  paymentOptions: string[];
  status: FarmstandStatus;
  showOnMap: boolean;
  seasonalNotes: string;
  photos: string[];
  mainPhotoIndex: number;
  geocodeSource: GeocodeSource;
  geocodeConfidence: GeocodeConfidence;
}

function FarmstandEditContent() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const isEditing = !!params.id;

  const getFarmstandById = useAdminStore((s) => s.getFarmstandById);
  const updateFarmstand = useAdminStore((s) => s.updateFarmstand);
  const createFarmstand = useAdminStore((s) => s.createFarmstand);
  const deleteFarmstand = useAdminStore((s) => s.deleteFarmstand);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const setGoldVerifiedAdmin = useAdminStore((s) => s.setGoldVerifiedAdmin);
  const returnToAutomaticGoldVerification = useAdminStore((s) => s.returnToAutomaticGoldVerification);
  const updateFarmstandDisputeStatus = useAdminStore((s) => s.updateFarmstandDisputeStatus);

  const user = useUserStore((s) => s.user);

  // Gold Verification state
  const [goldVerified, setGoldVerified] = useState(false);
  const [goldVerifiedSource, setGoldVerifiedSource] = useState<GoldVerifiedSource>('none');
  const [ownershipDisputeStatus, setOwnershipDisputeStatus] = useState<OwnershipDisputeStatus>('none');
  const [reviewCount, setReviewCount] = useState(0);
  const [avgRating, setAvgRating] = useState(0);
  const [createdAtDate, setCreatedAtDate] = useState<string | null>(null);
  const [isUpdatingGold, setIsUpdatingGold] = useState(false);
  const [claimStatus, setClaimStatus] = useState<ClaimStatus>('unclaimed');

  const [formData, setFormData] = useState<FormData>({
    name: '',
    description: '',
    addressLine1: '',
    city: '',
    state: 'OR',
    zip: '',
    phone: '',
    email: '',
    latitude: '',
    longitude: '',
    offerings: [],
    otherProducts: [],
    paymentOptions: ['cash'],
    status: 'draft',
    showOnMap: true,
    seasonalNotes: '',
    photos: [],
    mainPhotoIndex: 0,
    geocodeSource: 'manual',
    geocodeConfidence: 'low',
  });

  const [isSaving, setIsSaving] = useState(false);
  const [showOfferingsModal, setShowOfferingsModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showPhotoOptions, setShowPhotoOptions] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [localPhotos, setLocalPhotos] = useState<PhotoItem[]>([]);
  const [otherProductInput, setOtherProductInput] = useState('');

  // Address/Map picker state - synced with formData
  const [addressMapData, setAddressMapData] = useState<AddressMapPickerData>(() =>
    createDefaultAddressMapData({
      state: 'OR',
    })
  );

  // Handler to convert AddressMapPickerSource to GeocodeSource
  const mapSourceToGeocodeSource = (source: AddressMapPickerSource): GeocodeSource => {
    switch (source) {
      case 'address':
        return 'address';
      case 'current_location':
        return 'device';
      case 'pin_drag':
        return 'manual';
      case 'manual':
        return 'manual';
      default:
        return 'manual';
    }
  };

  // Handler to convert GeocodeSource to AddressMapPickerSource
  const mapGeocodeSourceToPickerSource = (source: GeocodeSource): AddressMapPickerSource => {
    switch (source) {
      case 'address':
        return 'address';
      case 'device':
        return 'current_location';
      case 'cross_streets':
        return 'address';
      case 'manual':
        return 'manual';
      default:
        return 'manual';
    }
  };

  // Handler to sync AddressMapPicker changes with formData
  const handleAddressMapChange = useCallback((data: AddressMapPickerData) => {
    setAddressMapData(data);
    setFormData((prev) => ({
      ...prev,
      addressLine1: data.addressLine1,
      city: data.city,
      state: data.state,
      zip: data.zip,
      latitude: data.latitude?.toFixed(6) ?? '',
      longitude: data.longitude?.toFixed(6) ?? '',
      geocodeSource: mapSourceToGeocodeSource(data.geocodeSource),
      geocodeConfidence: data.geocodeConfidence,
    }));
  }, []);

  useEffect(() => {
    loadAdminData().then(() => {
      if (params.id) {
        const farmstand = getFarmstandById(params.id);
        if (farmstand) {
          const geocodeSource = (farmstand as any).geocodeSource || 'manual';
          const geocodeConfidence = (farmstand as any).geocodeConfidence || 'low';

          setFormData({
            name: farmstand.name,
            description: farmstand.description,
            addressLine1: farmstand.addressLine1 || '',
            city: farmstand.city || '',
            state: farmstand.state || 'OR',
            zip: farmstand.zip || '',
            phone: farmstand.phone || '',
            email: farmstand.email || '',
            latitude: farmstand.latitude?.toString() || '',
            longitude: farmstand.longitude?.toString() || '',
            offerings: farmstand.offerings,
            otherProducts: farmstand.otherProducts || [],
            paymentOptions: farmstand.paymentOptions,
            status: farmstand.status,
            showOnMap: farmstand.showOnMap,
            seasonalNotes: farmstand.seasonalNotes || '',
            photos: farmstand.photos || [],
            mainPhotoIndex: farmstand.mainPhotoIndex ?? 0,
            geocodeSource,
            geocodeConfidence,
          });

          // Seed localPhotos from saved remote URLs
          const savedPhotos: PhotoItem[] = (farmstand.photos || [])
            .filter((p: string) => p.startsWith('http'))
            .map((url: string) => ({ id: url, uri: url, uploading: false, failed: false, isLocalPreview: false }));
          setLocalPhotos(savedPhotos);

          // Also initialize addressMapData for the AddressMapPicker
          setAddressMapData({
            addressLine1: farmstand.addressLine1 || '',
            addressLine2: '',
            city: farmstand.city || '',
            state: farmstand.state || 'OR',
            zip: farmstand.zip || '',
            country: 'US',
            latitude: farmstand.latitude ?? null,
            longitude: farmstand.longitude ?? null,
            geocodeSource: mapGeocodeSourceToPickerSource(geocodeSource),
            geocodeConfidence,
          });

          // Load gold verification state
          setGoldVerified(farmstand.goldVerified ?? false);
          setGoldVerifiedSource(farmstand.goldVerifiedSource ?? 'none');
          setOwnershipDisputeStatus(farmstand.ownershipDisputeStatus ?? 'none');
          setReviewCount(farmstand.reviewCount ?? 0);
          setAvgRating(farmstand.avgRating ?? 0);
          setCreatedAtDate(farmstand.createdAt);
          setClaimStatus(farmstand.claimStatus ?? 'unclaimed');
        }
      }
    });
  }, [params.id]);

  const updateField = useCallback(<K extends keyof FormData>(field: K, value: FormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const toggleOffering = useCallback((offering: string) => {
    setFormData((prev) => ({
      ...prev,
      offerings: prev.offerings.includes(offering)
        ? prev.offerings.filter((o) => o !== offering)
        : [...prev.offerings, offering],
    }));
  }, []);

  const togglePayment = useCallback((payment: string) => {
    setFormData((prev) => ({
      ...prev,
      paymentOptions: prev.paymentOptions.includes(payment)
        ? prev.paymentOptions.filter((p) => p !== payment)
        : [...prev.paymentOptions, payment],
    }));
  }, []);

  // Other Products handlers
  const addOtherProduct = useCallback(() => {
    const trimmed = otherProductInput.trim();
    if (!trimmed) return;

    // Case-insensitive duplicate check
    const isDuplicate = formData.otherProducts.some(
      (p) => p.toLowerCase() === trimmed.toLowerCase()
    );
    if (isDuplicate) {
      Alert.alert('Duplicate', 'This product has already been added.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFormData((prev) => ({
      ...prev,
      otherProducts: [...prev.otherProducts, trimmed],
    }));
    setOtherProductInput('');
  }, [otherProductInput, formData.otherProducts]);

  const removeOtherProduct = useCallback((product: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFormData((prev) => ({
      ...prev,
      otherProducts: prev.otherProducts.filter((p) => p !== product),
    }));
  }, []);

  // Gold Verification handlers
  const handleToggleGoldVerified = async (value: boolean) => {
    if (!params.id || !user?.id) return;
    setIsUpdatingGold(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const result = await setGoldVerifiedAdmin(params.id, value, user.id);
    if (result.success) {
      setGoldVerified(value);
      setGoldVerifiedSource('admin');
    } else {
      Alert.alert('Error', result.error || 'Failed to update gold verification');
    }
    setIsUpdatingGold(false);
  };

  const handleReturnToAutomatic = async () => {
    if (!params.id || !user?.id) return;

    Alert.alert(
      'Return to Automatic',
      'This will let the system automatically determine Gold Verified status based on criteria (90 days active, 4.0+ rating, 7+ reviews, no disputes). Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Return to Automatic',
          onPress: async () => {
            setIsUpdatingGold(true);
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

            const result = await returnToAutomaticGoldVerification(params.id!, user!.id ?? '');
            if (result.success) {
              // Reload farmstand to get updated values
              const farmstand = getFarmstandById(params.id!);
              if (farmstand) {
                setGoldVerified(farmstand.goldVerified);
                setGoldVerifiedSource(farmstand.goldVerifiedSource);
              }
            } else {
              Alert.alert('Error', result.error || 'Failed to return to automatic');
            }
            setIsUpdatingGold(false);
          },
        },
      ]
    );
  };

  const handleDisputeStatusChange = async (newStatus: OwnershipDisputeStatus) => {
    if (!params.id || !user?.id) return;
    setIsUpdatingGold(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const result = await updateFarmstandDisputeStatus(params.id, newStatus, user.id);
    if (result.success) {
      setOwnershipDisputeStatus(newStatus);
      // Reload farmstand to get updated gold verification values
      const farmstand = getFarmstandById(params.id);
      if (farmstand) {
        setGoldVerified(farmstand.goldVerified);
        setGoldVerifiedSource(farmstand.goldVerifiedSource);
      }
    } else {
      Alert.alert('Error', result.error || 'Failed to update dispute status');
    }
    setIsUpdatingGold(false);
  };

  // Calculate days since created
  const daysSinceCreated = createdAtDate
    ? Math.floor((Date.now() - new Date(createdAtDate).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // Photo management functions
  const removePhoto = useCallback(async (photoId: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLocalPhotos((prev) => prev.filter((p) => p.id !== photoId));
    setFormData((prev) => {
      const newPhotos = prev.photos.filter((url) => url !== photoId);
      return { ...prev, photos: newPhotos, mainPhotoIndex: Math.max(0, Math.min(prev.mainPhotoIndex, newPhotos.length - 1)) };
    });
  }, []);

  const setAsMainPhoto = useCallback(async (photoId: string) => {
    if (!photoId.startsWith('http')) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setFormData((prev) => {
      const idx = prev.photos.indexOf(photoId);
      if (idx === -1) return prev;
      return { ...prev, mainPhotoIndex: idx };
    });
  }, []);

  const addPhoto = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowPhotoOptions(true);
  }, []);

  /**
   * Upload photo to Supabase Storage and return the public URL.
   * Throws on failure — never returns a local URI.
   */
  const uploadAndGetUrl = async (localUri: string): Promise<string> => {
    const farmstandIdForUpload = params.id || `temp-${Date.now()}`;

    if (!isSupabaseConfigured()) {
      throw new Error('Storage is not configured');
    }

    const timestamp = Date.now();
    const fileExtension = localUri.split('.').pop()?.toLowerCase() || 'jpg';
    const fileName = `${timestamp}.${fileExtension}`;
    const storagePath = `${farmstandIdForUpload}/${fileName}`;

    console.log('[AdminFarmstandEdit] Uploading photo:', storagePath);

    const { url: uploadedUrl, error: uploadError } = await uploadToSupabaseStorage(
      'farmstand-photos',
      storagePath,
      localUri,
      `image/${fileExtension === 'png' ? 'png' : 'jpeg'}`
    );

    if (uploadError || !uploadedUrl) {
      throw new Error(uploadError?.message || 'Upload failed');
    }

    if (!uploadedUrl.startsWith('http')) {
      throw new Error('Invalid URL returned from storage');
    }

    console.log('[AdminFarmstandEdit] Upload success:', uploadedUrl);
    return uploadedUrl;
  };

  /** Immediately show local preview and upload in background */
  const startOptimisticUpload = (localUri: string) => {
    const tempId = `temp-${Date.now()}`;
    const tempPhoto: PhotoItem = { id: tempId, uri: localUri, uploading: true, failed: false, isLocalPreview: true };
    setLocalPhotos((prev) => [...prev, tempPhoto]);

    uploadAndGetUrl(localUri).then((uploadedUrl) => {
      setLocalPhotos((prev) =>
        prev.map((p) =>
          p.id === tempId
            ? { id: uploadedUrl, uri: uploadedUrl, uploading: false, failed: false, isLocalPreview: false }
            : p
        )
      );
      setFormData((prev) => ({ ...prev, photos: [...prev.photos.filter((p) => p.startsWith('http')), uploadedUrl] }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }).catch((err) => {
      console.error('[AdminFarmstandEdit] Upload failed:', err);
      setLocalPhotos((prev) =>
        prev.map((p) => (p.id === tempId ? { ...p, uploading: false, failed: true } : p))
      );
    });
  };

  const retryPhoto = (photo: PhotoItem) => {
    setLocalPhotos((prev) =>
      prev.map((p) => (p.id === photo.id ? { ...p, uploading: true, failed: false } : p))
    );
    uploadAndGetUrl(photo.uri).then((uploadedUrl) => {
      setLocalPhotos((prev) =>
        prev.map((p) =>
          p.id === photo.id
            ? { id: uploadedUrl, uri: uploadedUrl, uploading: false, failed: false, isLocalPreview: false }
            : p
        )
      );
      setFormData((prev) => ({ ...prev, photos: [...prev.photos.filter((p) => p.startsWith('http')), uploadedUrl] }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }).catch((err) => {
      console.error('[AdminFarmstandEdit] Retry failed:', err);
      setLocalPhotos((prev) =>
        prev.map((p) => (p.id === photo.id ? { ...p, uploading: false, failed: true } : p))
      );
    });
  };

  const pickImageFromLibrary = async () => {
    setShowPhotoOptions(false);

    const existing = await ImagePicker.getMediaLibraryPermissionsAsync();
    let granted = existing.status === 'granted';

    if (!granted) {
      if (!existing.canAskAgain) {
        Alert.alert('Permission Required', 'Please enable photo library access in Settings to add photos.');
        return;
      }
      const requested = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (requested.status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to your photo library to add images.');
        return;
      }
      granted = true;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      console.log('[AdminFarmstandEdit] Image picked:', result.assets[0].uri);
      startOptimisticUpload(result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    setShowPhotoOptions(false);

    const existing = await ImagePicker.getCameraPermissionsAsync();
    let granted = existing.status === 'granted';

    if (!granted) {
      if (!existing.canAskAgain) {
        Alert.alert('Permission Required', 'Please enable camera access in Settings to take photos.');
        return;
      }
      const requested = await ImagePicker.requestCameraPermissionsAsync();
      if (requested.status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to your camera to take photos.');
        return;
      }
      granted = true;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      console.log('[AdminFarmstandEdit] Photo taken:', result.assets[0].uri);
      startOptimisticUpload(result.assets[0].uri);
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
              setFormData((prev) => ({ ...prev, photos: [...prev.photos, url.trim()] }));
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

  const handleSave = async (asDraft = false) => {
    if (!formData.name.trim()) {
      Alert.alert('Required', 'Please enter a farmstand name');
      return;
    }

    setIsSaving(true);

    try {
      // CRITICAL: Filter photos to only include valid https:// URLs
      const validPhotos = formData.photos.filter((p) => p.startsWith('http'));
      // Set hero_image_url to the selected main photo
      const mainPhotoUrl = validPhotos[formData.mainPhotoIndex] ?? validPhotos[0] ?? null;

      console.log('[AdminFarmstandEdit] Saving with validPhotos:', validPhotos);
      console.log('[AdminFarmstandEdit] Setting heroImageUrl to:', mainPhotoUrl);

      const farmstandData: Omit<Farmstand, 'id' | 'updatedAt'> = {
        ownerUserId: 'admin',
        name: formData.name.trim(),
        shortDescription: formData.description.slice(0, 100),
        description: formData.description.trim(),
        categories: [],
        photos: validPhotos,
        mainPhotoIndex: formData.mainPhotoIndex,
        phone: formData.phone.trim() || null,
        email: formData.email.trim() || null,
        socialLinks: [],
        isActive: formData.status === 'active',
        status: asDraft ? 'draft' : formData.status,
        operationalStatus: 'active',
        showOnMap: formData.showOnMap,
        addressLine1: formData.addressLine1.trim() || null,
        addressLine2: null,
        city: formData.city.trim() || null,
        state: formData.state || null,
        zip: formData.zip.trim() || null,
        fullAddress: [formData.addressLine1.trim(), formData.city.trim(), formData.state, formData.zip.trim()].filter(Boolean).join(', ') || null,
        latitude: formData.latitude ? parseFloat(formData.latitude) : null,
        longitude: formData.longitude ? parseFloat(formData.longitude) : null,
        hours: null,
        isOpen24_7: false,
        seasonalNotes: formData.seasonalNotes.trim() || null,
        seasonalDates: null,
        offerings: formData.offerings,
        otherProducts: formData.otherProducts,
        paymentOptions: formData.paymentOptions,
        honorSystem: false,
        selfServe: false,
        directionsNotes: null,
        parkingNotes: null,
        todaysNote: null,
        adminNotes: null,
        createdAt: new Date().toISOString(),
        claimStatus: 'unclaimed',
        verificationCode: generateVerificationCode(),
        claimedAt: null,
        goldVerified: false,
        goldVerifiedSource: 'none',
        ownershipDisputeStatus: 'none',
        lastActivityAt: new Date().toISOString(),
        reviewCount: 0,
        avgRating: 0,
        // Verification fields - admin-created farmstands are verified by default
        verificationStatus: 'VERIFIED',
        visibilityStatus: 'PUBLIC',
        createdByUserId: 'admin',
        claimedByUserId: null,
        verifiedByAdminId: 'admin',
        verifiedAt: new Date().toISOString(),
        rejectionReason: null,
        submissionAdminNotes: null,
        lastReviewedAt: null,
        // Promotion fields
        promoActive: false,
        promoExploreCategories: [],
        promoMapBoost: false,
        promoPriority: 50,
        promoStartAt: null,
        promoEndAt: null,
        promoRotationWeight: 1,
        promoStatus: 'none',
        // Popularity tracking fields
        clicks30d: 0,
        saves30d: 0,
        messages30d: 0,
        popularityScore: 0,
        // Monetization hook
        isPaidPromotion: false,
        promotionTier: 'none',
        // Seeded listing fields - admin-created farmstands have full access
        seededListing: false,
        importSource: null,
        confidenceLevel: 'high',
        approvalStatus: 'approved',
        visibility: 'public',
        claimingDisabled: false,
        reviewsEnabled: true,
        messagingEnabled: true,
        showStatusBanner: false,
        statusBannerText: null,
        statusBannerType: 'neutral',
        createdByRole: 'admin',
        // Location mode fields
        locationMode: 'exact_address',
        areaType: null,
        crossStreet1: null,
        crossStreet2: null,
        genericAreaText: null,
        nearestCityState: null,
        pinSource: 'geocode_exact',
        // Approximate location fields
        useApproximateLocation: false,
        approxLocationText: null,
        optionalNearestCityState: null,
        locationPrecision: 'exact',
        geocodeProvider: null,
        geocodeConfidence: null,
        pinAdjustedByUser: false,
        adminReviewReason: null,
        // Hero image fields - set from main photo if available
        heroPhotoUrl: mainPhotoUrl,
        aiPhotoUrl: null,
        heroImageUrl: mainPhotoUrl,
        heroImageTheme: null,
        heroImageSeed: null,
        heroImageGeneratedAt: null,
        // Main product AI image fields
        mainProduct: null,
        aiImageUrl: null,
        aiImageSeed: null,
        aiImageUpdatedAt: null,
        // Smart card image fields
        primaryImageMode: 'ai_fallback' as const,
        fallbackImageKey: null,
        // Soft delete field
        deletedAt: null,
      };

      if (isEditing && params.id) {
        await updateFarmstand(params.id, farmstandData);
        Alert.alert('Saved', 'Farmstand updated successfully', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        await createFarmstand(farmstandData);
        Alert.alert('Created', 'Farmstand created successfully', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to save farmstand');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    if (!params.id) return;

    Alert.alert(
      'Delete Farmstand',
      'Are you sure you want to delete this farmstand? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteFarmstand(params.id!);
            router.back();
          },
        },
      ]
    );
  };

  const statusOption = STATUS_OPTIONS.find((s) => s.id === formData.status);

  return (
    <View className="flex-1 bg-gray-50">
      <SafeAreaView edges={['top']} className="bg-white">
        <View className="flex-row items-center justify-between px-5 py-4 border-b border-gray-100">
          <Pressable onPress={() => router.back()} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#111827" />
          </Pressable>
          <Text className="text-lg font-semibold text-gray-900">
            {isEditing ? 'Edit Farmstand' : 'Add Farmstand'}
          </Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Photos Section */}
          <View className="bg-white mt-4 mx-4 rounded-2xl p-5">
            <View className="flex-row items-center mb-2">
              <ImageIcon size={18} color="#6b7280" />
              <Text className="text-sm font-semibold text-gray-500 uppercase ml-2">
                Photos
              </Text>
            </View>
            <Text className="text-xs text-gray-500 mb-4">
              Tap a photo to set it as the main display image
            </Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled={true}
              style={{ flexGrow: 0 }}
            >
              {localPhotos.map((photo, index) => (
                <Animated.View
                  key={photo.id}
                  entering={FadeIn.delay(index * 50)}
                  className="mr-3 relative"
                >
                  <Pressable onPress={() => !photo.isLocalPreview && setAsMainPhoto(photo.id)}>
                    <Image
                      source={{ uri: photo.uri }}
                      className="w-28 h-28 rounded-xl"
                      resizeMode="cover"
                      style={photo.uploading || photo.failed ? { opacity: 0.6 } : undefined}
                    />
                    {/* Main photo indicator */}
                    {!photo.isLocalPreview && photo.id === formData.photos[formData.mainPhotoIndex] && (
                      <>
                        <View className="absolute bottom-1 left-1 right-1 bg-green-600/90 rounded-lg py-1 px-2 flex-row items-center justify-center">
                          <Star size={12} color="#ffffff" fill="#ffffff" />
                          <Text className="text-white text-xs font-semibold ml-1">Main</Text>
                        </View>
                        <View className="absolute inset-0 rounded-xl" style={{ borderWidth: 3, borderColor: '#16a34a' }} />
                      </>
                    )}
                    {/* Uploading overlay */}
                    {photo.uploading && (
                      <View className="absolute inset-0 rounded-xl items-center justify-center bg-black/30">
                        <ActivityIndicator size="small" color="#ffffff" />
                        <Text className="text-white text-[9px] mt-1 font-semibold">Uploading</Text>
                      </View>
                    )}
                    {/* Failed overlay */}
                    {photo.failed && (
                      <View className="absolute inset-0 rounded-xl items-center justify-center bg-red-900/50">
                        <Pressable onPress={() => retryPhoto(photo)} className="items-center" hitSlop={8}>
                          <RefreshCw size={18} color="#ffffff" />
                          <Text className="text-white text-[9px] mt-0.5 font-semibold">Retry</Text>
                        </Pressable>
                      </View>
                    )}
                  </Pressable>
                  {!photo.uploading && (
                    <Pressable
                      onPress={() => removePhoto(photo.id)}
                      className="absolute -top-2 -right-2 w-7 h-7 bg-red-500 rounded-full items-center justify-center shadow-sm"
                    >
                      <X size={16} color="#ffffff" />
                    </Pressable>
                  )}
                </Animated.View>
              ))}
              {localPhotos.length < 8 && (
                <Pressable
                  onPress={addPhoto}
                  className="w-28 h-28 rounded-xl border-2 border-dashed border-gray-300 items-center justify-center bg-gray-50"
                >
                  <ImagePlus size={28} color="#6b7280" />
                  <Text className="text-gray-500 text-xs mt-2 font-medium">Add Photo</Text>
                </Pressable>
              )}
            </ScrollView>
          </View>

          {/* Basic Info Section */}
          <View className="bg-white mt-4 mx-4 rounded-2xl p-5">
            <Text className="text-sm font-semibold text-gray-500 uppercase mb-4">
              Basic Information
            </Text>

            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-2">Name *</Text>
              <TextInput
                value={formData.name}
                onChangeText={(v) => updateField('name', v)}
                placeholder="Farmstand name"
                placeholderTextColor="#9ca3af"
                className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900"
              />
            </View>

            <View>
              <Text className="text-sm font-medium text-gray-700 mb-2">About</Text>
              <TextInput
                value={formData.description}
                onChangeText={(v) => updateField('description', v)}
                placeholder="Tell visitors about this farmstand..."
                placeholderTextColor="#9ca3af"
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900 min-h-[100px]"
              />
            </View>
          </View>

          {/* Location Section - Using shared AddressMapPicker component */}
          <View className="mt-4 mx-4">
            <AddressMapPicker
              value={addressMapData}
              onChange={handleAddressMapChange}
              labels={{
                title: 'Location',
                subtitle: 'Latitude and Longitude are required for the farmstand to appear on the map.',
              }}
            />
          </View>

          {/* Contact Section */}
          <View className="bg-white mt-4 mx-4 rounded-2xl p-5">
            <Text className="text-sm font-semibold text-gray-500 uppercase mb-4">
              Contact Information
            </Text>

            <View className="mb-4">
              <View className="flex-row items-center mb-2">
                <Phone size={16} color="#6b7280" />
                <Text className="text-sm font-medium text-gray-700 ml-2">Phone</Text>
              </View>
              <TextInput
                value={formatPhoneNumber(formData.phone)}
                onChangeText={(v) => {
                  const digits = getPhoneDigits(v);
                  updateField('phone', digits);
                }}
                placeholder="(503) 555-1234"
                placeholderTextColor="#9ca3af"
                keyboardType="phone-pad"
                maxLength={14}
                className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900"
              />
            </View>

            <View className="mb-4">
              <View className="flex-row items-center mb-2">
                <Mail size={16} color="#6b7280" />
                <Text className="text-sm font-medium text-gray-700 ml-2">Email</Text>
              </View>
              <TextInput
                value={formData.email}
                onChangeText={(v) => updateField('email', v)}
                placeholder="contact@farmstand.com"
                placeholderTextColor="#9ca3af"
                keyboardType="email-address"
                autoCapitalize="none"
                className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900"
              />
            </View>
          </View>

          {/* Offerings Section */}
          <View className="bg-white mt-4 mx-4 rounded-2xl p-5">
            <Text className="text-sm font-semibold text-gray-500 uppercase mb-4">
              Offerings
            </Text>

            <View className="flex-row flex-wrap">
              {OFFERING_OPTIONS.map((offering) => {
                const isSelected = formData.offerings.includes(offering);
                return (
                  <Pressable
                    key={offering}
                    onPress={() => toggleOffering(offering)}
                    className={`px-3 py-2 rounded-full mr-2 mb-2 ${
                      isSelected ? 'bg-green-600' : 'bg-gray-100'
                    }`}
                  >
                    <Text
                      className={`text-sm font-medium ${
                        isSelected ? 'text-white' : 'text-gray-600'
                      }`}
                    >
                      {offering}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Other Products Section */}
          <View className="bg-white mt-4 mx-4 rounded-2xl p-5">
            <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">
              Other Products
            </Text>
            <Text className="text-xs text-gray-500 mb-4">
              {claimStatus === 'claimed'
                ? 'Add individual items not covered by categories above'
                : 'Submitted products not covered by categories above'}
            </Text>

            {/* Input with Add button - only show for claimed farmstands */}
            {claimStatus === 'claimed' && (
              <View className="flex-row items-center mb-3">
                <TextInput
                  className="flex-1 bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900"
                  value={otherProductInput}
                  onChangeText={setOtherProductInput}
                  placeholder="e.g., Maple Syrup"
                  placeholderTextColor="#9ca3af"
                  autoCapitalize="words"
                  returnKeyType="done"
                  onSubmitEditing={addOtherProduct}
                />
                <Pressable
                  onPress={addOtherProduct}
                  disabled={!otherProductInput.trim()}
                  className={`ml-3 w-12 h-12 rounded-xl items-center justify-center ${
                    otherProductInput.trim() ? 'bg-green-600' : 'bg-gray-200'
                  }`}
                >
                  <Plus size={22} color={otherProductInput.trim() ? '#ffffff' : '#9ca3af'} />
                </Pressable>
              </View>
            )}

            {/* Other products chips - match Offerings chip style */}
            {formData.otherProducts.length > 0 ? (
              <View className="flex-row flex-wrap">
                {formData.otherProducts.map((product, index) => (
                  claimStatus === 'claimed' ? (
                    // Editable chips for claimed farmstands (with remove button)
                    <Pressable
                      key={`${product}-${index}`}
                      onPress={() => removeOtherProduct(product)}
                      className="flex-row items-center px-3 py-2 rounded-full mr-2 mb-2 bg-green-600"
                    >
                      <Text className="text-white font-medium mr-2">{product}</Text>
                      <X size={14} color="#ffffff" />
                    </Pressable>
                  ) : (
                    // Read-only chips for unclaimed farmstands (same style as Offerings)
                    <View
                      key={`${product}-${index}`}
                      className="px-3 py-2 rounded-full mr-2 mb-2 bg-green-600"
                    >
                      <Text className="text-sm font-medium text-white">{product}</Text>
                    </View>
                  )
                ))}
              </View>
            ) : (
              claimStatus !== 'claimed' && (
                <Text className="text-sm text-gray-400 italic">None submitted</Text>
              )
            )}
          </View>

          {/* Payment Options */}
          <View className="bg-white mt-4 mx-4 rounded-2xl p-5">
            <Text className="text-sm font-semibold text-gray-500 uppercase mb-4">
              Payment Options
            </Text>

            <View className="flex-row flex-wrap">
              {PAYMENT_OPTIONS.map((option) => {
                const isSelected = formData.paymentOptions.includes(option.id);
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => togglePayment(option.id)}
                    className={`px-3 py-2 rounded-full mr-2 mb-2 ${
                      isSelected ? 'bg-green-600' : 'bg-gray-100'
                    }`}
                  >
                    <Text
                      className={`text-sm font-medium ${
                        isSelected ? 'text-white' : 'text-gray-600'
                      }`}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Status & Visibility */}
          <View className="bg-white mt-4 mx-4 rounded-2xl p-5">
            <Text className="text-sm font-semibold text-gray-500 uppercase mb-4">
              Status & Visibility
            </Text>

            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-2">Status</Text>
              <Pressable
                onPress={() => setShowStatusModal(true)}
                className="flex-row items-center justify-between bg-gray-100 rounded-xl px-4 py-3"
              >
                <View className="flex-row items-center">
                  <View
                    className="w-3 h-3 rounded-full mr-3"
                    style={{ backgroundColor: statusOption?.color }}
                  />
                  <Text className="text-base text-gray-900">{statusOption?.label}</Text>
                </View>
                <ChevronDown size={20} color="#6b7280" />
              </Pressable>
            </View>

            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-sm font-medium text-gray-700">Show on Map</Text>
                <Text className="text-xs text-gray-500">
                  When enabled, this farmstand appears on the public map
                </Text>
              </View>
              <Switch
                value={formData.showOnMap}
                onValueChange={(v) => updateField('showOnMap', v)}
                trackColor={{ false: '#d1d5db', true: '#86efac' }}
                thumbColor={formData.showOnMap ? '#16a34a' : '#9ca3af'}
              />
            </View>
          </View>

          {/* Gold Verified Badge - Only show when editing */}
          {isEditing && (
            <View className="bg-white mt-4 mx-4 rounded-2xl p-5">
              <View className="flex-row items-center mb-4">
                <Award size={18} color="#D4943A" />
                <Text className="text-sm font-semibold text-gray-500 uppercase ml-2">
                  Gold Verified Badge
                </Text>
              </View>

              {/* Current Status */}
              <View className="bg-amber-50 rounded-xl p-4 mb-4">
                <View className="flex-row items-center justify-between mb-2">
                  <Text className="text-sm font-medium text-amber-800">Current Status</Text>
                  <View className={`px-3 py-1 rounded-full ${goldVerified ? 'bg-amber-500' : 'bg-gray-300'}`}>
                    <Text className={`text-xs font-semibold ${goldVerified ? 'text-white' : 'text-gray-600'}`}>
                      {goldVerified ? 'Gold Verified' : 'Not Verified'}
                    </Text>
                  </View>
                </View>
                <Text className="text-xs text-amber-700">
                  Source: {goldVerifiedSource === 'admin' ? 'Admin Override' : goldVerifiedSource === 'auto' ? 'Automatic' : 'Not Set'}
                </Text>
              </View>

              {/* Eligibility Criteria */}
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-3">Eligibility Criteria</Text>
                <View className="space-y-2">
                  <View className="flex-row items-center">
                    <View className={`w-5 h-5 rounded-full items-center justify-center ${daysSinceCreated >= MIN_DAYS_ACTIVE ? 'bg-green-500' : 'bg-gray-300'}`}>
                      <Text className="text-xs text-white font-bold">{daysSinceCreated >= MIN_DAYS_ACTIVE ? '✓' : '—'}</Text>
                    </View>
                    <Text className="text-sm text-gray-600 ml-3">
                      {daysSinceCreated} / {MIN_DAYS_ACTIVE} days active
                    </Text>
                  </View>
                  <View className="flex-row items-center mt-2">
                    <View className={`w-5 h-5 rounded-full items-center justify-center ${avgRating >= MIN_RATING_FOR_GOLD ? 'bg-green-500' : 'bg-gray-300'}`}>
                      <Text className="text-xs text-white font-bold">{avgRating >= MIN_RATING_FOR_GOLD ? '✓' : '—'}</Text>
                    </View>
                    <Text className="text-sm text-gray-600 ml-3">
                      {avgRating.toFixed(1)} / {MIN_RATING_FOR_GOLD} average rating
                    </Text>
                  </View>
                  <View className="flex-row items-center mt-2">
                    <View className={`w-5 h-5 rounded-full items-center justify-center ${reviewCount >= MIN_REVIEWS_FOR_GOLD ? 'bg-green-500' : 'bg-gray-300'}`}>
                      <Text className="text-xs text-white font-bold">{reviewCount >= MIN_REVIEWS_FOR_GOLD ? '✓' : '—'}</Text>
                    </View>
                    <Text className="text-sm text-gray-600 ml-3">
                      {reviewCount} / {MIN_REVIEWS_FOR_GOLD} reviews
                    </Text>
                  </View>
                  <View className="flex-row items-center mt-2">
                    <View className={`w-5 h-5 rounded-full items-center justify-center ${ownershipDisputeStatus !== 'open' ? 'bg-green-500' : 'bg-red-500'}`}>
                      <Text className="text-xs text-white font-bold">{ownershipDisputeStatus !== 'open' ? '✓' : '✕'}</Text>
                    </View>
                    <Text className="text-sm text-gray-600 ml-3">
                      {ownershipDisputeStatus === 'open' ? 'Has open dispute' : 'No open disputes'}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Gold Verified Toggle */}
              <View className="flex-row items-center justify-between py-3 border-t border-gray-100">
                <View className="flex-1 mr-4">
                  <Text className="text-sm font-medium text-gray-700">Gold Verified</Text>
                  <Text className="text-xs text-gray-500">
                    {goldVerifiedSource === 'admin' ? 'Manually controlled by admin' : 'Toggle to override automatic status'}
                  </Text>
                </View>
                <Switch
                  value={goldVerified}
                  onValueChange={handleToggleGoldVerified}
                  disabled={isUpdatingGold}
                  trackColor={{ false: '#d1d5db', true: '#f59e0b' }}
                  thumbColor={goldVerified ? '#D4943A' : '#9ca3af'}
                />
              </View>

              {/* Ownership Dispute Status */}
              <View className="mt-4 pt-4 border-t border-gray-100">
                <View className="flex-row items-center mb-3">
                  <AlertTriangle size={16} color="#6b7280" />
                  <Text className="text-sm font-medium text-gray-700 ml-2">Ownership Dispute Status</Text>
                </View>
                <View className="flex-row">
                  {(['none', 'open', 'resolved'] as OwnershipDisputeStatus[]).map((status) => (
                    <Pressable
                      key={status}
                      onPress={() => handleDisputeStatusChange(status)}
                      disabled={isUpdatingGold}
                      className={`flex-1 py-2 mx-1 rounded-lg items-center ${
                        ownershipDisputeStatus === status
                          ? status === 'open'
                            ? 'bg-red-500'
                            : status === 'resolved'
                            ? 'bg-green-500'
                            : 'bg-gray-700'
                          : 'bg-gray-100'
                      }`}
                    >
                      <Text
                        className={`text-xs font-medium capitalize ${
                          ownershipDisputeStatus === status ? 'text-white' : 'text-gray-600'
                        }`}
                      >
                        {status}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {ownershipDisputeStatus === 'open' && goldVerifiedSource !== 'admin' && (
                  <Text className="text-xs text-red-600 mt-2">
                    Note: Open disputes automatically remove Gold Verified status (unless admin-controlled)
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* Delete Button (only for editing) */}
          {isEditing && (
            <Pressable
              onPress={handleDelete}
              className="flex-row items-center justify-center mx-4 mt-6 py-4"
            >
              <Trash2 size={18} color="#ef4444" />
              <Text className="text-red-500 font-medium ml-2">Delete Farmstand</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Bottom Actions */}
      <SafeAreaView edges={['bottom']} className="bg-white border-t border-gray-100">
        <View className="flex-row px-5 py-4">
          <Pressable
            onPress={() => handleSave(true)}
            disabled={isSaving}
            className="flex-1 py-3 mr-2 bg-gray-100 rounded-xl items-center"
          >
            <Text className="text-base font-semibold text-gray-700">Save Draft</Text>
          </Pressable>
          <Pressable
            onPress={() => handleSave(false)}
            disabled={isSaving}
            className="flex-1 py-3 ml-2 bg-green-600 rounded-xl items-center flex-row justify-center"
          >
            <Save size={18} color="white" />
            <Text className="text-base font-semibold text-white ml-2">
              {formData.status === 'active' ? 'Publish' : 'Save'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Status Selection Modal */}
      {showStatusModal && (
        <Pressable
          className="absolute inset-0 bg-black/50 justify-end"
          onPress={() => setShowStatusModal(false)}
        >
          <View className="bg-white rounded-t-3xl pt-2 pb-8">
            <View className="w-10 h-1 bg-gray-300 rounded-full self-center mb-4" />
            <Text className="text-lg font-semibold text-gray-900 px-5 mb-3">
              Select Status
            </Text>

            {STATUS_OPTIONS.map((option) => (
              <Pressable
                key={option.id}
                onPress={() => {
                  updateField('status', option.id);
                  setShowStatusModal(false);
                }}
                className="flex-row items-center px-5 py-4 active:bg-gray-50"
              >
                <View
                  className="w-4 h-4 rounded-full mr-4"
                  style={{ backgroundColor: option.color }}
                />
                <Text className="text-base text-gray-700 flex-1">{option.label}</Text>
                {formData.status === option.id && (
                  <View className="w-6 h-6 bg-green-600 rounded-full items-center justify-center">
                    <X size={14} color="white" />
                  </View>
                )}
              </Pressable>
            ))}

            <Pressable
              onPress={() => setShowStatusModal(false)}
              className="mx-5 mt-2 py-3 bg-gray-100 rounded-xl items-center"
            >
              <Text className="text-base font-medium text-gray-600">Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      )}

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
            <View className="w-10 h-1 bg-gray-300 rounded-full self-center mb-4" />
            <Text className="text-gray-900 font-bold text-lg px-5 mb-4">
              Add Photo
            </Text>

            <Pressable
              onPress={takePhoto}
              className="flex-row items-center px-5 py-4 active:bg-gray-50"
            >
              <View className="w-10 h-10 bg-green-100 rounded-full items-center justify-center">
                <Camera size={20} color="#16a34a" />
              </View>
              <View className="ml-4">
                <Text className="text-gray-900 font-semibold">Take Photo</Text>
                <Text className="text-gray-500 text-sm">Use your camera</Text>
              </View>
            </Pressable>

            <Pressable
              onPress={pickImageFromLibrary}
              className="flex-row items-center px-5 py-4 active:bg-gray-50"
            >
              <View className="w-10 h-10 bg-green-100 rounded-full items-center justify-center">
                <ImagePlus size={20} color="#16a34a" />
              </View>
              <View className="ml-4">
                <Text className="text-gray-900 font-semibold">Choose from Library</Text>
                <Text className="text-gray-500 text-sm">Select an existing photo</Text>
              </View>
            </Pressable>

            <Pressable
              onPress={addPhotoUrl}
              className="flex-row items-center px-5 py-4 active:bg-gray-50"
            >
              <View className="w-10 h-10 bg-green-100 rounded-full items-center justify-center">
                <Plus size={20} color="#16a34a" />
              </View>
              <View className="ml-4">
                <Text className="text-gray-900 font-semibold">Add from URL</Text>
                <Text className="text-gray-500 text-sm">Paste an image link</Text>
              </View>
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
    </View>
  );
}

export default function FarmstandEdit() {
  return (
    <AdminGuard>
      <FarmstandEditContent />
    </AdminGuard>
  );
}
