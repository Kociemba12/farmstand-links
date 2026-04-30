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
  MessageCircle,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useAdminStore } from '@/lib/admin-store';
import { Farmstand } from '@/lib/farmer-store';
import { useUserStore } from '@/lib/user-store';
import { logClaimRequest } from '@/lib/analytics-events';
import { uploadToSupabaseStorage, getValidSession, supabase, isSupabaseConfigured } from '@/lib/supabase';
import { LegalModal } from '@/components/LegalModal';

const BUCKET = "claim-evidence";

interface ClaimFarmstandFormProps {
  farmstand: Farmstand;
  userId: string | null;
  forceResubmitMode?: boolean;
  /** claimId from the denial push/alert — used to directly load the denied claim record */
  claimId?: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

type ClaimState = 'loading' | 'unclaimed' | 'claimed_by_you' | 'claimed_by_other' | 'pending_request' | 'resubmitted' | 'needs_more_info' | 'error';

export function ClaimFarmstandForm({
  farmstand,
  userId,
  forceResubmitMode = false,
  claimId: claimIdProp = null,
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
  const [existingClaimId, setExistingClaimId] = useState<string | null>(null);
  // URL-based photos already stored on the existing claim — shown as thumbnails, kept on resubmit
  const [existingEvidenceUrls, setExistingEvidenceUrls] = useState<string[]>([]);

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
  // DEPS: only [farmstand.id, userId, forceResubmitMode] — claimRequests accessed via ref to prevent retry storm
  useEffect(() => {
    setError(null);
    setIsSubmitting(false);
    setClaimState('loading');
    setClaimedByUserId(null);
    setUploadProgress(null);
    setExistingClaimId(null);
    setExistingEvidenceUrls([]);

    const checkClaimStatus = async () => {
      console.log('[ClaimState] fetch start', { farmstandId: farmstand.id, authUid: userId, forceResubmitMode });

      // ── In resubmit mode, fetch claim data from the backend (service-role, bypasses RLS) ──
      if (forceResubmitMode && userId) {
        console.log('[ClaimState] forceResubmitMode — claimIdProp:', claimIdProp, 'userId:', userId, 'farmstandId:', farmstand.id);
        try {
        const session = await getValidSession();
        if (session?.access_token) {
          try {
            const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';
            if (!backendUrl) {
              if (__DEV__) console.log('[ClaimForm] EXPO_PUBLIC_VIBECODE_BACKEND_URL not set — skipping backend fetch, using Supabase direct');
            } else {
              // If we have a specific claimId from the push/alert, append it so the backend
              // can fetch that exact record (including denied claims)
              const claimIdQuery = claimIdProp ? `&claim_id=${claimIdProp}` : '';
              const resp = await fetch(`${backendUrl}/api/my-claim?farmstand_id=${farmstand.id}${claimIdQuery}`, {
                headers: { Authorization: `Bearer ${session.access_token}` },
              });
              console.log('[ClaimState] /api/my-claim status:', resp.status, 'claimIdProp:', claimIdProp);
              const cfct1 = resp.headers.get('content-type') ?? '';
              if (resp.ok && cfct1.includes('application/json')) {
                const data = await resp.json() as { success: boolean; claim: null | {
                  id: string;
                  requester_name: string | null;
                  requester_email: string | null;
                  notes: string | null;
                  evidence_urls: string[];
                  admin_message: string | null;
                  request_more_info: string | null;
                  status: string;
                }};
                console.log('[ClaimState] /api/my-claim result', { found: !!data.claim, status: data.claim?.status, name: data.claim?.requester_name, photos: data.claim?.evidence_urls?.length });
                if (data.success && data.claim) {
                  const claim = data.claim;
                  setExistingClaimId(claim.id);
                  if (claim.requester_name) setFullName(claim.requester_name);
                  if (claim.notes) setNote(claim.notes);
                  setExistingEvidenceUrls(Array.isArray(claim.evidence_urls) ? claim.evidence_urls : []);
                  console.log('[ClaimState] prefilled from backend — claimId:', claim.id, 'status:', claim.status, 'name:', claim.requester_name, 'photos:', claim.evidence_urls?.length);
                  setClaimState('needs_more_info');
                  return;
                }
                // Backend returned success but no claim — show edit form anyway (user can resubmit fresh)
                console.log('[ClaimState] forceResubmitMode: no pending/denied claim from backend, opening edit form fresh');
                setClaimState('needs_more_info');
                return;
              }
            }
          } catch (err) {
            console.log('[ClaimState] /api/my-claim fetch failed, falling back to Supabase direct:', err);
          }
        }
        } catch (err) {
          if (__DEV__) console.log('[ClaimState] forceResubmitMode session/fetch error, falling back:', err);
        }
      }

      // Check Supabase for existing pending/denied claim (source of truth — catches needs_more_info state)
      if (isSupabaseConfigured() && userId) {
        try {
          const { data, error: fetchError } = await supabase
            .from<Record<string, unknown>>('claim_requests')
            .select('id, status, admin_message, request_more_info, requester_name, notes, message, evidence_urls')
            .eq('farmstand_id', farmstand.id)
            .eq('user_id', userId)
            .in('status', ['pending', 'denied'])
            .order('created_at', { ascending: false })
            .limit(1);

          console.log('[ClaimState] Supabase result', { rowCount: data?.length ?? 0, fetchError: !!fetchError, forceResubmitMode });

          if (!fetchError && data && data.length > 0) {
            const row = data[0];
            const hasMoreInfoRequest = !!(row?.admin_message || row?.request_more_info);

            // forceResubmitMode: open edit form even if admin_message was already cleared
            if (forceResubmitMode || hasMoreInfoRequest) {
              console.log('[ClaimState] entering needs_more_info', { forceResubmitMode, hasMoreInfoRequest });
              setExistingClaimId(String(row?.id ?? ''));
              if (row?.requester_name) setFullName(String(row.requester_name));
              // Prefer 'notes' (initial submit) then 'message' (resubmit path) for notes field
              const prefillNote = String(row?.notes || row?.message || '');
              if (prefillNote) setNote(prefillNote);
              const existingUrls = Array.isArray(row?.evidence_urls) ? (row.evidence_urls as string[]) : [];
              setExistingEvidenceUrls(existingUrls);
              console.log('[ClaimState] prefilled from Supabase', { name: row?.requester_name, photoCount: existingUrls.length });
              setClaimState('needs_more_info');
              return;
            }
            console.log('[ClaimState] fetch result: pending_request (no info request, not force-resubmit)');
            setClaimState('pending_request');
            return;
          }

          // forceResubmitMode but no pending claim found — show unclaimed form so user can re-submit
          if (forceResubmitMode) {
            console.log('[ClaimState] forceResubmitMode=true but no pending claim found — opening edit form fresh');
            setClaimState('needs_more_info');
            return;
          }
        } catch (err) {
          console.log('[ClaimState] Supabase check failed, falling back to local store:', err);
        }
      }

      // Fallback: check local store for pending request
      const hasPending = claimRequestsRef.current.some(
        (r) => r.farmstand_id === farmstand.id && r.requester_id === userId && r.status === 'pending'
      );

      if (hasPending) {
        // If forceResubmitMode, treat local-store pending as needs_more_info too
        if (forceResubmitMode) {
          const localClaim = claimRequestsRef.current.find(
            (r) => r.farmstand_id === farmstand.id && r.requester_id === userId && r.status === 'pending'
          );
          if (localClaim) {
            if (localClaim.requester_name) setFullName(localClaim.requester_name);
            if (localClaim.notes) setNote(localClaim.notes);
            if (Array.isArray(localClaim.evidence_urls) && localClaim.evidence_urls.length > 0) {
              setExistingEvidenceUrls(localClaim.evidence_urls);
            }
            console.log('[ClaimState] prefilled from local store', { name: localClaim.requester_name, photoCount: localClaim.evidence_urls?.length });
          }
          console.log('[ClaimState] forceResubmitMode: local store pending → needs_more_info');
          setClaimState('needs_more_info');
          return;
        }
        console.log('[ClaimState] fetch result', { derivedState: 'pending_request', claimRequestStatus: 'pending' });
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

    checkClaimStatus().catch((err) => {
      if (__DEV__) console.log('[ClaimForm] checkClaimStatus unhandled error:', err);
      setClaimState('error');
    });
  }, [farmstand.id, userId, forceResubmitMode]);

  // Handle login redirect
  const handleLoginRedirect = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
    router.push('/auth/login');
  };

  // Pick photo from library
  const pickPhoto = async () => {
    if (totalPhotoCount >= 3) {
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
      selectionLimit: 3 - totalPhotoCount,
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
    if (totalPhotoCount >= 3) {
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

  // Remove an existing URL-based photo (from the previously submitted claim)
  const removeExistingPhoto = (index: number) => {
    setExistingEvidenceUrls((prev) => prev.filter((_, i) => i !== index));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const totalPhotoCount = existingEvidenceUrls.length + evidencePhotos.length;

  // Check if submit is enabled — all required fields must be filled
  const hasName = !!fullName?.trim();
  const hasEmail = !!email?.trim();
  const hasMinPhotos = totalPhotoCount >= 1;
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
    if (totalPhotoCount === 0) {
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

    const session = await getValidSession();
    const sessionUserId = userId;
    if (!session?.access_token || !sessionUserId) {
      Alert.alert('Claim failed', 'No session/user. Please sign in again.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      let uploadedUrls: string[] = [];

      if (__DEV__) console.log('[ClaimForm] uploading', evidencePhotos?.length ?? 0, 'photo(s) for farmstandId:', farmstand.id);
      setUploadProgress('Uploading photos...');
      for (let i = 0; i < (evidencePhotos?.length || 0); i++) {
        const uri = evidencePhotos[i];
        if (!uri) continue;

        if (__DEV__) console.log('[ClaimForm] uploading photo', i, 'uri:', uri.slice(0, 60));

        // Convert and compress to JPEG before upload — handles HEIC/HEIF and large files
        if (__DEV__) console.log('[ClaimForm] photo', i, 'converting/compressing to JPEG (max 1600px, quality 0.82)');
        const compressed = await manipulateAsync(
          uri,
          [{ resize: { width: 1600 } }],
          { compress: 0.82, format: SaveFormat.JPEG },
        );
        if (__DEV__) console.log('[ClaimForm] photo', i, 'converted — uri:', compressed.uri.slice(0, 60), '| dims:', compressed.width, 'x', compressed.height);
        if (__DEV__) console.log('[ClaimForm] photo', i, 'finalMIME: image/jpeg');

        const filePath = `claims/${sessionUserId}/${farmstand.id}/${Date.now()}-${i}.jpg`;
        const { url, error: uploadError } = await uploadToSupabaseStorage(
          BUCKET,
          filePath,
          compressed.uri,
          'image/jpeg',
        );

        if (uploadError) {
          if (__DEV__) console.warn('[ClaimForm] Upload error:', uploadError.message ?? String(uploadError));
          throw new Error(uploadError.message ?? 'Photo upload failed. Please try again.');
        }

        if (url) {
          if (__DEV__) console.log('[ClaimForm] photo', i, 'uploaded OK:', url.slice(0, 80));
          uploadedUrls.push(url);
        }
      }
      if (__DEV__) console.log('[ClaimForm] all uploads done — uploadedUrls.length:', uploadedUrls.length);

      const requesterName = user?.name ?? fullName.trim();
      const requesterEmail = user?.email ?? email.trim().toLowerCase();
      const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';

      if (isNeedsMoreInfo) {
        // Resubmission: update existing claim and reset review fields
        setUploadProgress('Resubmitting claim...');
        const resubmitPayload = {
          farmstand_id: farmstand.id,
          requester_name: requesterName,
          requester_email: requesterEmail,
          evidence_urls: [...existingEvidenceUrls, ...uploadedUrls],
          notes: note?.trim() || null,
        };
        console.log('[CLAIM] resubmit-claim payload:', {
          farmstand_id: farmstand.id,
          userId: sessionUserId,
          existingClaimId,
          claimIdProp,
          evidenceCount: resubmitPayload.evidence_urls.length,
          notes: resubmitPayload.notes,
        });
        const resp = await fetch(`${backendUrl}/api/resubmit-claim`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(resubmitPayload),
        });
        console.log('[CLAIM] resubmit-claim status:', resp.status);
        const cfct2 = resp.headers.get('content-type') ?? '';
        if (!cfct2.includes('application/json')) {
          console.log('[CLAIM] resubmit-claim non-JSON response (HTTP', resp.status, '), content-type:', cfct2);
          setError(`Unexpected response from server (HTTP ${resp.status})`);
          return;
        }
        const respData = await resp.json() as { success: boolean; claim_id?: string; error?: string };
        console.log('[CLAIM] resubmit-claim result:', { success: respData.success, claim_id: respData.claim_id, error: respData.error });
        if (!resp.ok || !respData.success) {
          const msg = respData?.error || `Failed to resubmit claim (${resp.status}).`;
          setError(msg);
          Alert.alert('Resubmit failed', msg);
          return;
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setClaimState('resubmitted');
        onSuccess();
      } else {
        // New claim submission
        setUploadProgress('Submitting claim request...');
        if (__DEV__) console.log('[ClaimForm] calling submitClaimRequest — farmstandId:', farmstand.id, 'photoCount:', uploadedUrls.length, 'urls:', uploadedUrls.slice(0, 2).map(u => u.slice(0, 60)));
        const result = await submitClaimRequest({
          farmstand_id: farmstand.id,
          requester_id: sessionUserId,
          requester_name: requesterName,
          requester_email: requesterEmail,
          evidence_urls: uploadedUrls,
          notes: note?.trim() || null,
        });

        if (__DEV__) console.log('[ClaimForm] submitClaimRequest result — success:', result.success, '| error:', result.error ?? 'none');
        console.log('[CLAIM] submitClaimRequest result:', result);

        if (!result.success) {
          const msg = result.error ?? 'Failed to submit claim request.';
          if (__DEV__) console.warn('[CLAIM] Submit failed:', msg);
          setError(msg);
          Alert.alert('Claim submission failed', msg);
          return;
        }

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        logClaimRequest(farmstand.id, sessionUserId);
        setClaimState('pending_request');
        onSuccess();
      }
    } catch (err: unknown) {
      if (__DEV__) console.warn('[ClaimForm] Submit error:', err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.';
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
  const isPendingRequest = claimState === 'pending_request' || claimState === 'resubmitted';
  const isResubmitted = claimState === 'resubmitted';
  const isNeedsMoreInfo = claimState === 'needs_more_info';
  // Show the form for both unclaimed and needs_more_info states
  const showForm = (isUnclaimed || isNeedsMoreInfo) && isLoggedIn;

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
        <Pressable
          onPress={() => {
            if (isPendingRequest) {
              // On the success screen, X should navigate to Explore, not just close
              onClose();
              router.replace('/(tabs)/');
            } else {
              onClose();
            }
          }}
          hitSlop={8}
        >
          <X size={24} color="#3D3D3D" />
        </Pressable>
        <Text className="text-charcoal font-bold text-lg">
          {isNeedsMoreInfo ? 'Update Claim' : isPendingRequest ? 'Claim Submitted' : 'Verify Ownership'}
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
            {isResubmitted ? 'Claim Resubmitted' : 'Claim Submitted'}
          </Text>

          {/* Body */}
          <Text className="text-wood text-base text-center leading-6 mb-10">
            {isResubmitted
              ? 'Your claim has been resubmitted for review. You will be notified once it is approved.'
              : 'Your request to claim this Farmstand has been sent for review. You will be notified when the claim is approved.'}
          </Text>

          {/* Explore Farmstands */}
          <Pressable
            onPress={() => {
              onClose();
              router.replace('/(tabs)/');
            }}
            className="w-full py-4 rounded-2xl items-center justify-center bg-forest mb-3"
            style={{ shadowColor: '#2D5A3D', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 4 }}
          >
            <Text className="text-cream font-semibold text-base">Explore Farmstands</Text>
          </Pressable>

          {/* View My Profile */}
          <Pressable
            onPress={() => {
              onClose();
              router.replace('/(tabs)/profile');
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
        ) : claimState === 'error' ? (
          <View className="items-center py-16 px-4">
            <View className="w-20 h-20 rounded-full bg-red-100 items-center justify-center mb-5">
              <AlertCircle size={40} color="#DC2626" />
            </View>
            <Text className="text-charcoal font-bold text-xl text-center mb-2">
              Something went wrong
            </Text>
            <Text className="text-wood text-base text-center leading-6">
              We couldn't load the claim status. Please close and try again.
            </Text>
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

            {/* Claim Form - Show for unclaimed or needs_more_info states */}
            {showForm && (
              <>
                {/* Resubmit banner — only when responding to admin info request */}
                {isNeedsMoreInfo && (
                  <View className="bg-amber-50 border border-amber-300 rounded-2xl p-4 mb-5">
                    <View className="flex-row items-center mb-1">
                      <MessageCircle size={16} color="#D97706" />
                      <Text className="text-amber-800 font-semibold ml-2 text-sm">More information was requested</Text>
                    </View>
                    <Text className="text-amber-700 text-sm leading-5">
                      Please update your photos or notes below and resubmit your claim.
                    </Text>
                  </View>
                )}
                {/* Info Box */}
                <View className="bg-mint/20 border border-forest/20 rounded-2xl p-4 mb-6">
                  <View className="flex-row items-center mb-2">
                    <CheckCircle size={18} color="#2D5A3D" />
                    <Text className="text-forest font-semibold ml-2 text-sm">
                      {isNeedsMoreInfo ? 'Update Your Ownership Claim' : 'Verify Your Ownership'}
                    </Text>
                  </View>
                  <Text className="text-bark text-sm leading-5">
                    {isNeedsMoreInfo
                      ? 'Update your photos or notes below to address the admin\'s request, then resubmit.'
                      : 'Submit your information and photo evidence to claim this farmstand. Our team will review and approve your request.'}
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
                  {/* Upload card — hidden when already at 3 total */}
                  {totalPhotoCount < 3 && (
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        Alert.alert('Add Photo Evidence', 'Choose a photo source', [
                          { text: 'Camera', onPress: takePhoto },
                          { text: 'Photo Library', onPress: pickPhoto },
                          { text: 'Cancel', style: 'cancel' },
                        ]);
                      }}
                      disabled={isSubmitting}
                      style={{
                        borderWidth: 1,
                        borderColor: '#E6E6E6',
                        backgroundColor: '#FFFFFF',
                        borderRadius: 16,
                        padding: 14,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        marginBottom: 12,
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
                        }}
                      >
                        <ImagePlus size={24} color="#7A7A7A" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: '700', color: '#1F1F1F', fontSize: 16 }}>
                          {isNeedsMoreInfo ? 'Add / Replace Photos' : 'Add Photo Evidence'}
                        </Text>
                        <Text style={{ color: '#7A7A7A', marginTop: 2, fontSize: 13 }}>
                          Take a photo or choose from library
                        </Text>
                      </View>
                      <Text style={{ color: '#2D5A3D', fontWeight: '700', fontSize: 20 }}>+</Text>
                    </Pressable>
                  )}

                  {/* Existing URL-based photos (from previous submission) */}
                  {existingEvidenceUrls.length > 0 && (
                    <View className="mb-2">
                      {isNeedsMoreInfo && (
                        <Text style={{ color: '#78716C', fontSize: 11, fontWeight: '600', marginBottom: 6 }}>
                          PREVIOUSLY SUBMITTED
                        </Text>
                      )}
                      <View className="flex-row flex-wrap gap-3 mb-1">
                        {existingEvidenceUrls.map((url, index) => (
                          <View key={`existing-${index}`} style={{ position: 'relative' }}>
                            <Image
                              source={{ uri: url }}
                              style={{ width: 96, height: 96, borderRadius: 12 }}
                              resizeMode="cover"
                            />
                            <Pressable
                              onPress={() => removeExistingPhoto(index)}
                              disabled={isSubmitting}
                              style={{
                                position: 'absolute',
                                top: -6,
                                right: -6,
                                backgroundColor: '#EF4444',
                                borderRadius: 12,
                                padding: 4,
                              }}
                            >
                              <Trash2 size={14} color="white" />
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* New local photos */}
                  {evidencePhotos.length > 0 && (
                    <View className="mb-2">
                      {isNeedsMoreInfo && existingEvidenceUrls.length > 0 && (
                        <Text style={{ color: '#78716C', fontSize: 11, fontWeight: '600', marginBottom: 6 }}>
                          NEW PHOTOS
                        </Text>
                      )}
                      <View className="flex-row flex-wrap gap-3 mb-1">
                        {evidencePhotos.map((uri, index) => (
                          <View key={`new-${index}`} style={{ position: 'relative' }}>
                            <Image
                              source={{ uri }}
                              style={{ width: 96, height: 96, borderRadius: 12 }}
                              resizeMode="cover"
                            />
                            <Pressable
                              onPress={() => removePhoto(index)}
                              disabled={isSubmitting}
                              style={{
                                position: 'absolute',
                                top: -6,
                                right: -6,
                                backgroundColor: '#EF4444',
                                borderRadius: 12,
                                padding: 4,
                              }}
                            >
                              <Trash2 size={14} color="white" />
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* Helper text + count */}
                  <Text style={{ color: '#78716C', fontSize: 12, lineHeight: 17, marginBottom: 4 }}>
                    Upload 1–3 photos that prove you own or manage this farmstand (sign, stand, products, business card, etc.)
                  </Text>
                  <Text style={{ color: '#78716C', fontSize: 12, fontWeight: '600' }}>
                    {totalPhotoCount}/3 photos
                  </Text>
                </View>

                {/* Privacy explanation */}
                <View
                  style={{
                    backgroundColor: '#F3F7F4',
                    borderRadius: 12,
                    padding: 14,
                    marginBottom: 20,
                    borderWidth: 1,
                    borderColor: '#D4E3D9',
                  }}
                >
                  <Text style={{ color: '#4A6B55', fontSize: 13, lineHeight: 19 }}>
                    We use your name, email, and photo evidence to verify that you own or manage this farmstand. This information is only used for verification and is not shown publicly.
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
        ) : isClaimedByOther || isClaimedByYou || claimState === 'error' ? (
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
                  {isNeedsMoreInfo ? 'Resubmit Claim' : 'Submit Claim Request'}
                </Text>
              </>
            )}
          </Pressable>
        )}
        {showForm && !isPendingRequest && (
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
