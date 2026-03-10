import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  TextInput,
  ScrollView,
  Image,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  X,
  ShieldCheck,
  MapPin,
  CheckCircle,
  AlertCircle,
  UserCheck,
  LogIn,
  Camera,
  ImagePlus,
  Trash2,
  Clock,
  Square,
  CheckSquare,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useAdminStore } from '@/lib/admin-store';
import { Farmstand } from '@/lib/farmer-store';
import { useUserStore } from '@/lib/user-store';
import { logClaimRequest } from '@/lib/analytics-events';
import { uploadToSupabaseStorage, getValidSession } from '@/lib/supabase';
import { LegalModal } from '@/components/LegalModal';

const BUCKET = "claim-evidence";

interface ClaimFarmstandFormProps {
  farmstand: Farmstand;
  userId: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

type ClaimState = 'loading' | 'unclaimed' | 'claimed_by_you' | 'claimed_by_other' | 'pending_request' | 'error';

export function ClaimFarmstandForm({
  farmstand,
  userId,
  onClose,
  onSuccess,
}: ClaimFarmstandFormProps) {
  const router = useRouter();
  const submitClaimRequest = useAdminStore((s) => s.submitClaimRequest);
  // Read claimRequests from a ref to avoid re-running checkClaimStatus on every store update
  const claimRequests = useAdminStore((s) => s.claimRequests);
  const claimRequestsRef = useRef(claimRequests);
  useEffect(() => { claimRequestsRef.current = claimRequests; }, [claimRequests]);
  const user = useUserStore((s) => s.user);

  // Form fields - Full Name MUST be blank, user must type it manually
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(user?.email || '');
  const [evidencePhotos, setEvidencePhotos] = useState<string[]>([]);
  const [note, setNote] = useState('');

  // Legal confirmations
  const [is18Confirmed, setIs18Confirmed] = useState(false);
  const [tosAccepted, setTosAccepted] = useState(false);

  // Legal modal state
  const [legalModalVisible, setLegalModalVisible] = useState(false);
  const [legalModalType, setLegalModalType] = useState<'terms' | 'privacy'>('terms');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimState, setClaimState] = useState<ClaimState>('loading');
  const [claimedByUserId, setClaimedByUserId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  // User must be logged in to claim a farmstand
  const isLoggedIn = !!userId;

  // Auto-fill user email from user store on mount (email only, NOT full name)
  // User must manually enter their full name every time
  useEffect(() => {
    if (isLoggedIn && user) {
      // Email from auth is authoritative (make it read-only in UI)
      if (user.email && !email) {
        setEmail(user.email);
      }
      // DO NOT auto-fill fullName - user must type it manually
      console.log('[ClaimForm] Auto-filled email from user store:', user.email);
    }
  }, [isLoggedIn, user]);

  // Reset state and fetch fresh claim status when modal opens
  // DEPS: only [farmstand.id, userId] — claimRequests accessed via ref to prevent retry storm
  useEffect(() => {
    setError(null);
    setIsSubmitting(false);
    setClaimState('loading');
    setClaimedByUserId(null);
    setUploadProgress(null);

    const checkClaimStatus = async () => {
      // First check if user already has a pending request (read from ref — stable)
      const hasPending = claimRequestsRef.current.some(
        (r) => r.farmstand_id === farmstand.id && r.requester_id === userId && r.status === 'pending'
      );
      console.log('[ClaimState] fetch start', { farmstandId: farmstand.id, authUid: userId });

      if (hasPending) {
        console.log('[ClaimState] fetch result', { derivedState: 'pending_request', claimed_by: null, ownerRow: null, claimRequestStatus: 'pending' });
        setClaimState('pending_request');
        return;
      }

      // Check local farmstand data for claim status
      const isClaimed = farmstand.claimStatus === 'claimed';
      const ownerId = farmstand.ownerUserId;

      let derivedState: ClaimState;
      if (isClaimed && ownerId) {
        setClaimedByUserId(ownerId);
        if (ownerId === userId) {
          derivedState = 'claimed_by_you';
        } else {
          derivedState = 'claimed_by_other';
        }
      } else {
        setClaimedByUserId(null);
        derivedState = 'unclaimed';
      }

      console.log('[ClaimState] fetch result', { derivedState, claimed_by: farmstand.claimStatus, ownerRow: ownerId, claimRequestStatus: 'none' });
      setClaimState(derivedState);
    };

    checkClaimStatus();
  }, [farmstand.id, userId]);

  // Handle login redirect
  const handleLoginRedirect = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
    router.push('/auth/login');
  };

  // Pick photo from library
  const pickPhoto = async () => {
    if (evidencePhotos.length >= 3) {
      Alert.alert('Maximum Photos', 'You can upload up to 3 photos.');
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your photo library to upload evidence.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsMultipleSelection: true,
      selectionLimit: 3 - evidencePhotos.length,
      quality: 0.8,
    });

    if (!result.canceled && result.assets) {
      const newPhotos = result.assets.map((asset) => asset.uri);
      setEvidencePhotos((prev) => [...prev, ...newPhotos].slice(0, 3));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  // Take photo with camera
  const takePhoto = async () => {
    if (evidencePhotos.length >= 3) {
      Alert.alert('Maximum Photos', 'You can upload up to 3 photos.');
      return;
    }

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your camera to take photos.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setEvidencePhotos((prev) => [...prev, result.assets[0].uri].slice(0, 3));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  // Remove photo
  const removePhoto = (index: number) => {
    setEvidencePhotos((prev) => prev.filter((_, i) => i !== index));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // Check if submit is enabled — all required fields must be filled
  const hasName = !!fullName?.trim();
  const hasEmail = !!email?.trim();
  const hasMinPhotos = (evidencePhotos?.length ?? 0) >= 1; // only require 1
  const submitEnabled = hasName && hasEmail && hasMinPhotos && is18Confirmed && tosAccepted;

  // Validate form
  const validateForm = (): string | null => {
    if (!fullName.trim()) {
      return 'Please enter your full name.';
    }
    if (!email.trim()) {
      return 'Please enter your email address.';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return 'Please enter a valid email address.';
    }
    if (evidencePhotos.length === 0) {
      return 'Please upload at least one photo as evidence.';
    }
    if (!is18Confirmed || !tosAccepted) {
      return 'Please confirm both items to continue.';
    }
    return null;
  };

  // Handle submit
  const handleSubmit = async () => {
    if (!isLoggedIn || !userId) {
      handleLoginRedirect();
      return;
    }

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    // Step 1: Verify session before doing anything
    const session = await getValidSession();
    const sessionUserId = userId; // userId comes from the store which is set on login
    console.log('[CLAIM] sessionErr: none (using getValidSession)');
    console.log('[CLAIM] session user:', sessionUserId, user?.email);
    if (!session?.access_token || !sessionUserId) {
      Alert.alert('Claim failed', 'No session/user. Please sign in again.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      let uploadedUrls: string[] = [];

      // Upload images to Supabase Storage
      setUploadProgress('Uploading photos...');
      for (let i = 0; i < (evidencePhotos?.length || 0); i++) {
        const uri = evidencePhotos[i];
        if (!uri) continue;

        const filePath = `claims/${sessionUserId}/${farmstand.id}/${Date.now()}-${i}.jpg`;

        const { url, error: uploadError } = await uploadToSupabaseStorage(
          BUCKET,
          filePath,
          uri,
          'image/jpeg'
        );

        if (uploadError) {
          console.error("Upload error:", uploadError);
          throw uploadError;
        }

        if (url) {
          uploadedUrls.push(url);
        }
      }

      setUploadProgress('Submitting claim request...');

      const requesterName = user?.name ?? fullName.trim();
      const requesterEmail = user?.email ?? email.trim().toLowerCase();

      // Submit via admin store (handles RPC + fallback logic internally)
      const result = await submitClaimRequest({
        farmstand_id: farmstand.id,
        requester_id: sessionUserId,
        requester_name: requesterName,
        requester_email: requesterEmail,
        evidence_urls: uploadedUrls,
        notes: note?.trim() || null,
      });

      console.log('[CLAIM] submitClaimRequest result:', result);

      if (!result.success) {
        const msg = result.error ?? 'Failed to submit claim request.';
        console.error('[CLAIM] Submit failed:', msg);
        setError(msg);
        Alert.alert('Claim submission failed', msg);
        return;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      logClaimRequest(farmstand.id, sessionUserId);
      setClaimState('pending_request');
    } catch (err: any) {
      console.error('[ClaimForm] Submit error:', err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg = err?.message ?? 'An unexpected error occurred. Please try again.';
      Alert.alert('Claim error', msg);
      setError(msg);
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  };

  // Derived states
  const isLoading = claimState === 'loading';
  const isClaimedByOther = claimState === 'claimed_by_other';
  const isClaimedByYou = claimState === 'claimed_by_you';
  const isUnclaimed = claimState === 'unclaimed';
  const isPendingRequest = claimState === 'pending_request';

  // Debug log whenever submit-gate values change
  useEffect(() => {
    console.log('[ClaimSubmitState]', {
      hasName: !!fullName?.trim(),
      hasEmail: !!email?.trim(),
      photos: evidencePhotos?.length,
      is18Confirmed,
      tosAccepted,
      isLoading,
      isSubmitting,
      submitEnabled,
    });
  }, [fullName, email, evidencePhotos, is18Confirmed, tosAccepted, isLoading, isSubmitting, submitEnabled]);

  return (
    <SafeAreaView className="flex-1 bg-cream">
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4 border-b border-sand">
        <Pressable onPress={onClose} hitSlop={8}>
          <X size={24} color="#3D3D3D" />
        </Pressable>
        <Text className="text-charcoal font-bold text-lg">
          {isPendingRequest ? 'Claim Submitted' : 'Verify Ownership'}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {/* ------------------------------------------------------------------ */}
      {/* SUCCESS SCREEN — shown after a successful claim submission          */}
      {/* ------------------------------------------------------------------ */}
      {isPendingRequest ? (
        <View className="flex-1 items-center justify-center px-8">
          {/* Icon */}
          <View className="w-24 h-24 rounded-full bg-forest/10 items-center justify-center mb-6">
            <CheckCircle size={52} color="#2D5A3D" />
          </View>

          {/* Title */}
          <Text className="text-charcoal font-bold text-2xl text-center mb-3">
            Claim Submitted
          </Text>

          {/* Body */}
          <Text className="text-wood text-base text-center leading-6 mb-10">
            Your request to claim this Farmstand has been sent for review. You will be notified when the claim is approved.
          </Text>

          {/* Back to Map */}
          <Pressable
            onPress={() => {
              onClose();
              router.push('/(tabs)/map');
            }}
            className="w-full py-4 rounded-2xl items-center justify-center bg-forest mb-3"
            style={{ shadowColor: '#2D5A3D', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 4 }}
          >
            <Text className="text-cream font-semibold text-base">Back to Map</Text>
          </Pressable>

          {/* View My Profile */}
          <Pressable
            onPress={() => {
              onClose();
              router.push('/(tabs)/profile');
            }}
            className="w-full py-4 rounded-2xl items-center justify-center border border-forest/40 bg-transparent"
          >
            <Text className="text-forest font-semibold text-base">View My Profile</Text>
          </Pressable>
        </View>
      ) : (
        <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={80}
        className="flex-1"
      >
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 20 }}>
        {/* Loading state */}
        {isLoading ? (
          <View className="items-center py-20">
            <ActivityIndicator size="large" color="#2D5A3D" />
            <Text className="text-wood mt-4 text-base">Checking availability...</Text>
          </View>
        ) : (
          <>
            {/* Farmstand Info */}
            <View className="items-center mb-6">
              <View
                className={`p-4 rounded-full mb-4 ${
                  isClaimedByOther
                    ? 'bg-red-100'
                    : isClaimedByYou
                    ? 'bg-blue-100'
                    : isPendingRequest
                    ? 'bg-amber-100'
                    : 'bg-forest/10'
                }`}
              >
                {isClaimedByOther ? (
                  <AlertCircle size={48} color="#DC2626" />
                ) : isClaimedByYou ? (
                  <UserCheck size={48} color="#2563EB" />
                ) : isPendingRequest ? (
                  <Clock size={48} color="#D97706" />
                ) : (
                  <ShieldCheck size={48} color="#2D5A3D" />
                )}
              </View>
              <Text className="text-charcoal font-bold text-xl text-center mb-1">
                {farmstand.name}
              </Text>
              <View className="flex-row items-center">
                <MapPin size={14} color="#8B6F4E" />
                <Text className="text-wood ml-1 text-sm">
                  {farmstand.city}, {farmstand.state}
                </Text>
              </View>
            </View>

            {/* Pending Request Success State */}
            {isPendingRequest && (
              <View className="bg-amber-50 border border-amber-300 rounded-2xl p-5 mb-6">
                <View className="flex-row items-center mb-2">
                  <Clock size={20} color="#D97706" />
                  <Text className="text-amber-800 font-semibold ml-2 text-base">
                    Claim Request Pending
                  </Text>
                </View>
                <Text className="text-amber-700 text-sm leading-5">
                  Your claim request has been submitted! Our team will review your evidence and
                  notify you at {email || 'your email'} once approved.
                </Text>
              </View>
            )}

            {/* Already Claimed by You */}
            {isClaimedByYou && (
              <View className="bg-blue-50 border border-blue-200 rounded-2xl p-5 mb-6">
                <View className="flex-row items-center mb-2">
                  <UserCheck size={20} color="#2563EB" />
                  <Text className="text-blue-700 font-semibold ml-2 text-base">
                    You Own This Farmstand
                  </Text>
                </View>
                <Text className="text-blue-600 text-sm leading-5">
                  You have already claimed this farmstand. Go to your dashboard to manage it.
                </Text>
              </View>
            )}

            {/* Already Claimed by Another User */}
            {isClaimedByOther && isLoggedIn && (
              <View className="bg-red-50 border border-red-200 rounded-2xl p-5 mb-6">
                <View className="flex-row items-center mb-2">
                  <AlertCircle size={20} color="#DC2626" />
                  <Text className="text-red-700 font-semibold ml-2 text-base">
                    Already Claimed
                  </Text>
                </View>
                <Text className="text-red-600 text-sm leading-5">
                  This farmstand has already been claimed by another user. If you believe this is
                  an error, please contact support.
                </Text>
              </View>
            )}

            {/* Login Required */}
            {!isLoggedIn && (
              <View className="bg-amber-50 border border-amber-300 rounded-xl p-4 mb-6">
                <Text className="text-amber-800 font-semibold mb-1">Login Required</Text>
                <Text className="text-amber-700 text-sm">
                  Please log in to claim this farmstand.
                </Text>
              </View>
            )}

            {/* Claim Form - Only show if unclaimed and logged in */}
            {isUnclaimed && isLoggedIn && (
              <>
                {/* Info Box */}
                <View className="bg-mint/20 border border-forest/20 rounded-2xl p-4 mb-6">
                  <View className="flex-row items-center mb-2">
                    <CheckCircle size={18} color="#2D5A3D" />
                    <Text className="text-forest font-semibold ml-2 text-sm">
                      Verify Your Ownership
                    </Text>
                  </View>
                  <Text className="text-bark text-sm leading-5">
                    Submit your information and photo evidence to claim this farmstand. Our team
                    will review and approve your request.
                  </Text>
                </View>

                {/* Full Name Input */}
                <View className="mb-4">
                  <Text className="text-charcoal font-semibold mb-2">
                    Full Name <Text className="text-red-500">*</Text>
                  </Text>
                  <TextInput
                    value={fullName}
                    onChangeText={setFullName}
                    placeholder="Enter your full name"
                    placeholderTextColor="#9CA3AF"
                    className="bg-white border border-sand rounded-xl px-4 py-3.5 text-charcoal text-base"
                    autoCapitalize="words"
                    editable={!isSubmitting}
                  />
                </View>

                {/* Email Input - Read-only from auth */}
                <View className="mb-4">
                  <Text className="text-charcoal font-semibold mb-2">
                    Email <Text className="text-red-500">*</Text>
                  </Text>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    placeholder="Enter your email address"
                    placeholderTextColor="#9CA3AF"
                    className={`border border-sand rounded-xl px-4 py-3.5 text-charcoal text-base ${
                      user?.email ? 'bg-gray-100' : 'bg-white'
                    }`}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isSubmitting && !user?.email}
                  />
                  {user?.email && (
                    <Text className="text-wood text-xs mt-1">
                      Email from your account (cannot be changed)
                    </Text>
                  )}
                </View>

                {/* Photo Evidence */}
                <View className="mb-4">
                  <Text className="text-charcoal font-semibold mb-2">
                    Photo Evidence <Text className="text-red-500">*</Text>
                  </Text>
                  <Text className="text-wood text-sm mb-3">
                    Upload 1-3 photos that prove you own or manage this farmstand (sign, stand,
                    products, business card, etc.)
                  </Text>

                  {/* Photo Grid */}
                  <View className="flex-row flex-wrap gap-3 mb-3">
                    {evidencePhotos.map((uri, index) => (
                      <View key={index} className="relative">
                        <Image
                          source={{ uri }}
                          className="w-24 h-24 rounded-xl"
                          resizeMode="cover"
                        />
                        <Pressable
                          onPress={() => removePhoto(index)}
                          disabled={isSubmitting}
                          className="absolute -top-2 -right-2 bg-red-500 rounded-full p-1"
                        >
                          <Trash2 size={14} color="white" />
                        </Pressable>
                      </View>
                    ))}

                    {/* Add Photo Buttons */}
                    {evidencePhotos.length < 3 && (
                      <View className="flex-row gap-3">
                        <Pressable
                          onPress={pickPhoto}
                          disabled={isSubmitting}
                          className="w-24 h-24 rounded-xl border-2 border-dashed border-sand items-center justify-center bg-white"
                        >
                          <ImagePlus size={28} color="#8B6F4E" />
                          <Text className="text-wood text-xs mt-1">Library</Text>
                        </Pressable>
                        <Pressable
                          onPress={takePhoto}
                          disabled={isSubmitting}
                          className="w-24 h-24 rounded-xl border-2 border-dashed border-sand items-center justify-center bg-white"
                        >
                          <Camera size={28} color="#8B6F4E" />
                          <Text className="text-wood text-xs mt-1">Camera</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>

                  <Text className="text-wood text-xs">
                    {evidencePhotos.length}/3 photos uploaded
                  </Text>
                </View>

                {/* Optional Note */}
                <View className="mb-4">
                  <Text className="text-charcoal font-semibold mb-2">
                    Additional Notes <Text className="text-wood text-xs font-normal">(optional)</Text>
                  </Text>
                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    placeholder="Any additional information about your ownership..."
                    placeholderTextColor="#9CA3AF"
                    className="bg-white border border-sand rounded-xl px-4 py-3.5 text-charcoal text-base"
                    multiline
                    numberOfLines={4}
                    scrollEnabled
                    style={{ minHeight: 100, maxHeight: 150, textAlignVertical: 'top' }}
                    editable={!isSubmitting}
                  />
                </View>

                {/* Legal Confirmations */}
                <View className="mb-4 mt-2">
                  {/* Age Confirmation */}
                  <Pressable
                    onPress={() => {
                      setIs18Confirmed(!is18Confirmed);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    disabled={isSubmitting}
                    className="flex-row items-start mb-3"
                  >
                    <View className="mt-0.5">
                      {is18Confirmed ? (
                        <CheckSquare size={22} color="#2D5A3D" />
                      ) : (
                        <Square size={22} color="#8B6F4E" />
                      )}
                    </View>
                    <Text className="text-charcoal text-sm ml-3 flex-1 leading-5">
                      I confirm I am 18 years of age or older and legally authorized to claim this Farmstand.
                    </Text>
                  </Pressable>

                  {/* Terms & Privacy Acceptance */}
                  <Pressable
                    onPress={() => {
                      setTosAccepted(!tosAccepted);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    disabled={isSubmitting}
                    className="flex-row items-start"
                  >
                    <View className="mt-0.5">
                      {tosAccepted ? (
                        <CheckSquare size={22} color="#2D5A3D" />
                      ) : (
                        <Square size={22} color="#8B6F4E" />
                      )}
                    </View>
                    <Text className="text-charcoal text-sm ml-3 flex-1 leading-5">
                      I agree to the{' '}
                      <Text
                        className="text-forest font-semibold"
                        onPress={() => {
                          setLegalModalType('terms');
                          setLegalModalVisible(true);
                        }}
                      >
                        Terms of Service
                      </Text>
                      {' '}and{' '}
                      <Text
                        className="text-forest font-semibold"
                        onPress={() => {
                          setLegalModalType('privacy');
                          setLegalModalVisible(true);
                        }}
                      >
                        Privacy Policy
                      </Text>
                      .
                    </Text>
                  </Pressable>
                </View>

                {/* Error Message */}
                {error && (
                  <View className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
                    <Text className="text-red-700 text-sm">{error}</Text>
                  </View>
                )}

                {/* Upload Progress */}
                {uploadProgress && (
                  <View className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
                    <View className="flex-row items-center">
                      <ActivityIndicator size="small" color="#2563EB" />
                      <Text className="text-blue-700 text-sm ml-2">{uploadProgress}</Text>
                    </View>
                  </View>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
      )}

      {/* Bottom Action Button */}
      <View className="px-5 pb-6 pt-4 border-t border-sand bg-cream">
        {/* Show "Log In" button if user is not logged in */}
        {!isLoggedIn ? (
          <Pressable
            onPress={handleLoginRedirect}
            className="py-4 rounded-xl flex-row items-center justify-center bg-forest"
          >
            <LogIn size={20} color="#FDF8F3" />
            <Text className="ml-2 font-semibold text-base text-cream">Log In to Claim</Text>
          </Pressable>
        ) : isPendingRequest ? (
          <Pressable
            onPress={onClose}
            className="py-4 rounded-xl flex-row items-center justify-center bg-forest"
          >
            <Text className="font-semibold text-base text-cream">Done</Text>
          </Pressable>
        ) : isClaimedByOther || isClaimedByYou ? (
          <Pressable
            onPress={onClose}
            className="py-4 rounded-xl flex-row items-center justify-center bg-gray-200"
          >
            <Text className="text-gray-600 font-semibold text-base">Close</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleSubmit}
            disabled={isSubmitting || isLoading || !submitEnabled}
            className={`py-4 rounded-xl flex-row items-center justify-center ${
              isSubmitting || isLoading || !submitEnabled ? 'bg-sand' : 'bg-forest'
            }`}
          >
            {isSubmitting || isLoading ? (
              <ActivityIndicator color="#FDF8F3" />
            ) : (
              <>
                <ShieldCheck size={20} color={submitEnabled ? "#FDF8F3" : "#9CA3AF"} />
                <Text className={`ml-2 font-semibold text-base ${submitEnabled ? 'text-cream' : 'text-gray-400'}`}>
                  Submit Claim Request
                </Text>
              </>
            )}
          </Pressable>
        )}
        {isUnclaimed && isLoggedIn && !isPendingRequest && (
          <Text className="text-wood text-xs text-center mt-3">
            Our team will review your request and notify you once approved.
          </Text>
        )}
      </View>

      {/* Legal Modal */}
      <LegalModal
        visible={legalModalVisible}
        type={legalModalType}
        onClose={() => setLegalModalVisible(false)}
      />
    </SafeAreaView>
  );
}
