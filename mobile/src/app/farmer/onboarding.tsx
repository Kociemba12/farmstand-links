import React, { useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Image, ActionSheetIOS } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, Check, Sparkles, Plus, Camera, AlertTriangle, CheckCircle2 } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useUserStore } from '@/lib/user-store';
import { useAdminStore } from '@/lib/admin-store';
import { useAlertsStore } from '@/lib/alerts-store';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { formatPhoneNumber, getPhoneDigits } from '@/lib/phone-utils';
import { LocationInput, LocationInputData, LocationInputRef, createDefaultLocationData, validateLocationData } from '@/components/LocationInput';
import { uploadToSupabaseStorage } from '@/lib/supabase';
import { compressImage } from '@/lib/compress-image';

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

const STEP_TITLES = [
  { title: 'Add a Farmstand', subtitle: 'Tell us about the farmstand and what they sell.' },
  { title: 'Contact Info (Optional)', subtitle: 'Used only for verification if needed. This information is not public.' },
];

// Form input props type
interface FormInputProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  required?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric' | 'decimal-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  maxLength?: number;
  multiline?: boolean;
  textContentType?: 'streetAddressLine1' | 'addressCity' | 'addressState' | 'postalCode' | 'emailAddress' | 'telephoneNumber' | 'name' | 'familyName' | 'givenName' | 'none';
  autoComplete?: 'street-address' | 'postal-code' | 'email' | 'tel' | 'name' | 'family-name' | 'given-name' | 'off';
  autoCorrect?: boolean;
}

// Move Input component OUTSIDE of main component to prevent re-creation on every render
function FormInput({
  label,
  value,
  onChangeText,
  placeholder,
  required = false,
  keyboardType,
  autoCapitalize,
  maxLength,
  multiline = false,
  textContentType,
  autoComplete,
  autoCorrect = true,
}: FormInputProps) {
  return (
    <View className="mb-4">
      <Text className="text-charcoal font-medium mb-2 text-sm">
        {label}
        {required && <Text className="text-forest"> *</Text>}
      </Text>
      <TextInput
        className={`bg-cream/60 rounded-xl px-4 py-4 text-charcoal border border-sand/60 text-base ${multiline ? 'min-h-[120px]' : ''}`}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#A89080"
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        maxLength={maxLength}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        textContentType={textContentType}
        autoComplete={autoComplete}
        autoCorrect={autoCorrect}
        blurOnSubmit={!multiline}
      />
    </View>
  );
}

// Move SectionCard OUTSIDE to prevent re-creation
function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <View
      className="bg-white rounded-2xl p-5 mb-4"
      style={{
        shadowColor: 'rgba(0, 0, 0, 1)',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
        elevation: 2,
      }}
    >
      {children}
    </View>
  );
}

export default function FarmerOnboardingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ prefillLat?: string; prefillLng?: string }>();
  const user = useUserStore((s) => s.user);
  const createAdminFarmstand = useAdminStore((s) => s.createFarmstand);
  const loadAlerts = useAlertsStore((s) => s.loadAlerts);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [acknowledgedDisclaimer, setAcknowledgedDisclaimer] = useState(false);
  const [wantsToClaimOwnership, setWantsToClaimOwnership] = useState(false);
  // Set to true after the first failed submit attempt to show inline field errors
  const [showValidationErrors, setShowValidationErrors] = useState(false);

  // Guest user check - user is logged in if they have a valid ID that's not 'guest'
  const isGuestUser = !user || user.id === 'guest' || user.name === 'Guest';
  const isLoggedIn = !isGuestUser && user?.id;

  // Farmstand name (required)
  const [farmName, setFarmName] = useState('');

  // Product categories (multi-select chips)
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  // Other products (individual chip entry)
  const [otherProducts, setOtherProducts] = useState<string[]>([]);
  const [otherProductInput, setOtherProductInput] = useState('');

  // Photo upload state
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoSaving, setPhotoSaving] = useState(false);

  // Internal contact fields (admin-only, not shown publicly)
  const [internalContactPhone, setInternalContactPhone] = useState('');
  const [internalContactEmail, setInternalContactEmail] = useState('');
  const [internalEmailError, setInternalEmailError] = useState('');

  // Unified location state using the new LocationInput component
  // Guests default to cross_streets mode for privacy
  // NOTE: prefillLat/prefillLng come from the map's current viewport center.
  // They are used ONLY to visually center the map (initialRegion below), NOT as
  // form coordinates — the viewport is not a confirmed user-chosen address.
  // Form latitude/longitude must start null and only be set via autocomplete
  // selection, reverse-geocode, or manual pin placement.
  const [locationData, setLocationData] = useState<LocationInputData>(() => {
    return createDefaultLocationData('exact_address');
  });

  // Ref to LocationInput component for imperative geocoding
  const locationInputRef = useRef<LocationInputRef>(null);

  const toggleCategory = useCallback(async (category: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  }, []);

  // Add other product chip
  const addOtherProduct = useCallback(async () => {
    const trimmed = otherProductInput.trim();
    if (!trimmed) return;

    // Case-insensitive duplicate check
    const isDuplicate = otherProducts.some(
      p => p.toLowerCase() === trimmed.toLowerCase()
    );
    if (isDuplicate) {
      Alert.alert('Duplicate', 'This product has already been added.');
      return;
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOtherProducts(prev => [...prev, trimmed]);
    setOtherProductInput('');
  }, [otherProductInput, otherProducts]);

  // Remove other product chip
  const removeOtherProduct = useCallback(async (product: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOtherProducts(prev => prev.filter(p => p !== product));
  }, []);

  // Photo picker functions
  const pickFromLibrary = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow photo library access to add photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (result.canceled) return;
    const localUri = result.assets?.[0]?.uri;
    if (localUri) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhotoUri(localUri);
    }
  }, []);

  const takePhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow camera access to take photos.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (result.canceled) return;
    const localUri = result.assets?.[0]?.uri;
    if (localUri) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhotoUri(localUri);
    }
  }, []);

  const onAddPhotoPress = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const options = ['Take Photo', 'Choose from Library', 'Cancel'];
    const cancelButtonIndex = 2;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex },
        async (buttonIndex) => {
          if (buttonIndex === 0) await takePhoto();
          if (buttonIndex === 1) await pickFromLibrary();
        }
      );
    } else {
      Alert.alert('Add Photo', 'Choose a photo source', [
        { text: 'Take Photo', onPress: takePhoto },
        { text: 'Choose from Library', onPress: pickFromLibrary },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [takePhoto, pickFromLibrary]);

  // Upload photo to Supabase Storage and return the public URL
  // farmstandId may be a real UUID or a temp folder name (for pre-upload before insert)
  const uploadFarmstandPhoto = useCallback(async (farmstandId: string): Promise<string | null> => {
    if (!photoUri) return null;

    setPhotoSaving(true);
    try {
      // Compress before upload — also normalises ph:// and simulator URIs to a
      // safe file:// path that expo-file-system can read directly.
      const compressedUri = await compressImage(photoUri);
      if (__DEV__) console.log('[Photo Upload] Compressed URI:', compressedUri);

      const filePath = `${farmstandId}/${Date.now()}.jpg`;
      const { url, error } = await uploadToSupabaseStorage(
        'farmstand-photos',
        filePath,
        compressedUri,
        'image/jpeg'
      );

      if (error) {
        if (__DEV__) console.warn('[Photo Upload] Error:', error.message);
        return null;
      }

      if (__DEV__) console.log('[Photo Upload] Success:', url);
      return url;
    } catch (e) {
      if (__DEV__) console.warn('[Photo Upload] Unexpected error:', e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setPhotoSaving(false);
    }
  }, [photoUri]);

  // Generate a temp folder ID for pre-upload storage path
  const generateTempId = useCallback(() => {
    return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }, []);

  // Email format validation helper
  const isValidEmail = (emailStr: string): boolean => {
    if (!emailStr) return true; // Empty is valid (optional)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(emailStr);
  };

  // Check if at least one product is selected
  const hasProducts = selectedCategories.length > 0 || otherProducts.length > 0;

  // Check if location fields are sufficiently complete to enable the button.
  // We intentionally keep this check lightweight (no geocode call) so the button
  // enables as soon as the user fills the required text fields — final geocoding
  // is enforced in handleSubmit.
  const hasLocation = (() => {
    const d = locationData;
    if (d.locationMode === 'exact_address') {
      // Need street address, city, state, ZIP
      return !!(d.addressLine1?.trim() && d.city?.trim() && d.state?.trim() && d.zip?.trim());
    }
    if (d.locationMode === 'cross_streets') {
      const hasStreets =
        d.areaType === 'cross_streets'
          ? !!(d.crossStreet1?.trim() && d.crossStreet2?.trim())
          : !!d.genericAreaText?.trim();
      // Also require city + state + ZIP from the nearestCityState or dedicated fields
      return hasStreets && !!(d.nearestCityState?.trim() || (d.city?.trim() && d.state?.trim()));
    }
    if (d.locationMode === 'use_my_location') {
      // Coordinates confirmed, plus city/state/ZIP
      return d.latitude !== null && d.longitude !== null && !!(d.city?.trim() && d.state?.trim() && d.zip?.trim());
    }
    return false;
  })();

  // Check if form is valid for submission
  // Guest: must acknowledge disclaimer (required)
  // Logged in: claim checkbox is optional, no disclaimer required
  const canSubmit = !!(farmName.trim() && hasProducts && hasLocation && (isLoggedIn || acknowledgedDisclaimer));

  const handleSubmit = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Validate farmstand name, products, and location
    if (!farmName.trim()) {
      Alert.alert('Farmstand name is required.', 'Please enter the farmstand name.');
      return;
    }

    // Validate at least one product
    if (!hasProducts) {
      Alert.alert('Please select at least one product.', 'Select a category or add an other product.');
      return;
    }

    // Validate location using the shared validateLocationData function
    const locationError = validateLocationData(locationData);
    if (locationError) {
      setShowValidationErrors(true);
      Alert.alert('Location Incomplete', 'Please complete the farmstand location before submitting.');
      return;
    }

    // Clear validation errors — all fields are good
    setShowValidationErrors(false);

    // Validate internal contact email if provided
    if (internalContactEmail.trim() && !isValidEmail(internalContactEmail.trim())) {
      setInternalEmailError('Please enter a valid email address.');
      Alert.alert('Invalid Email', 'Please enter a valid contact email address or leave it blank.');
      return;
    }
    setInternalEmailError('');

    // Validate disclaimer acknowledgment (only for guests)
    if (!isLoggedIn && !acknowledgedDisclaimer) {
      Alert.alert('Acknowledgment Required', 'Please acknowledge the ownership disclaimer before submitting.');
      return;
    }

    // Attempt geocoding — if it fails, user can still proceed by dropping a pin manually.
    // We don't block here; the coordinate check below is the final gate.
    if (locationInputRef.current) {
      await locationInputRef.current.forceGeocode();
    }

    // Brief wait for state to update from forceGeocode
    if (locationData.latitude === null || locationData.longitude === null) {
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    // Final gate: coordinates must be present (either geocoded or from a manual pin drop)
    if (locationData.latitude === null || locationData.longitude === null) {
      Alert.alert(
        'Map Location Required',
        "We couldn't locate this address automatically. Please drop a pin on the map to confirm your farmstand's location.",
      );
      return;
    }

    // Now submit the farmstand
    setIsSubmitting(true);

    try {
      const categoryMap: Record<string, string> = {
        'Fruits': 'produce',
        'Vegetables': 'produce',
        'Eggs': 'eggs',
        'Dairy': 'dairy',
        'Meat': 'meat',
        'Honey': 'honey',
        'Flowers': 'flowers',
        'Baked Goods': 'baked_goods',
        'Preserves': 'preserves',
        'Herbs': 'produce',
      };

      const categories = [...new Set(
        selectedCategories.map((c) => categoryMap[c] || 'produce')
      )];

      const ownerUserId = user?.id || `user-${Date.now()}`;

      // Determine if this is a guest submission (requires verification)
      const isGuestSubmission = isGuestUser || !user?.id;

      // Extract location data from the unified state
      const isApproximate = locationData.isApproximate;
      const finalLatitude = locationData.latitude;
      const finalLongitude = locationData.longitude;

      // Build location fields from unified data
      let finalCity: string | null = locationData.city || null;
      let finalState: string | null = locationData.state || 'OR';
      let finalAddress: string | null = locationData.addressLine1 || null;
      let finalZip: string | null = locationData.zip || null;
      let finalNearestCityState: string | null = locationData.nearestCityState || null;

      // Parse city/state from nearestCityState if using cross streets or GPS mode
      if (locationData.locationMode !== 'exact_address' && locationData.nearestCityState) {
        const parts = locationData.nearestCityState.split(',');
        if (parts.length >= 2) {
          finalCity = parts[0]?.trim() || null;
          finalState = parts[1]?.trim() || 'OR';
        }
      }

      // Build display/approx text
      let finalApproxText: string | null = null;
      if (locationData.locationMode === 'cross_streets') {
        if (locationData.areaType === 'cross_streets') {
          finalApproxText = `${locationData.crossStreet1} & ${locationData.crossStreet2}`;
        } else {
          finalApproxText = locationData.genericAreaText || null;
        }
      }

      // Determine pin source
      let finalPinSource: 'geocode_exact' | 'geocode_approx' | 'device_gps' | 'manual_map_tap' | null = null;
      if (locationData.geoSource === 'GEOCODED') {
        finalPinSource = isApproximate ? 'geocode_approx' : 'geocode_exact';
      } else if (locationData.geoSource === 'DEVICE_GPS') {
        finalPinSource = 'device_gps';
      } else if (locationData.geoSource === 'USER_PIN_ADJUST' || locationData.geoSource === 'ADMIN_PIN_ADJUST') {
        finalPinSource = 'manual_map_tap';
      }

      // Determine location precision
      let finalLocationPrecision: 'exact' | 'approximate' | 'approximate_manual' = 'exact';
      if (isApproximate) {
        finalLocationPrecision = locationData.pinAdjustedByUser ? 'approximate_manual' : 'approximate';
      }

      // Combine selected categories with other products for offerings display
      const allOfferings = [...selectedCategories, ...otherProducts];

      const farmstandData = {
        ownerUserId: isGuestSubmission ? 'pending' : ownerUserId,
        name: farmName,
        shortDescription: '',
        description: '', // Description removed from create flow - owner can add after claiming
        categories,
        photos: [],
        mainPhotoIndex: 0,
        phone: null,
        email: null,
        website: null,
        socialLinks: [],
        isActive: true,
        status: 'active' as const,
        operationalStatus: 'active' as const,
        operatingStatus: 'open' as const,
        showOnMap: true,
        // Location fields
        addressLine1: finalAddress,
        addressLine2: null,
        city: finalCity,
        state: finalState,
        zip: finalZip,
        fullAddress: [finalAddress, finalCity, finalState, finalZip].filter(Boolean).join(', ') || null,
        latitude: finalLatitude,
        longitude: finalLongitude,
        hours: null,
        isOpen24_7: false,
        seasonalNotes: null,
        seasonalDates: null,
        offerings: allOfferings,
        // Store other products as a separate array for display
        otherProducts: otherProducts,
        paymentOptions: ['cash'],
        honorSystem: false,
        selfServe: false,
        directionsNotes: null,
        parkingNotes: null,
        todaysNote: null,
        adminNotes: null,
        createdAt: new Date().toISOString(),
        // Ownership and claim status
        claimStatus: 'unclaimed' as const,
        ownershipStatus: 'unclaimed' as const,
        submittedBy: 'community' as const,
        verificationRequired: true,
        verificationCode: null,
        claimedAt: null,
        goldVerified: false,
        goldVerifiedSource: 'none' as const,
        ownershipDisputeStatus: 'none' as const,
        lastActivityAt: new Date().toISOString(),
        reviewCount: 0,
        avgRating: 0,
        // Submitter contact info - not collected in simplified flow
        submitterFirstName: null,
        submitterLastName: null,
        submitterEmail: null,
        submitterPhone: null,
        // Internal contact fields (admin-only, not shown publicly)
        internalContactPhone: internalContactPhone.trim() || null,
        internalContactEmail: internalContactEmail.trim().toLowerCase() || null,
        // NEW: Verification fields - all submissions start as PENDING_VERIFICATION
        verificationStatus: 'PENDING_VERIFICATION' as const,
        visibilityStatus: 'PUBLIC' as const,
        createdByUserId: user?.id || null,
        claimedByUserId: null,
        verifiedByAdminId: null,
        verifiedAt: null,
        rejectionReason: null,
        submissionAdminNotes: null,
        lastReviewedAt: null,
        // Promotion fields
        promoActive: false,
        promoExploreCategories: [] as string[],
        promoMapBoost: false,
        promoPriority: 50,
        promoStartAt: null,
        promoEndAt: null,
        promoRotationWeight: 1,
        promoStatus: 'none' as const,
        // Popularity tracking fields
        clicks30d: 0,
        saves30d: 0,
        messages30d: 0,
        popularityScore: 0,
        // Monetization hook
        isPaidPromotion: false,
        promotionTier: 'none' as const,
        // Seeded listing fields - user submissions need verification
        seededListing: false,
        importSource: 'user_submission' as const,
        confidenceLevel: 'medium' as const,
        approvalStatus: 'pending' as const,
        visibility: 'public' as const,
        claimingDisabled: false,
        reviewsEnabled: false,
        messagingEnabled: false,
        showStatusBanner: true,
        statusBannerText: 'This Farmstand is pending verification',
        statusBannerType: 'neutral' as const,
        createdByRole: 'guest' as const,
        // Location mode fields
        locationMode: locationData.locationMode,
        areaType: locationData.areaType || null,
        crossStreet1: locationData.crossStreet1 || null,
        crossStreet2: locationData.crossStreet2 || null,
        genericAreaText: locationData.genericAreaText || null,
        nearestCityState: finalNearestCityState,
        pinSource: finalPinSource,
        // Approximate location fields
        useApproximateLocation: isApproximate,
        approxLocationText: finalApproxText,
        optionalNearestCityState: finalNearestCityState,
        locationPrecision: finalLocationPrecision,
        geocodeProvider: locationData.geoSource === 'GEOCODED' ? ('expo' as const) : null,
        geocodeConfidence: locationData.geocodeConfidence,
        pinAdjustedByUser: locationData.pinAdjustedByUser,
        adminReviewReason: isApproximate ? 'approx_location' : null,
        // Hero image fields - upload photo first if present so it's included in the INSERT
        // IMPORTANT: These are ONLY set to valid Storage URLs (https://...), NEVER file:// URIs
        heroPhotoUrl: null,
        aiPhotoUrl: null,
        heroImageUrl: null,
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
        slug: null,
        // Premium fields
        premiumStatus: 'free' as const,
        premiumTrialStartedAt: null,
        premiumTrialExpiresAt: null,
        isSeasonal: false,
        videoUrl: null,
        videoPath: null,
        videoDurationSeconds: null,
      };

      // Upload photo first (before insert) so the URL can be included in the initial row.
      // This avoids a separate UPDATE call which fails due to RLS policies on farmstands.
      let preUploadedPhotoUrl: string | null = null;
      let photoUploadFailed = false;
      if (photoUri) {
        const tempId = generateTempId();
        preUploadedPhotoUrl = await uploadFarmstandPhoto(tempId);
        if (preUploadedPhotoUrl) {
          if (__DEV__) console.log('[Onboarding] Photo pre-uploaded, URL will be included in INSERT:', preUploadedPhotoUrl);
        } else {
          photoUploadFailed = true;
        }
      }

      // Create farmstand in Supabase (status='pending')
      // createAdminFarmstand now inserts directly to Supabase
      const newFarmstandId = await createAdminFarmstand({
        ...farmstandData,
        ...(preUploadedPhotoUrl ? {
          heroPhotoUrl: preUploadedPhotoUrl,
          heroImageUrl: preUploadedPhotoUrl,
          aiPhotoUrl: preUploadedPhotoUrl,
          photoUrl: preUploadedPhotoUrl,
          imageUrl: preUploadedPhotoUrl,
          photos: [preUploadedPhotoUrl],
        } : {}),
      });

      // Photo was already uploaded and included in the INSERT above.
      // No separate UPDATE needed (avoids RLS 403 errors).

      setIsSubmitting(false);

      const photoNote = photoUploadFailed
        ? '\n\nFarmstand saved, but photo upload failed. You can add a photo later.'
        : '';

      // If logged in user wants to claim ownership, navigate to farmstand and open claim modal
      if (isLoggedIn && wantsToClaimOwnership && newFarmstandId && user?.id) {
        Alert.alert(
          'Farmstand Created',
          `Your farmstand has been submitted. Now complete the claim request by uploading photo evidence.${photoNote}`,
          [
            {
              text: 'Claim Now',
              onPress: () => {
                router.replace({
                  pathname: '/farm/[id]',
                  params: { id: newFarmstandId, openClaimModal: 'true' },
                });
              },
            },
            {
              text: 'Later',
              style: 'cancel',
              onPress: () => {
                router.replace('/(tabs)/map');
              },
            },
          ]
        );
      } else {
        Alert.alert(
          'Thanks! Your submission was received.',
          `The Farmstand is currently under review. It will be visible on the map once approved by the Farmstand team.${photoNote}`,
          [
            {
              text: 'Done',
              onPress: () => {
                router.replace('/(tabs)/map');
              },
            },
          ]
        );
      }
    } catch (error) {
      console.error('Error creating farmstand:', error);
      setIsSubmitting(false);
      const errorMessage = error instanceof Error ? error.message : 'Failed to create farmstand. Please try again.';
      Alert.alert('Could not create farmstand', errorMessage);
    }
  }, [farmName, hasProducts, acknowledgedDisclaimer, isLoggedIn, wantsToClaimOwnership, locationData, isGuestUser, user, selectedCategories, otherProducts, photoUri, createAdminFarmstand, uploadFarmstandPhoto, generateTempId, loadAlerts, router, internalContactPhone, internalContactEmail]);

  const renderForm = () => (
    <View className="px-5">
      {/* Hero Section - Airbnb style with larger, bolder typography */}
      <Animated.View entering={FadeInDown.delay(0).springify()} className="mb-6">
        <Text className="text-charcoal font-bold text-3xl">
          Add a Farmstand
        </Text>
        <Text className="text-wood mt-2 text-base leading-6">
          Tell us about the farmstand and what they sell.
        </Text>
      </Animated.View>

      {/* Farmstand Name - Required */}
      <Animated.View entering={FadeInDown.delay(100).springify()}>
        <SectionCard>
          <FormInput
            label="Farmstand Name"
            value={farmName}
            onChangeText={setFarmName}
            placeholder="e.g., Sunny Acres Farm Stand"
            required
            autoCapitalize="words"
          />

          {/* Add Photo Button */}
          <Pressable
            onPress={onAddPhotoPress}
            disabled={photoSaving}
            className="mt-2"
            style={{
              borderWidth: 1,
              borderColor: '#E6E6E6',
              backgroundColor: '#FFFFFF',
              borderRadius: 16,
              padding: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 12,
                backgroundColor: '#F3F3F3',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={{ width: 56, height: 56 }} />
              ) : (
                <Camera size={24} color="#7A7A7A" />
              )}
            </View>

            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: '#1F1F1F', fontSize: 16 }}>
                {photoUri ? 'Change Photo' : 'Add Photo'}
              </Text>
              <Text style={{ color: '#7A7A7A', marginTop: 2, fontSize: 13 }}>
                {photoSaving ? 'Saving photo...' : 'Take a photo or choose from library'}
              </Text>
            </View>

            {photoSaving ? (
              <ActivityIndicator size="small" color="#1F6B4E" />
            ) : (
              <Text style={{ color: '#1F6B4E', fontWeight: '700', fontSize: 20 }}>+</Text>
            )}
          </Pressable>
        </SectionCard>
      </Animated.View>

      {/* Product Categories - Multi-select chips */}
      <Animated.View entering={FadeInDown.delay(150).springify()}>
        <SectionCard>
          <Text className="text-charcoal font-semibold text-base mb-1">
            Product Categories
            <Text className="text-forest"> *</Text>
          </Text>
          <Text className="text-wood text-sm mb-4">
            Select all that apply
          </Text>

          <View className="flex-row flex-wrap">
            {PRODUCT_CATEGORIES.map((category, index) => {
              const isSelected = selectedCategories.includes(category);
              return (
                <Animated.View
                  key={category}
                  entering={FadeInUp.delay(index * 30).springify()}
                >
                  <Pressable
                    onPress={() => toggleCategory(category)}
                    className={`px-4 py-3 rounded-full mr-2 mb-3 border-2 ${
                      isSelected
                        ? 'bg-forest border-forest'
                        : 'bg-white border-sand/60'
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
        </SectionCard>
      </Animated.View>

      {/* Other Products - Chip entry */}
      <Animated.View entering={FadeInDown.delay(200).springify()}>
        <SectionCard>
          <Text className="text-charcoal font-semibold text-base mb-1">
            Other Products
          </Text>
          <Text className="text-wood text-sm mb-4">
            Add individual items not in categories above
          </Text>

          {/* Input with Add button */}
          <View className="flex-row items-center mb-3">
            <TextInput
              className="flex-1 bg-cream/60 rounded-xl px-4 py-3 text-charcoal border border-sand/60 text-base"
              value={otherProductInput}
              onChangeText={setOtherProductInput}
              placeholder="e.g., Maple Syrup"
              placeholderTextColor="#A89080"
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={addOtherProduct}
            />
            <Pressable
              onPress={addOtherProduct}
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
              <Plus size={22} color={otherProductInput.trim() ? '#FDF8F3' : '#A89080'} />
            </Pressable>
          </View>

          {/* Other products chips */}
          {otherProducts.length > 0 && (
            <View className="flex-row flex-wrap mt-2">
              {otherProducts.map((product, index) => (
                <Animated.View
                  key={`${product}-${index}`}
                  entering={FadeInUp.delay(index * 30).springify()}
                >
                  <Pressable
                    onPress={() => removeOtherProduct(product)}
                    className="flex-row items-center px-4 py-2.5 rounded-full mr-2 mb-2 bg-rust/10 border border-rust/30"
                  >
                    <Text className="text-rust font-medium mr-2">{product}</Text>
                    <X size={14} color="#C45C3E" />
                  </Pressable>
                </Animated.View>
              ))}
            </View>
          )}
        </SectionCard>
      </Animated.View>

      {/* Location Card - Using the unified LocationInput component */}
      <Animated.View entering={FadeInDown.delay(250).springify()}>
        <SectionCard>
          <LocationInput
            ref={locationInputRef}
            value={locationData}
            onChange={(data) => {
              setLocationData(data);
              // Clear inline errors as the user edits location
              if (showValidationErrors) setShowValidationErrors(false);
            }}
            userRole={isGuestUser ? 'guest' : 'farmer'}
            initialRegion={
              params.prefillLat && params.prefillLng
                ? {
                    latitude: parseFloat(params.prefillLat),
                    longitude: parseFloat(params.prefillLng),
                    latitudeDelta: 0.1,
                    longitudeDelta: 0.1,
                  }
                : undefined
            }
            labels={{
              title: 'Location',
              subtitle: 'Help people find this farmstand.',
            }}
          />

          {/* Inline validation banner — shown after a failed submit attempt */}
          {showValidationErrors && validateLocationData(locationData) ? (
            <Animated.View
              entering={FadeInDown.delay(100).springify()}
              className="flex-row items-start gap-3 mt-4 p-3.5 rounded-xl bg-red-50 border border-red-200"
            >
              <AlertTriangle size={16} color="#DC2626" style={{ marginTop: 1 }} />
              <Text className="flex-1 text-sm text-red-700 leading-5">
                Address, city, state, ZIP, and map location are required.
              </Text>
            </Animated.View>
          ) : showValidationErrors ? (
            <Animated.View
              entering={FadeInDown.delay(100).springify()}
              className="flex-row items-center gap-3 mt-4 p-3.5 rounded-xl bg-green-50 border border-green-200"
            >
              <CheckCircle2 size={16} color="#16A34A" />
              <Text className="flex-1 text-sm text-green-700">Location looks good.</Text>
            </Animated.View>
          ) : null}
        </SectionCard>
      </Animated.View>

      {/* Internal Contact Fields — Admin-only, not shown publicly */}
      <Animated.View entering={FadeInDown.delay(280).springify()}>
        <SectionCard>
          <Text className="text-charcoal font-semibold text-base mb-1">
            Contact Info <Text className="text-wood font-normal">(optional)</Text>
          </Text>
          <Text className="text-wood text-sm mb-4">
            Private and only used internally by Farmstand.
          </Text>

          {/* Contact Phone */}
          <View className="mb-4">
            <Text className="text-charcoal font-medium mb-2 text-sm">
              Contact Phone <Text className="text-wood font-normal">(optional)</Text>
            </Text>
            <TextInput
              className="bg-cream/60 rounded-xl px-4 py-4 text-charcoal border border-sand/60 text-base"
              value={internalContactPhone}
              onChangeText={(text) => setInternalContactPhone(formatPhoneNumber(text))}
              placeholder="(541) 555-0123"
              placeholderTextColor="#A89080"
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              autoCorrect={false}
              maxLength={14}
              blurOnSubmit
            />
            <Text className="text-wood text-xs mt-1.5 leading-4">
              This is private and only used by Farmstand to contact the stand owner.
            </Text>
          </View>

          {/* Contact Email */}
          <View>
            <Text className="text-charcoal font-medium mb-2 text-sm">
              Contact Email <Text className="text-wood font-normal">(optional)</Text>
            </Text>
            <TextInput
              className={`bg-cream/60 rounded-xl px-4 py-4 text-charcoal border text-base ${
                internalEmailError ? 'border-red-400' : 'border-sand/60'
              }`}
              value={internalContactEmail}
              onChangeText={(text) => {
                setInternalContactEmail(text);
                if (internalEmailError) setInternalEmailError('');
              }}
              placeholder="e.g., owner@example.com"
              placeholderTextColor="#A89080"
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect={false}
              blurOnSubmit
            />
            {internalEmailError ? (
              <Text className="text-red-500 text-xs mt-1.5 leading-4">{internalEmailError}</Text>
            ) : (
              <Text className="text-wood text-xs mt-1.5 leading-4">
                This is private and only used by Farmstand to contact the stand owner.
              </Text>
            )}
          </View>
        </SectionCard>
      </Animated.View>

      {/* Ownership Checkbox - Different behavior for guest vs logged-in */}
      <Animated.View entering={FadeInDown.delay(300).springify()}>
        <SectionCard>
          {isLoggedIn ? (
            // Logged-in user: Optional claim ownership checkbox
            <View>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setWantsToClaimOwnership(!wantsToClaimOwnership);
                }}
                className="flex-row items-start"
              >
                <View
                  className={`w-6 h-6 rounded-md border-2 mr-3 mt-0.5 items-center justify-center ${
                    wantsToClaimOwnership ? 'bg-forest border-forest' : 'bg-white border-sand'
                  }`}
                >
                  {wantsToClaimOwnership && <Check size={14} color="#FDF8F3" />}
                </View>
                <Text className="flex-1 text-charcoal text-sm leading-5 font-medium">
                  I am the owner of this Farmstand and would like to claim it.
                </Text>
              </Pressable>
              <Text className="text-wood text-xs mt-2 ml-9 leading-4">
                If unchecked, this Farmstand will be submitted as a public listing.
              </Text>
            </View>
          ) : (
            // Guest user: Required disclaimer checkbox
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setAcknowledgedDisclaimer(!acknowledgedDisclaimer);
              }}
              className="flex-row items-start"
            >
              <View
                className={`w-6 h-6 rounded-md border-2 mr-3 mt-0.5 items-center justify-center ${
                  acknowledgedDisclaimer ? 'bg-forest border-forest' : 'bg-white border-sand'
                }`}
              >
                {acknowledgedDisclaimer && <Check size={14} color="#FDF8F3" />}
              </View>
              <Text className="flex-1 text-charcoal text-sm leading-5">
                I understand that adding a Farmstand does NOT mean I own or manage it. Ownership must be claimed and verified separately.
              </Text>
            </Pressable>
          )}
        </SectionCard>
      </Animated.View>
    </View>
  );

  return (
    <View className="flex-1 bg-cream">
      {/* Header - Clean, minimal Airbnb style */}
      <SafeAreaView edges={['top']} className="bg-cream">
        <View className="flex-row items-center justify-between px-4 py-3">
          <Pressable
            onPress={() => router.back()}
            className="w-10 h-10 items-center justify-center rounded-full bg-sand/40 active:bg-sand/60"
          >
            <X size={22} color="#5C4033" />
          </Pressable>
          <View className="flex-1 items-center">
            <Text className="text-charcoal font-semibold text-base">Add Farmstand</Text>
          </View>
          <View className="w-10" />
        </View>
      </SafeAreaView>

      {/* Content */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
        keyboardVerticalOffset={0}
      >
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 20, paddingTop: 8 }}
        >
          {renderForm()}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Bottom Action Bar */}
      <SafeAreaView
        edges={['bottom']}
        className="bg-white border-t border-sand/40"
        style={{
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.05,
          shadowRadius: 8,
          elevation: 8,
        }}
      >
        <View className="flex-row px-4 py-4" style={{ gap: 12 }}>
          <Pressable
            onPress={() => {
              if (!canSubmit && !isSubmitting) {
                // Activate inline error hints when user taps disabled button
                setShowValidationErrors(true);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              } else {
                handleSubmit();
              }
            }}
            disabled={isSubmitting}
            className={`flex-1 flex-row items-center justify-center rounded-2xl ${
              isSubmitting || !canSubmit ? 'bg-sand' : 'bg-forest active:bg-forest/90'
            }`}
            style={{
              height: 56,
              shadowColor: '#2D5A3D',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: isSubmitting || !canSubmit ? 0 : 0.3,
              shadowRadius: 8,
              elevation: isSubmitting || !canSubmit ? 0 : 4,
            }}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#FDF8F3" />
            ) : (
              <Text className={`font-semibold text-base ${canSubmit ? 'text-cream' : 'text-wood'}`}>
                Submit Farmstand
              </Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
