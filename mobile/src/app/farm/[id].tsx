import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, ScrollView, Pressable, Image, Linking, Platform, TextInput, Modal, KeyboardAvoidingView, ActivityIndicator, Alert, Share, StyleSheet, Dimensions, AppState, AppStateStatus } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import {
  ArrowLeft, Heart, Share as ShareIcon, Star, MapPin, Clock, Phone,
  Navigation, ChevronRight, Leaf, X, Camera, ShieldCheck, UserCheck, Package, ChevronDown, MessageSquare, AlertTriangle, Clock as ClockIcon, Play
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeInDown, useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useAdminStore } from '@/lib/admin-store';
import { useFavoritesStore } from '@/lib/favorites-store';
import { useReviewsStore } from '@/lib/reviews-store';
import { useUserStore } from '@/lib/user-store';
import { usePromotionsStore } from '@/lib/promotions-store';
import { useProductsStore, Product, PRODUCT_CATEGORY_LABELS } from '@/lib/products-store';
import { PhotoGalleryModal } from '@/components/PhotoGalleryModal';
import { ClaimFarmstandForm } from '@/components/ClaimFarmstandForm';
import { SignInPromptModal } from '@/components/SignInPromptModal';
import { FarmstandInfoRow } from '@/components/FarmstandInfoRow';
import { ProductCard, PRODUCT_CARD_WIDTH, PRODUCT_CARD_SPACING } from '@/components/ProductCard';
import { formatPhoneNumber, getPhoneDigits } from '@/lib/phone-utils';
import { useChatStore } from '@/lib/chat-store';
import { getFarmstandDisplayImage } from '@/lib/farmstand-image';

const fallbackHero = require('../../assets/images/farmstand-final-fallback.png') as number;
import { supabase, isSupabaseConfigured, getValidSession } from '@/lib/supabase';
import { GoldVerifiedRibbon } from '@/components/GoldVerifiedRibbon';
import { PremiumBadge, isPremiumFarmstand } from '@/components/PremiumBadge';
import { Image as ExpoImage } from 'expo-image';
import { VideoPlayerContent } from '@/components/VideoPlayerContent';
import {
  logFarmstandView,
  logFarmstandSave,
  logDirectionsTap,
  logCallTap,
  logShareTap,
  logMessageTap,
  logReviewCreate,
  logClaimApproved,
} from '@/lib/analytics-events';
import { trackEvent } from '@/lib/track';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_HEIGHT = 340;

export default function FarmDetailScreen() {
  const { id, openClaimModal: openClaimModalParam, claimMode: claimModeParam, claimId: claimIdParam } = useLocalSearchParams<{ id: string; openClaimModal?: string; claimMode?: string; claimId?: string }>();
  const router = useRouter();
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);
  const isFavorite = useFavoritesStore((s) => s.favorites.has(id ?? ''));

  // Admin store for farmstand data
  const adminFarmstands = useAdminStore((s) => s.allFarmstands);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const refreshSingleFarmstand = useAdminStore((s) => s.refreshSingleFarmstand);
  const isAdminLoading = useAdminStore((s) => s.isLoading);
  const claimRequests = useAdminStore((s) => s.claimRequests);
  const claimOverrides = useAdminStore((s) => s.claimOverrides);
  const clearClaimOverride = useAdminStore((s) => s.clearClaimOverride);

  // Reviews store
  const loadReviewsForFarm = useReviewsStore((s) => s.loadReviewsForFarm);
  const addReview = useReviewsStore((s) => s.addReview);
  const getReviewsForFarm = useReviewsStore((s) => s.getReviewsForFarm);

  // User store
  const user = useUserStore((s) => s.user);
  const isLoggedIn = useUserStore((s) => s.isLoggedIn);
  const isGuest = useUserStore((s) => s.isGuest);

  // Guest prompt modal state
  const [showGuestPrompt, setShowGuestPrompt] = useState(false);
  const [guestPromptAction, setGuestPromptAction] = useState<'review' | 'favorite' | 'rate'>('favorite');


  // Promotions store for click tracking
  const incrementClick = usePromotionsStore((s) => s.incrementClick);
  const updateFarmstand = useAdminStore((s) => s.updateFarmstand);

  // Products store
  const productsStore = useProductsStore((s) => s.products);
  const loadProducts = useProductsStore((s) => s.loadProducts);
  const fetchProductsForFarmstand = useProductsStore((s) => s.fetchProductsForFarmstand);
  const getActiveProductsForFarmstand = useProductsStore((s) => s.getActiveProductsForFarmstand);

  // Review modal state
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showPhotoGallery, setShowPhotoGallery] = useState(false);
  const [photoGalleryInitialIndex, setPhotoGalleryInitialIndex] = useState(0);
  const [showVideoPlayer, setShowVideoPlayer] = useState(false);
  const videoTapTimeRef = useRef<number>(0);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Claim modal state
  const [showClaimModal, setShowClaimModal] = useState(false);
  // When true, ClaimFarmstandForm opens directly in resubmit/edit mode (bypasses success screen)
  const [claimModalForceResubmit, setClaimModalForceResubmit] = useState(false);

  // Hours dropdown state (for info card)
  const [hoursExpanded, setHoursExpanded] = useState(false);
  const hoursRotation = useSharedValue(0);

  // Address expansion state
  const [addressExpanded, setAddressExpanded] = useState(false);

  // Hours section collapse state (for main Hours section)
  const [hoursSectionExpanded, setHoursSectionExpanded] = useState(false);
  const hoursSectionRotation = useSharedValue(0);

  // Payments expansion state
  const [paymentsExpanded, setPaymentsExpanded] = useState(false);
  const paymentsRotation = useSharedValue(0);

  // Product detail modal state
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Verified tooltip modal state
  const [showVerifiedTooltip, setShowVerifiedTooltip] = useState(false);

  // Shown when user tries to message a deleted farmstand
  const [showFarmstandDeletedModal, setShowFarmstandDeletedModal] = useState(false);

  // ── Claim state ──────────────────────────────────────────────────────────
  // Single source-of-truth enum. NOTHING should derive UI off multiple booleans.
  // 'owned'   = current user is the owner
  // 'claimed' = farmstand is claimed by ANOTHER user (not claimable)
  // 'pending' = a claim request is pending (not claimable)
  // 'can_claim' = nobody owns it, user can claim
  type ClaimStateEnum = 'unknown' | 'can_claim' | 'pending' | 'owned' | 'claimed';

  const [freshClaimState, setFreshClaimState] = useState<{
    claimedBy: string | null;
    ownerId: string | null;
    claimedAt: string | null;
    claimStatus: 'unclaimed' | 'pending' | 'claimed';
    userClaimRequestStatus: 'none' | 'pending' | 'approved' | 'denied';
    claimQuerySucceeded: boolean;
    isLoading: boolean;
    // Explicit enum derived once, used everywhere
    claimEnum: ClaimStateEnum;
  }>({ claimedBy: null, ownerId: null, claimedAt: null, claimStatus: 'unclaimed', userClaimRequestStatus: 'none', claimQuerySucceeded: false, isLoading: true, claimEnum: 'unknown' });

  // inFlight guard — prevents concurrent fetches from toggling state rapidly
  const claimFetchInFlightRef = useRef(false);
  // Last committed enum — skip setState if nothing changed
  const lastClaimEnumRef = useRef<string>('__init__');

  // Derive the ClaimStateEnum from raw fields
  const deriveClaimEnum = useCallback((
    claimStatus: 'unclaimed' | 'pending' | 'claimed',
    ownerId: string | null,
    claimedBy: string | null,
    userClaimRequestStatus: 'none' | 'pending' | 'approved' | 'denied',
    userId: string | null | undefined,
  ): ClaimStateEnum => {
    const effectiveOwnerId = ownerId ?? claimedBy;
    if (claimStatus === 'claimed') {
      // If we have an owner ID, we can distinguish owned vs. claimed-by-other.
      // If owner_id is hidden by RLS (null) but claim_status = 'claimed', treat as claimed-by-other.
      if (effectiveOwnerId) {
        if (effectiveOwnerId === userId) return 'owned';
        return 'claimed'; // claimed by another user — NOT claimable
      }
      // claim_status = 'claimed' but owner_id not visible (RLS) — still not claimable
      return 'claimed';
    }
    if (claimStatus === 'pending' || userClaimRequestStatus === 'pending') return 'pending';
    return 'can_claim';
  }, []);

  // Function to fetch fresh claim state from Supabase
  // Fetches both farmstand claim status AND user's claim_request status
  const fetchFreshClaimState = useCallback(async () => {
    if (!id || !isSupabaseConfigured()) {
      setFreshClaimState(prev => ({ ...prev, isLoading: false, claimEnum: 'can_claim' }));
      return;
    }

    // ── inFlight guard: skip if a fetch is already running ──
    if (claimFetchInFlightRef.current) {
      console.log('[ClaimState] fetch skipped (inFlight guard)', { farmstandId: id });
      return;
    }
    claimFetchInFlightRef.current = true;

    console.log('[ClaimState] fetch start', { farmstandId: id, authUid: user?.id });

    try {
      // Fetch farmstand owner_id, claimed_by, claimed_at, claim_status
      const { data: farmstandData, error: farmstandError } = await supabase
        .from<Record<string, unknown>>('farmstands')
        .select('id, owner_id, claimed_by, claimed_at, claim_status')
        .eq('id', id)
        .execute();

      if (farmstandError) {
        if (__DEV__) console.warn('[FarmDetail] Error fetching farmstand claim state:', farmstandError);
      }

      let claimedBy: string | null = null;
      let ownerId: string | null = null;
      let claimedAt: string | null = null;
      let claimStatus: 'unclaimed' | 'pending' | 'claimed' = 'unclaimed';

      if (farmstandData && farmstandData.length > 0) {
        const row = farmstandData[0] as { id: string; owner_id?: string | null; claimed_by?: string | null; claimed_at?: string | null; claim_status?: string | null };
        ownerId = row.owner_id ?? null;
        claimedBy = row.claimed_by ?? null;
        claimedAt = row.claimed_at ?? null;
        const dbClaimStatus = row.claim_status;
        if (dbClaimStatus === 'pending' || dbClaimStatus === 'claimed') {
          claimStatus = dbClaimStatus;
        } else if (claimedBy) {
          claimStatus = 'claimed';
        }
        console.log('[FarmDetail] FETCH RESULT farmstand claim_status:', claimStatus, '| owner_id:', ownerId ? 'SET' : 'NULL', '| claimed_by:', claimedBy ? 'SET' : 'NULL');
      }

      // Fetch user's claim_request for this farmstand (if user is logged in)
      let userClaimRequestStatus: 'none' | 'pending' | 'approved' | 'denied' = 'none';
      let supabaseClaimQuerySucceeded = false;

      if (user?.id) {
        try {
          const session = await getValidSession();
          const authUid = session?.access_token
            ? (() => {
                try {
                  const parts = session.access_token.split('.');
                  if (parts.length === 3) {
                    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
                    return (payload.sub as string) ?? user.id;
                  }
                  return user.id;
                } catch { return user.id; }
              })()
            : user.id;

          console.log('[FarmDetail] Querying claim_requests with auth uid:', authUid, '(user.id:', user.id, ')');

          const { data: claimRequestData, error: claimRequestError } = await supabase
            .from<Record<string, unknown>>('claim_requests')
            .select('status, created_at, reviewed_at')
            .eq('farmstand_id', id)
            .eq('user_id', authUid)
            .eq('status', 'pending')
            .is('reviewed_at', 'null')
            .order('created_at', { ascending: false })
            .limit(1)
            .execute();

          if (claimRequestError) {
            console.log('[FarmDetail] Claim requests query skipped:', claimRequestError.message);
          } else {
            supabaseClaimQuerySucceeded = true;
            if (claimRequestData && claimRequestData.length > 0) {
              const claimRequest = claimRequestData[0] as { status: string };
              userClaimRequestStatus = claimRequest.status as 'pending' | 'approved' | 'denied';
              console.log('[FarmDetail] User claim request status:', userClaimRequestStatus);
            } else {
              console.log('[FarmDetail] User claim request status: none (0 rows from Supabase - claim cleared)');
            }
          }
        } catch (claimErr) {
          console.log('[FarmDetail] Claim requests not available');
        }
      }

      // Only fall back to local store if Supabase query itself failed
      // NOTE: we capture claimRequests in a ref below so this callback is stable
      if (!supabaseClaimQuerySucceeded && userClaimRequestStatus === 'none' && user?.id) {
        const localPending = claimRequestsRef.current.some(
          (r) => r.farmstand_id === id && r.requester_id === user.id && r.status === 'pending' && !r.reviewed_at
        );
        if (localPending) {
          userClaimRequestStatus = 'pending';
          console.log('[FarmDetail] Found pending claim in local store (Supabase query failed)');
        }
      }

      const derivedEnum = deriveClaimEnum(claimStatus, ownerId, claimedBy, userClaimRequestStatus, user?.id);

      console.log('[ClaimState] fetch result', { derivedState: derivedEnum, claimed_by: claimedBy, ownerRow: ownerId, claimRequestStatus: userClaimRequestStatus });
      console.log('[ClaimState] ownership trace', {
        farmstandId: id,
        'farmstands.claim_status': claimStatus,
        'farmstands.owner_id': ownerId ?? 'NULL',
        'farmstands.claimed_by': claimedBy ?? 'NULL',
        'claim_requests.status': userClaimRequestStatus,
        currentUserId: user?.id ?? 'NOT LOGGED IN',
        derivedClaimEnum: derivedEnum,
        willShowMessage: derivedEnum === 'owned' || derivedEnum === 'claimed',
        willShowClaim: derivedEnum === 'can_claim',
      });

      // ── Dedupe: only setState if something actually changed ──
      const stateKey = `${claimStatus}|${ownerId}|${claimedBy}|${userClaimRequestStatus}|${derivedEnum}`;
      console.log('[ClaimState] setState?', { prev: lastClaimEnumRef.current, next: stateKey, willSet: lastClaimEnumRef.current !== stateKey });
      if (lastClaimEnumRef.current !== stateKey) {
        lastClaimEnumRef.current = stateKey;
        setFreshClaimState({
          claimedBy,
          ownerId,
          claimedAt,
          claimStatus,
          userClaimRequestStatus,
          claimQuerySucceeded: supabaseClaimQuerySucceeded,
          isLoading: false,
          claimEnum: derivedEnum,
        });
      } else {
        // Still clear the loading flag even if state didn't change
        setFreshClaimState(prev => prev.isLoading ? { ...prev, isLoading: false } : prev);
      }

      // Reconciliation complete — clear any optimistic override so live DB data takes over
      if (id) clearClaimOverride(id);
    } catch (err) {
      if (__DEV__) console.warn('[FarmDetail] Failed to fetch claim state:', err);
      setFreshClaimState(prev => ({ ...prev, isLoading: false }));
    } finally {
      claimFetchInFlightRef.current = false;
    }
    // STABLE DEPS: only id and user?.id — claimRequests accessed via ref to avoid re-creation
  }, [id, user?.id, deriveClaimEnum, clearClaimOverride]);

  // Keep claimRequests in a ref so fetchFreshClaimState can access latest value without
  // needing to be recreated whenever the array changes (which caused the retry storm).
  const claimRequestsRef = useRef(claimRequests);
  useEffect(() => { claimRequestsRef.current = claimRequests; }, [claimRequests]);

  // Keep claimOverrides in a ref so effects don't re-run every time any override changes.
  // The effects only need the value at call-time, not as a reactive dep.
  const claimOverridesRef = useRef(claimOverrides);
  useEffect(() => { claimOverridesRef.current = claimOverrides; }, [claimOverrides]);

  // Load farmstand data on mount and when returning to this screen
  // Uses refreshSingleFarmstand for efficiency (only fetches this farmstand)
  // Also fetch fresh claim state from Supabase
  useFocusEffect(
    useCallback(() => {
      // Reset freshClaimState to loading so background reconciliation starts fresh.
      // Read override from ref — stable, no re-render cycle.
      const hasOverride = !!(id && claimOverridesRef.current[id]);
      if (!hasOverride) {
        // No override — enter loading state so stale data is hidden by skeleton
        lastClaimEnumRef.current = '__init__'; // allow next fetch to commit state
        // Also reset the inFlight guard: if a previous fetch was interrupted (e.g.
        // navigating away mid-request), the guard stays true and permanently blocks
        // future fetches on this screen.  Always bust it on focus so we get fresh data.
        claimFetchInFlightRef.current = false;
        setFreshClaimState({ claimedBy: null, ownerId: null, claimedAt: null, claimStatus: 'unclaimed', userClaimRequestStatus: 'none', claimQuerySucceeded: false, isLoading: true, claimEnum: 'unknown' });
      }
      // Refresh just this farmstand for efficiency
      if (id) {
        refreshSingleFarmstand(id).then((result) => {
          if (!result) {
            console.log('[FarmDetail] FETCH FAILED: refreshSingleFarmstand returned null for id:', id);
          }
        }).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.log('[FarmDetail] FETCH FAILED refreshSingleFarmstand:', msg, '| id:', id);
        });
      }
      // Cache + network: load from AsyncStorage first so cached products appear
      // instantly, then fetch Supabase in the background and overwrite with fresh data.
      (async () => {
        await loadProducts();
        const cached = id ? getActiveProductsForFarmstand(id) : [];
        if (__DEV__) console.log('[Products] cache count:', cached.length, '| farmstand:', id);
        if (id) {
          if (__DEV__) console.log('[Products] loading products for farmstand_id:', id);
          fetchProductsForFarmstand(id).then(() => {
            const fresh = getActiveProductsForFarmstand(id);
            if (__DEV__) console.log('[Products] fetched count:', fresh.length, '| farmstand:', id);
          }).catch(() => {});
        }
      })().catch(() => {});
      void fetchFreshClaimState().catch((e: unknown) => {
        if (__DEV__) console.warn('[FarmDetail] fetchFreshClaimState error:', e);
      });
    }, [id, refreshSingleFarmstand, loadProducts, fetchProductsForFarmstand, fetchFreshClaimState])
  );

  // AppState listener: re-fetch when app comes to foreground
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        console.log('[FarmDetail] AppState active - refetching claim state for id:', id);
        // Only reset to loading if no active override — read from ref to avoid dep
        const hasOverride = !!(id && claimOverridesRef.current[id]);
        if (!hasOverride) {
          lastClaimEnumRef.current = '__init__'; // allow next fetch to commit state
          setFreshClaimState({ claimedBy: null, ownerId: null, claimedAt: null, claimStatus: 'unclaimed', userClaimRequestStatus: 'none', claimQuerySucceeded: false, isLoading: true, claimEnum: 'unknown' });
        }
        if (id) {
          refreshSingleFarmstand(id).catch(() => {});
        }
        void fetchFreshClaimState().catch((e: unknown) => {
          if (__DEV__) console.warn('[FarmDetail] fetchFreshClaimState error:', e);
        });
        // Cache + network on foreground return
        loadProducts().then(() => {
          if (id) fetchProductsForFarmstand(id);
        }).catch(() => {});
      }
      appStateRef.current = nextAppState;
    });
    return () => subscription.remove();
    // STABLE DEPS: only id and stable callbacks — claimOverrides accessed via ref
  }, [id, fetchFreshClaimState, refreshSingleFarmstand, loadProducts, fetchProductsForFarmstand]);

  // Find the farmstand from admin store
  const farmstand = useMemo(() => {
    return adminFarmstands.find((f) => f.id === id);
  }, [adminFarmstands, id]);

  // Open claim modal if requested via param (from alert "Update Claim" or onboarding flow)
  useEffect(() => {
    if ((openClaimModalParam === '1' || openClaimModalParam === 'true') && farmstand && !showClaimModal) {
      const isResubmit = claimModeParam === 'resubmit';
      console.log('[FarmDetail] openClaimModal param detected', { openClaimModalParam, claimModeParam, isResubmit, farmstandId: id });
      // Small delay to let the page render first
      const timer = setTimeout(() => {
        setClaimModalForceResubmit(isResubmit);
        setShowClaimModal(true);
        // Clear params so navigating back/forward doesn't re-open the modal
        router.setParams({ openClaimModal: '', claimMode: '' });
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [openClaimModalParam, claimModeParam, farmstand]);

  // Log farmstand view when page loads and track click for popularity
  useEffect(() => {
    if (id && farmstand) {
      if (__DEV__) console.log('[FarmDetail] logFarmstandView + incrementClick — farmstandId:', id);
      logFarmstandView(id, farmstand.name, user?.id);
      // Track click for popularity scoring — non-critical, must not redscreen on network failure
      incrementClick(farmstand, updateFarmstand).catch((e: unknown) => {
        if (__DEV__) console.warn('[FarmDetail] incrementClick error (non-critical):', e instanceof Error ? e.message : String(e));
      });
    }
  }, [id, farmstand?.id]);

  // Convert farmstand to farm format for display
  const farm = useMemo(() => {
    if (!farmstand) return null;
    const mainPhotoIndex = farmstand.mainPhotoIndex ?? 0;

    // Prioritize photos[mainPhotoIndex] so the guest view always matches what the
    // owner sees in my-farmstand.tsx. heroImageUrl is not updated when new photos
    // are added to the photos array (only on first upload or explicit "Set as Main"),
    // so relying on it alone causes the guest view to show a stale hero image.
    const validPhotos = (farmstand.photos ?? []).filter((p): p is string => Boolean(p && p.startsWith('http')));
    const photosArrayHero = validPhotos[mainPhotoIndex] ?? validPhotos[0] ?? null;

    const heroImageData = getFarmstandDisplayImage({
      id: farmstand.id,
      heroPhotoUrl: photosArrayHero ?? farmstand.heroPhotoUrl,
      hero_image_url: farmstand.heroImageUrl,
      ai_image_url: farmstand.aiImageUrl,
      main_product: farmstand.mainProduct,
      offerings: farmstand.offerings,
      categories: farmstand.categories,
    });

    return {
      id: farmstand.id,
      name: farmstand.name,
      description: farmstand.description,
      image: heroImageData.url,
      isAIGeneratedImage: heroImageData.isAI,
      photos: farmstand.photos,
      mainPhotoIndex,
      rating: 0,
      reviewCount: 0,
      isOpen: farmstand.isActive,
      hours: 'See Hours Below',
      address: (() => {
        const street = farmstand.addressLine1?.trim();
        const city = farmstand.city?.trim();
        const state = farmstand.state?.trim();
        const zip = farmstand.zip?.trim();

        // Build address: "{street}, {city}, {state} {zip}"
        const parts: string[] = [];
        if (street) parts.push(street);
        if (city) parts.push(city);

        // State and ZIP together: "OR 97201"
        const stateZip = [state, zip].filter(Boolean).join(' ');
        if (stateZip) parts.push(stateZip);

        return parts.join(', ') || 'Address not available';
      })(),
      phone: farmstand.phone ? formatPhoneNumber(farmstand.phone) : 'Not available',
      email: farmstand.email ?? null,
      products: farmstand.offerings,
      otherProducts: farmstand.otherProducts ?? [],
      features: farmstand.categories,
      latitude: farmstand.latitude ?? 0,
      longitude: farmstand.longitude ?? 0,
      locationPrecision: farmstand.locationPrecision,
      approxLocationText: farmstand.approxLocationText,
    };
  }, [farmstand]);

  const reviews = id ? getReviewsForFarm(id) : [];
  const farmstandProducts = id ? getActiveProductsForFarmstand(id) : [];
  if (__DEV__) console.log(`[Products] final rendered count: ${farmstandProducts.length} | farmstand: ${id}`);

  const heartScale = useSharedValue(1);

  useEffect(() => {
    if (id) {
      if (__DEV__) console.log('[FarmDetail] loadReviewsForFarm — farmstandId:', id);
      loadReviewsForFarm(id).catch((e: unknown) => {
        if (__DEV__) console.warn('[FarmDetail] loadReviewsForFarm error (non-critical):', e instanceof Error ? e.message : String(e));
      });
    }
  }, [loadReviewsForFarm, id]);

  const heartAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
  }));

  const handleFavoritePress = () => {
    if (!id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Check if user is a guest
    if (isGuest()) {
      setGuestPromptAction('favorite');
      setShowGuestPrompt(true);
      return;
    }

    heartScale.value = withSpring(1.3, { damping: 10 }, () => {
      heartScale.value = withSpring(1, { damping: 10 });
    });
    // Log to Supabase analytics (only log saves, not unsaves)
    if (!isFavorite && farmstand) {
      logFarmstandSave(id, farmstand.name, user?.id);
    }
    trackEvent('save_farmstand_tapped', { source: 'detail', farmstand_id: id, farmstand_name: farmstand?.name ?? null, new_saved_state: !isFavorite });
    toggleFavorite(id);
  };

  const handleDirections = () => {
    if (!farm || !id) return;
    logDirectionsTap(id, user?.id);
    trackEvent('farmstand_directions_tapped', { farmstand_id: id, farmstand_name: farm.name });
    const scheme = Platform.select({ ios: 'maps:', android: 'geo:' });
    const url = Platform.select({
      ios: `${scheme}?q=${farm.name}&ll=${farm.latitude},${farm.longitude}`,
      android: `${scheme}${farm.latitude},${farm.longitude}?q=${farm.name}`,
    });
    if (url) Linking.openURL(url);
  };

  const handleCall = () => {
    if (!farm || !id || farm.phone === 'Not available') return;
    logCallTap(id, user?.id);
    trackEvent('farmstand_call_tapped', { farmstand_id: id, farmstand_name: farm.name });
    // Use digits only for the tel: link
    const phoneDigits = getPhoneDigits(farm.phone);
    Linking.openURL(`tel:${phoneDigits}`);
  };

  const handleEmail = () => {
    if (!farm?.email) return;
    Linking.openURL(`mailto:${farm.email}`);
  };

  const handleShare = async () => {
    if (!farm || !id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Build share URL using slug if available, fallback to id
    const shareSlug = farmstand?.slug ?? id;
    const shareUrl = `https://links.farmstand.online/farmstand/${shareSlug}`;

    try {
      await Share.share(
        {
          // 'title' appears as the preview title
          title: farm.name,
          // URL is included in message so iOS doesn't append it a second time
          message: `Check out ${farm.name} on the Farmstand app 🌱 ${shareUrl}`,
        },
        {
          // iOS-specific: Set the subject for email/messages
          subject: `${farm.name} - Farmstand`,
        }
      );
      // Log share event after user completes the share dialog
      logShareTap(id, user?.id);
      trackEvent('farmstand_share_tapped', { farmstand_id: id, farmstand_name: farm.name });
    } catch {
      // User cancelled or error
    }
  };

  const handleWriteReview = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Check if user is a guest
    if (isGuest()) {
      setGuestPromptAction('review');
      setShowGuestPrompt(true);
      return;
    }

    trackEvent('farmstand_review_started', { farmstand_id: id ?? null, farmstand_name: farmstand?.name ?? null });
    setShowReviewModal(true);
  };

  const handleOpenPhotoGallery = (index: number = 0) => {
    const hasPhotos = farm?.photos && farm.photos.length > 0;
    const hasVideo = !!farmstand?.videoUrl;
    if (hasPhotos || hasVideo) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      trackEvent('farmstand_gallery_opened', { farmstand_id: id ?? null, farmstand_name: farmstand?.name ?? null, initial_index: index });
      setPhotoGalleryInitialIndex(index);
      setShowPhotoGallery(true);
    }
  };

  const handleSubmitReview = async () => {
    if (!id || !reviewText.trim() || !user) return;

    setIsSubmitting(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Save to reviews store — returns { success, error? }
    const reviewResult = await addReview(id, user.id ?? '', user.name, reviewRating, reviewText.trim());
    if (!reviewResult.success) {
      setIsSubmitting(false);
      Alert.alert(
        'Unable to Submit Review',
        reviewResult.error ?? 'There was a problem saving your review. Please check your connection and try again.'
      );
      return;
    }

    // Save to NEW unified database (REQUIRED)
    const submitReportOrReview = useAdminStore.getState().submitReportOrReview;
    const farm = adminFarmstands.find((f) => f.id === id);

    await submitReportOrReview({
      submissionType: 'review',
      reportedItemType: 'farmstand',
      reportedItemId: id,
      reportedItemName: farm?.name || 'Unknown Farmstand',
      rating: reviewRating,
      reason: 'Customer Review',
      comments: reviewText.trim(),
      submittedByUserId: user.id ?? null,
      submittedByUserEmail: user.email,
      sourceScreen: 'farmstand-detail',
    });

    // Log to Supabase analytics
    logReviewCreate(id, reviewRating, user.id ?? null);
    trackEvent('farmstand_review_submitted', { farmstand_id: id, farmstand_name: farmstand?.name ?? null, rating: reviewRating });

    setIsSubmitting(false);
    setShowReviewModal(false);
    setReviewText('');
    setReviewRating(5);
  };

  const handleClaimPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Check if user is a guest
    if (isGuest()) {
      setGuestPromptAction('review');
      setShowGuestPrompt(true);
      return;
    }

    setShowClaimModal(true);
  };

  const handleClaimSuccess = () => {
    // Optimistically mark the claim as pending immediately so the button
    // switches to "Pending Approval" the instant the claim is submitted,
    // without waiting for a Supabase round-trip.
    setFreshClaimState(prev => ({
      ...prev,
      claimEnum: 'pending',
      userClaimRequestStatus: 'pending',
      claimStatus: 'pending',
      isLoading: false,
    }));
    // Log the claim submitted event
    if (id && user?.id) {
      logClaimApproved(id, user.id);
    }
    // Background reconciliation — no await so the UI update above is instant
    void fetchFreshClaimState().catch((e: unknown) => {
      if (__DEV__) console.warn('[FarmDetail] fetchFreshClaimState error:', e);
    });
    loadAdminData();
  };

  // Chat store for messaging
  const getOrCreateThread = useChatStore((s) => s.getOrCreateThread);
  const getThreadByFarmstandAndUser = useChatStore((s) => s.getThreadByFarmstandAndUser);

  // Handle Message Farmstand button
  const handleMessageFarmstand = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Block messaging if farmstand has been deleted
    if (farmstand?.deletedAt) {
      setShowFarmstandDeletedModal(true);
      return;
    }

    // Check if user is a guest - require login to message
    if (isGuest()) {
      setGuestPromptAction('review'); // Reuse the review action prompt for login
      setShowGuestPrompt(true);
      return;
    }

    if (!id || !farmstand || !user || !user.id) return;

    // Log message tap to Supabase analytics
    logMessageTap(id, user.id);
    trackEvent('farmstand_message_tapped', { farmstand_id: id, farmstand_name: farmstand.name });

    // Check if thread already exists
    const existingThread = getThreadByFarmstandAndUser(id, user.id);

    if (existingThread) {
      // Open existing thread
      router.push(`/chat/${existingThread.id}`);
    } else {
      // Create new thread and navigate
      router.push({
        pathname: '/chat/new',
        params: {
          farmstandId: id,
          farmstandName: farmstand.name,
        },
      });
    }
  };

  // Check if farmstand has a pending claim (from anyone, not just current user)
  // This is used to hide the claim CTA when status is 'pending'
  const farmstandHasPendingClaim = useMemo(() => {
    // Optimistic override takes priority — instant, no waiting for Supabase
    const override = id ? claimOverridesRef.current[id] : undefined;
    const effectiveClaimStatus = override ? override.claimStatus : (freshClaimState.isLoading ? null : freshClaimState.claimStatus);
    return effectiveClaimStatus === 'pending';
  }, [id, freshClaimState.isLoading, freshClaimState.claimStatus]);

  // Check if current user has a pending claim request for this farmstand
  // SOURCE OF TRUTH: optimistic override (instant) → Supabase claim_requests (background reconciliation)
  const hasPendingClaimRequest = useMemo(() => {
    if (!user?.id || !id) return false;
    // Optimistic override takes absolute priority — read from ref (no dep cycle)
    const override = claimOverridesRef.current[id];
    if (override) {
      return override.userClaimRequestStatus === 'pending';
    }
    // Drive off the single enum — no fighting booleans
    if (freshClaimState.isLoading) return false;
    return freshClaimState.claimEnum === 'pending';
  }, [id, freshClaimState.isLoading, freshClaimState.claimEnum, user?.id]);

  // Check if current user is the owner.
  // Primary source of truth: optimistic override → owner_id column → claimed_by fallback.
  const isOwner = useMemo(() => {
    if (!user?.id) return false;
    const override = id ? claimOverridesRef.current[id] : undefined;
    if (override) {
      return override.ownerId === user.id;
    }
    if (freshClaimState.isLoading) return false;
    return freshClaimState.claimEnum === 'owned';
  }, [user?.id, id, freshClaimState.isLoading, freshClaimState.claimEnum]);

  // Check if farmstand is claimed (has an owner).
  // IMPORTANT: While loading (no override), default to UNCLAIMED (false).
  const isClaimed = useMemo(() => {
    const override = id ? claimOverridesRef.current[id] : undefined;
    if (override) {
      return override.claimStatus === 'claimed' && !!override.ownerId;
    }
    if (freshClaimState.isLoading) return false;
    // 'owned' = current user is the owner; 'claimed' = another user owns it.
    // Both states mean the farmstand IS claimed and should NOT show "Claim this Farmstand".
    const result = freshClaimState.claimEnum === 'owned' || freshClaimState.claimEnum === 'claimed';
    console.log('[ClaimState] isClaimed derived', { claimEnum: freshClaimState.claimEnum, isClaimed: result, farmstandId: id, ownerId: freshClaimState.ownerId, claimedBy: freshClaimState.claimedBy, userId: user?.id });
    return result;
  }, [id, freshClaimState.isLoading, freshClaimState.claimEnum, freshClaimState.ownerId, freshClaimState.claimedBy, user?.id]);

  // Animated style for hours section chevron
  const hoursSectionChevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${hoursSectionRotation.value}deg` }],
  }));

  const toggleHoursExpanded = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setHoursExpanded(!hoursExpanded);
    hoursRotation.value = withTiming(hoursExpanded ? 0 : 180, { duration: 200 });
  };

  const toggleHoursSectionExpanded = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setHoursSectionExpanded(!hoursSectionExpanded);
    hoursSectionRotation.value = withTiming(hoursSectionExpanded ? 0 : 180, { duration: 200 });
  };

  // Helper to format time from "HH:MM" to "9:00 AM" format
  const formatTimeDisplay = (time: string | null): string => {
    if (!time) return '';
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours % 12 || 12;
    return `${displayHour}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  // Helper to format hours for display
  const formatHours = (hours: { open: string | null; close: string | null; closed: boolean }) => {
    if (hours.closed || !hours.open || !hours.close) return 'Closed';
    return `${formatTimeDisplay(hours.open)} – ${formatTimeDisplay(hours.close)}`;
  };

  // Get today's day key
  const getTodayKey = (): 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' => {
    const days: ('sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat')[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    return days[new Date().getDay()];
  };

  const DAY_LABELS: Record<string, string> = {
    mon: 'Monday',
    tue: 'Tuesday',
    wed: 'Wednesday',
    thu: 'Thursday',
    fri: 'Friday',
    sat: 'Saturday',
    sun: 'Sunday',
  };

  // Check if currently open based on hours
  const getOpenStatus = (): { isOpen: boolean; statusText: string; nextChangeText: string } => {
    // Check operating_status first — overrides hour-based logic
    const opStatus = farmstand?.operatingStatus;
    if (opStatus === 'temporarily_closed') {
      return { isOpen: false, statusText: 'Temporarily Closed', nextChangeText: '' };
    }
    if (opStatus === 'seasonal') {
      return { isOpen: false, statusText: 'Seasonal (Closed Now)', nextChangeText: '' };
    }
    if (opStatus === 'permanently_closed') {
      return { isOpen: false, statusText: 'Permanently Closed', nextChangeText: '' };
    }

    // Check for 24/7 first
    if (farmstand?.isOpen24_7) {
      return { isOpen: true, statusText: 'Open 24 hours', nextChangeText: '' };
    }

    if (!farmstand?.hours) {
      return { isOpen: false, statusText: 'Hours not set', nextChangeText: '' };
    }

    const todayKey = getTodayKey();
    const todayHours = farmstand.hours[todayKey];

    if (todayHours.closed || !todayHours.open || !todayHours.close) {
      // Find next open day
      const dayOrder: ('mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun')[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
      const todayIndex = dayOrder.indexOf(todayKey);
      for (let i = 1; i <= 7; i++) {
        const nextDayKey = dayOrder[(todayIndex + i) % 7];
        const nextDayHours = farmstand.hours[nextDayKey];
        if (!nextDayHours.closed && nextDayHours.open) {
          return {
            isOpen: false,
            statusText: 'Closed today',
            nextChangeText: `Opens ${DAY_LABELS[nextDayKey]} at ${formatTimeDisplay(nextDayHours.open)}`
          };
        }
      }
      return { isOpen: false, statusText: 'Closed', nextChangeText: '' };
    }

    // Check current time against hours
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [openHour, openMin] = todayHours.open.split(':').map(Number);
    const [closeHour, closeMin] = todayHours.close.split(':').map(Number);
    const openMinutes = openHour * 60 + openMin;
    const closeMinutes = closeHour * 60 + closeMin;

    if (currentMinutes < openMinutes) {
      return {
        isOpen: false,
        statusText: 'Closed',
        nextChangeText: `Opens at ${formatTimeDisplay(todayHours.open)}`
      };
    } else if (currentMinutes >= closeMinutes) {
      // Find next open time
      const dayOrder: ('mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun')[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
      const todayIndex = dayOrder.indexOf(todayKey);
      for (let i = 1; i <= 7; i++) {
        const nextDayKey = dayOrder[(todayIndex + i) % 7];
        const nextDayHours = farmstand.hours[nextDayKey];
        if (!nextDayHours.closed && nextDayHours.open) {
          const dayLabel = i === 1 ? 'tomorrow' : DAY_LABELS[nextDayKey];
          return {
            isOpen: false,
            statusText: 'Closed',
            nextChangeText: `Opens ${dayLabel} at ${formatTimeDisplay(nextDayHours.open)}`
          };
        }
      }
      return { isOpen: false, statusText: 'Closed', nextChangeText: '' };
    } else {
      return {
        isOpen: true,
        statusText: 'Open now',
        nextChangeText: `Closes at ${formatTimeDisplay(todayHours.close)}`
      };
    }
  };

  const openStatus = getOpenStatus();

  // Loading state
  if (isAdminLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2D5A3D" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (!farm) {
    // If admin store is empty (no farmstands loaded at all), this is likely a fetch failure
    // rather than a genuinely missing farmstand. Log to help debug.
    console.log('[FarmDetail] farm not found in store for id:', id, '| total farmstands in store:', adminFarmstands.length);
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{adminFarmstands.length === 0 ? 'Unable to load farmstand data' : 'Farm stand not found'}</Text>
        <Pressable onPress={() => router.back()} style={styles.errorButton}>
          <Text style={styles.errorButtonText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
        {/* Hero Image Section */}
        <Pressable onPress={() => !farm.isAIGeneratedImage && handleOpenPhotoGallery(0)}>
          <View style={styles.heroContainer}>
            <ExpoImage
              source={farm.isAIGeneratedImage ? fallbackHero : { uri: farm.image }}
              style={styles.heroImage}
              contentFit="cover"
              cachePolicy="memory"
              recyclingKey={farm.isAIGeneratedImage ? 'fallback' : farm.image}
              transition={300}
            />
            <LinearGradient
              colors={['rgba(0,0,0,0.4)', 'transparent', 'transparent', 'rgba(0,0,0,0.5)']}
              locations={[0, 0.3, 0.6, 1]}
              style={StyleSheet.absoluteFillObject}
            />

            {/* Photo count badge - Bottom Right - Only show for uploaded photos */}
            {!farm.isAIGeneratedImage && (() => {
              const totalMedia = (farm.photos?.length ?? 0) + (farmstand?.videoUrl ? 1 : 0);
              return totalMedia > 1 ? (
                <View style={styles.photoCountBadge}>
                  <Camera size={14} color="#FDF8F3" />
                  <Text style={styles.photoCountText}>{totalMedia}</Text>
                </View>
              ) : null;
            })()}

            {/* Video badge - Bottom Left - shown when a video exists */}
            {farmstand?.videoUrl && (
              <Pressable
                onPress={() => {
                  videoTapTimeRef.current = Date.now();
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  trackEvent('farmstand_video_opened', { farmstand_id: id ?? null, farmstand_name: farmstand?.name ?? null });
                  setShowVideoPlayer(true);
                }}
                style={{ position: 'absolute', bottom: 36, left: 16, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, gap: 5 }}
              >
                <Play size={13} color="#FDF8F3" fill="#FDF8F3" />
                <Text style={{ color: '#FDF8F3', fontSize: 12, fontWeight: '600' }}>
                  {farmstand.videoDurationSeconds ? `${farmstand.videoDurationSeconds}s` : 'Video'}
                </Text>
              </Pressable>
            )}


            {/* Header Actions */}
            <SafeAreaView edges={['top']} style={styles.headerActions}>
              <Pressable onPress={() => router.back()} style={styles.headerButton}>
                <ArrowLeft size={22} color="#3D3D3D" />
              </Pressable>
              <View style={styles.headerRight}>
                <Pressable onPress={handleShare} style={[styles.headerButton, { marginRight: 12 }]}>
                  <ShareIcon size={20} color="#3D3D3D" />
                </Pressable>
                <Pressable onPress={handleFavoritePress} style={[styles.headerButton, { backgroundColor: 'transparent', borderRadius: 0, padding: 6 }]}>
                  <Animated.View style={heartAnimatedStyle}>
                    <Heart
                      size={22}
                      color={isFavorite ? '#C94A4A' : '#FFFFFF'}
                      fill={isFavorite ? '#C94A4A' : 'transparent'}
                      strokeWidth={2}
                    />
                  </Animated.View>
                </Pressable>
              </View>
            </SafeAreaView>
          </View>
        </Pressable>

        {/* Main Content */}
        <View style={styles.content}>
          {/* ===== TOP / DECISION ZONE ===== */}

          {/* 1. Farmstand Name */}
          <Animated.View entering={FadeInDown.delay(100).duration(400)} style={styles.titleSection}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <Text style={[styles.farmName, { flex: 1 }]} numberOfLines={2} ellipsizeMode="tail">{farm.name}</Text>
              {isPremiumFarmstand(farmstand?.premiumStatus) && (
                <View style={{ paddingTop: 4 }}>
                  <PremiumBadge size="default" />
                </View>
              )}
            </View>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push(`/farm/reviews?farmstandId=${id}`);
              }}
              style={styles.ratingRow}
            >
              <View style={styles.ratingBadge}>
                <Star size={14} color="#D4943A" fill="#D4943A" />
                <Text style={styles.ratingText}>
                  {reviews.length > 0
                    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
                    : '—'}
                </Text>
              </View>
              <Text style={styles.reviewCount}>
                ({reviews.length} review{reviews.length !== 1 ? 's' : ''})
              </Text>
            </Pressable>
          </Animated.View>

          {/* 2. Primary Action Buttons */}
          <Animated.View entering={FadeInDown.delay(150).duration(400)} style={styles.actionZone}>
            {/* Determine if claim state is truly resolved:
                - If an optimistic override exists, it's instant (no loading flash)
                - Otherwise wait for the Supabase fetch to complete */}
            {(() => {
              const hasOverride = !!(id && claimOverrides[id]);
              const claimResolved = hasOverride || !freshClaimState.isLoading;

              if (!claimResolved) {
                // Show skeleton placeholder so stale content never flashes
                return (
                  <View
                    style={{
                      height: 52,
                      borderRadius: 14,
                      backgroundColor: '#E8EEE8',
                      opacity: 0.7,
                      marginBottom: 12,
                    }}
                  />
                );
              }

              if (isClaimed) {
                return (
                  <Pressable onPress={handleMessageFarmstand} style={styles.heroButton}>
                    <MessageSquare size={22} color="#FDF8F3" />
                    <Text style={styles.heroButtonText}>Message this Farmstand</Text>
                  </Pressable>
                );
              }

              if (!hasPendingClaimRequest) {
                return (
                  <Pressable onPress={() => setShowClaimModal(true)} style={styles.claimHeroButton}>
                    <UserCheck size={22} color="#2D5A3D" />
                    <Text style={styles.claimHeroButtonText}>Claim this Farmstand</Text>
                  </Pressable>
                );
              }

              // Pending claim — show a disabled status button so users get immediate feedback
              return (
                <View>
                  <View style={styles.pendingApprovalButton}>
                    <ClockIcon size={20} color="#B45309" />
                    <Text style={styles.pendingApprovalButtonText}>Pending Approval</Text>
                  </View>
                  <Text style={{ textAlign: 'center', color: '#92400E', fontSize: 13, marginTop: 8, opacity: 0.85, lineHeight: 18 }}>
                    We're reviewing your information and will get back to you quickly.
                  </Text>
                </View>
              );
            })()}

            {/* Secondary Utility Actions - Quiet & Compact */}
            <View style={styles.utilityRow}>
              <Pressable onPress={handleDirections} style={styles.utilityButton}>
                <Navigation size={18} color="#2D5A3D" />
                <Text style={styles.utilityButtonText}>Directions</Text>
              </Pressable>
              <Pressable
                onPress={handleCall}
                style={[styles.utilityButton, farm.phone === 'Not available' && styles.utilityButtonDisabled]}
                disabled={farm.phone === 'Not available'}
              >
                <Phone size={18} color={farm.phone === 'Not available' ? '#C4B5A4' : '#2D5A3D'} />
                <Text style={[styles.utilityButtonText, farm.phone === 'Not available' && styles.utilityButtonTextDisabled]}>Call</Text>
              </Pressable>
            </View>
          </Animated.View>

          {/* ===== LOGISTICS ZONE ===== */}

          {/* 3. Info Card: Address, Hours, Phone, Payments */}
          <Animated.View entering={FadeInDown.delay(175).duration(400)} style={styles.infoCard}>
            {/* Address Row (selectable, tappable for directions) */}
            {farm.address && farm.address !== 'Address not available' && (
              <>
                <FarmstandInfoRow
                  type="location"
                  title={farm.address}
                  onPress={handleDirections}
                  selectable
                  copyable
                />
                {/* Approximate Location Warning */}
                {farm.locationPrecision?.startsWith('approximate') && (
                  <View style={styles.approximateLocationWarning}>
                    <AlertTriangle size={14} color="#D97706" />
                    <Text style={styles.approximateLocationText}>
                      Approximate location — verify details before driving out
                    </Text>
                  </View>
                )}
                <View style={styles.infoSeparator} />
              </>
            )}

            {/* Hours Row (expandable) */}
            <FarmstandInfoRow
              type="hours"
              title={openStatus.statusText}
              subtitle={openStatus.nextChangeText || undefined}
              onPress={toggleHoursExpanded}
              showChevron
              chevronRotation={hoursRotation}
              titleStyle={openStatus.isOpen ? 'highlight' : 'default'}
            />

            {/* Expanded Hours */}
            {hoursExpanded && farmstand?.hours && (
              <View style={styles.expandedHours}>
                {(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map((day) => {
                  const isToday = day === getTodayKey();
                  return (
                    <View key={day} style={[styles.hoursRow, isToday && styles.todayRow]}>
                      <Text style={[styles.dayLabel, isToday && styles.todayLabel]}>{DAY_LABELS[day]}</Text>
                      <Text style={[styles.hoursValue, farmstand.hours![day].closed && styles.closedText, isToday && styles.todayLabel]}>
                        {formatHours(farmstand.hours![day])}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}

            {hoursExpanded && !farmstand?.hours && (
              <View style={styles.expandedHours}>
                <Text style={styles.noHoursText}>Detailed hours not available</Text>
              </View>
            )}

            {/* Phone Row (tap to call) */}
            {farm.phone && farm.phone !== 'Not available' && (
              <>
                <View style={styles.infoSeparator} />
                <FarmstandInfoRow
                  type="phone"
                  title={farm.phone}
                  onPress={handleCall}
                />
              </>
            )}

            {/* Email Row (tap to open mail app) */}
            {farm.email && (
              <>
                <View style={styles.infoSeparator} />
                <FarmstandInfoRow
                  type="email"
                  title={farm.email}
                  onPress={handleEmail}
                />
              </>
            )}

            {/* Payments Row (collapsed by default, expandable) */}
            {farmstand?.paymentOptions && farmstand.paymentOptions.length > 0 && (
              <>
                <View style={styles.infoSeparator} />
                <FarmstandInfoRow
                  type="payments"
                  title={(() => {
                    const paymentLabels: Record<string, string> = { cashapp: 'Cash App' };
                    const methods = farmstand.paymentOptions;
                    const displayMethods = methods.slice(0, 3).map((m: string) =>
                      paymentLabels[m] ?? (m.charAt(0).toUpperCase() + m.slice(1))
                    );
                    const overflow = methods.length > 3 ? ` +${methods.length - 3}` : '';
                    return `Payments: ${displayMethods.join(', ')}${overflow}`;
                  })()}
                  subtitle={!paymentsExpanded && farmstand.honorSystem ? 'Honor system' : undefined}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setPaymentsExpanded(!paymentsExpanded);
                    paymentsRotation.value = withTiming(paymentsExpanded ? 0 : 180, { duration: 200 });
                  }}
                  showChevron
                  chevronRotation={paymentsRotation}
                />

                {/* Expanded Payments - Show all methods as chips */}
                {paymentsExpanded && (
                  <View style={styles.expandedPayments}>
                    <View style={styles.paymentChipsContainer}>
                    {farmstand.paymentOptions.map((method: string, index: number) => {
                        const paymentLabels: Record<string, string> = { cashapp: 'Cash App' };
                        const displayLabel = paymentLabels[method] ?? (method.charAt(0).toUpperCase() + method.slice(1));
                        return (
                          <View key={`payment-${index}`} style={styles.paymentChip}>
                            <Text style={styles.paymentChipText}>
                              {displayLabel}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                    {farmstand.honorSystem && (
                      <View style={styles.honorSystemRow}>
                        <Text style={styles.honorSystemText}>Honor system / Self-serve</Text>
                      </View>
                    )}
                  </View>
                )}
              </>
            )}
          </Animated.View>

          {/* ===== CONTEXT & ABOUT ZONE ===== */}

          {/* 4. About Section */}
          {farm.description?.trim() ? (
            <Animated.View entering={FadeInDown.delay(200).duration(400)} style={styles.section}>
              <Text style={styles.sectionTitle}>About</Text>
              <Text style={styles.aboutText}>{farm.description}</Text>
            </Animated.View>
          ) : null}

          {/* Owner prompt banner - show only if owner AND no About section */}
          {isOwner && !farm.description?.trim() && (
            <Animated.View entering={FadeInDown.delay(200).duration(400)} style={styles.ownerPromptBanner}>
              <View style={styles.ownerPromptBannerContent}>
                <UserCheck size={16} color="#2D5A3D" />
                <Text style={styles.ownerPromptBannerText}>Add an About section to help visitors learn about your farmstand</Text>
              </View>
              <Pressable
                onPress={() => router.push(`/owner/edit?id=${id}`)}
                style={styles.ownerPromptBannerButton}
              >
                <Text style={styles.ownerPromptBannerButtonText}>Edit</Text>
              </Pressable>
            </Animated.View>
          )}

          {/* ===== DISCOVERY ZONE ===== */}

          {/* 5. Product Category Chips */}
          {(farm.products.length > 0 || farm.features.length > 0 || farm.otherProducts.length > 0) && (
            <Animated.View entering={FadeInDown.delay(225).duration(400)} style={styles.categoryChipsSection}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.categoryChipsScrollContent}
              >
                {/* Regular Offerings */}
                {farm.products.map((offering: string, index: number) => (
                  <View key={`offering-${index}`} style={styles.categoryChip}>
                    <Leaf size={14} color="#2D5A3D" />
                    <Text style={styles.categoryChipText}>{offering}</Text>
                  </View>
                ))}
                {/* Category chips - only show if different from offerings */}
                {farm.features.filter((f: string) => !farm.products.includes(f)).map((feature: string, index: number) => (
                  <View key={`category-${index}`} style={styles.categoryChip}>
                    <Leaf size={14} color="#2D5A3D" />
                    <Text style={styles.categoryChipText}>{feature}</Text>
                  </View>
                ))}
                {/* Other products chips - only show if different from offerings */}
                {farm.otherProducts.filter((p: string) => !farm.products.includes(p)).map((product: string, index: number) => (
                  <View key={`other-${index}`} style={styles.categoryChip}>
                    <Leaf size={14} color="#2D5A3D" />
                    <Text style={styles.categoryChipText}>{product}</Text>
                  </View>
                ))}
              </ScrollView>
            </Animated.View>
          )}

          {/* 6. Products Section - Horizontal Scroll */}
          {farmstandProducts.length > 0 && (
            <Animated.View entering={FadeInDown.delay(250).duration(400)} style={styles.productsSection}>
              <View style={styles.productsSectionHeader}>
                <Text style={styles.sectionTitle}>Products</Text>
                {farmstandProducts.length > 2 && (
                  <Pressable onPress={() => setSelectedProduct(farmstandProducts[0])}>
                    <Text style={styles.viewAllLink}>View All</Text>
                  </Pressable>
                )}
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                nestedScrollEnabled={true}
                contentContainerStyle={styles.productsScrollContent}
                decelerationRate="fast"
                snapToInterval={PRODUCT_CARD_WIDTH + PRODUCT_CARD_SPACING}
                snapToAlignment="start"
              >
                {[...farmstandProducts]
                  .sort((a, b) => {
                    // Sort: in stock first, then by name
                    if (a.is_in_stock !== b.is_in_stock) return a.is_in_stock ? -1 : 1;
                    return a.name.localeCompare(b.name);
                  })
                  .map((product, index) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      index={index}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSelectedProduct(product);
                      }}
                      badges={[]}
                    />
                  ))}
              </ScrollView>
            </Animated.View>
          )}

          {/* 7. Reviews Section - Clickable Row */}
          <Animated.View entering={FadeInDown.delay(350).duration(400)} style={styles.section}>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push(`/farm/reviews?farmstandId=${id}`);
              }}
              style={styles.reviewsRow}
            >
              <View style={styles.reviewsRowContent}>
                <Text style={styles.reviewsRowTitle}>Reviews</Text>
                <View style={styles.reviewsRowSubtitleContainer}>
                  {reviews.length > 0 ? (
                    <>
                      <View style={styles.reviewsRowRating}>
                        <Star size={14} color="#D4943A" fill="#D4943A" />
                        <Text style={styles.reviewsRowRatingText}>
                          {(reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)}
                        </Text>
                        <Text style={styles.reviewsRowCount}>
                          ({reviews.length} review{reviews.length !== 1 ? 's' : ''})
                        </Text>
                      </View>
                      <Text style={styles.reviewsRowDot}>•</Text>
                    </>
                  ) : null}
                  <Text style={styles.reviewsRowSubtitle}>
                    {reviews.length > 0 ? 'See all reviews • Write a review' : 'Be the first to write a review'}
                  </Text>
                </View>
              </View>
              <ChevronRight size={20} color="#8B6F4E" />
            </Pressable>
          </Animated.View>

          {/* Bottom spacing */}
          <View style={{ height: 40 }} />
        </View>
      </ScrollView>

      {/* Review Modal */}
      <Modal
        visible={showReviewModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowReviewModal(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <SafeAreaView style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Pressable onPress={() => setShowReviewModal(false)}>
                <X size={24} color="#3D3D3D" />
              </Pressable>
              <Text style={styles.modalTitle}>Write a Review</Text>
              <View style={{ width: 24 }} />
            </View>

            <ScrollView style={styles.modalContent}>
              <Text style={styles.modalFarmName}>{farm.name}</Text>

              <Text style={styles.modalLabel}>Your Rating</Text>
              <View style={styles.ratingSelection}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Pressable
                    key={star}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setReviewRating(star);
                    }}
                    style={styles.ratingStar}
                  >
                    <Star size={36} color="#D4943A" fill={star <= reviewRating ? '#D4943A' : 'transparent'} />
                  </Pressable>
                ))}
              </View>

              <Text style={styles.modalLabel}>Your Review</Text>
              <TextInput
                style={styles.reviewInput}
                placeholder="Share your experience at this farmstand..."
                placeholderTextColor="#8B6F4E"
                multiline
                textAlignVertical="top"
                value={reviewText}
                onChangeText={setReviewText}
              />
              <Text style={styles.reviewHint}>
                Your review will be visible to others and the farmstand owner can respond.
              </Text>
            </ScrollView>

            <View style={styles.modalFooter}>
              <Pressable
                onPress={handleSubmitReview}
                disabled={!reviewText.trim() || isSubmitting}
                style={[styles.submitButton, (!reviewText.trim() || isSubmitting) && styles.submitButtonDisabled]}
              >
                <Text style={[styles.submitButtonText, (!reviewText.trim() || isSubmitting) && styles.submitButtonTextDisabled]}>
                  {isSubmitting ? 'Submitting...' : 'Submit Review'}
                </Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Photo Gallery Modal */}
      <PhotoGalleryModal
        visible={showPhotoGallery}
        photos={farm?.photos ?? []}
        initialIndex={photoGalleryInitialIndex}
        onClose={() => setShowPhotoGallery(false)}
        farmstandName={farm?.name ?? 'Photo Album'}
        farmstandId={id ?? 'default'}
        products={farmstandProducts}
        offerings={farmstand?.offerings ?? []}
        videoUrl={farmstand?.videoUrl ?? undefined}
        videoDurationSeconds={farmstand?.videoDurationSeconds ?? null}
      />

      {/* Video Player Modal — mounted only while open; hero badge path (gallery not open) */}
      {farmstand?.videoUrl && showVideoPlayer && (
        <Modal
          visible
          animationType="none"
          presentationStyle="fullScreen"
          onRequestClose={() => setShowVideoPlayer(false)}
        >
          <VideoPlayerContent
            videoUrl={farmstand.videoUrl}
            tapTimestamp={videoTapTimeRef.current}
            onClose={() => setShowVideoPlayer(false)}
          />
        </Modal>
      )}

      {/* Claim Modal */}
      <Modal
        visible={showClaimModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowClaimModal(false)}
      >
        {farmstand && (
          <ClaimFarmstandForm
            farmstand={farmstand}
            userId={user?.id ?? null}
            forceResubmitMode={claimModalForceResubmit}
            claimId={claimModalForceResubmit ? (claimIdParam ?? null) : null}
            onClose={() => {
              setShowClaimModal(false);
              setClaimModalForceResubmit(false);
            }}
            onSuccess={handleClaimSuccess}
          />
        )}
      </Modal>

      {/* Product Detail Modal */}
      <Modal
        visible={!!selectedProduct}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedProduct(null)}
      >
        <SafeAreaView edges={['top']} style={styles.productModalContainer}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setSelectedProduct(null)} style={{ padding: 4 }}>
              <X size={24} color="#5C4033" />
            </Pressable>
            <Text style={styles.modalTitle}>Product Details</Text>
            <View style={{ width: 32 }} />
          </View>

          {selectedProduct && (
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {selectedProduct.photo_url ? (
                <Image source={{ uri: selectedProduct.photo_url }} style={styles.productModalImage} />
              ) : (
                <View style={styles.productModalImagePlaceholder}>
                  <Package size={64} color="#8B6F4E" />
                </View>
              )}

              <View style={styles.productModalContent}>
                <View style={styles.productModalHeader}>
                  <View style={{ flex: 1, marginRight: 16 }}>
                    <Text style={styles.productModalName}>{selectedProduct.name}</Text>
                    <Text style={styles.productModalCategory}>{PRODUCT_CATEGORY_LABELS[selectedProduct.category]}</Text>
                  </View>
                  <View style={[styles.stockBadgeLarge, !selectedProduct.is_in_stock && styles.outOfStockBadgeLarge]}>
                    <Text style={[styles.stockTextLarge, !selectedProduct.is_in_stock && styles.outOfStockTextLarge]}>
                      {selectedProduct.is_in_stock ? 'In Stock' : 'Out of Stock'}
                    </Text>
                  </View>
                </View>

                <View style={styles.productModalPriceBox}>
                  <Text style={styles.productModalPrice}>
                    ${selectedProduct.price.toFixed(2)}
                    <Text style={styles.productModalUnit}> / {selectedProduct.unit}</Text>
                  </Text>
                </View>

                {selectedProduct.description && (
                  <View style={styles.productModalSection}>
                    <Text style={styles.productModalSectionTitle}>Description</Text>
                    <Text style={styles.productModalDescription}>{selectedProduct.description}</Text>
                  </View>
                )}

                {selectedProduct.stock_note && (
                  <View style={styles.productModalNote}>
                    <Text style={styles.productModalNoteTitle}>Stock Note</Text>
                    <Text style={styles.productModalNoteText}>{selectedProduct.stock_note}</Text>
                  </View>
                )}

                {selectedProduct.seasonal && (
                  <View style={styles.productModalSeasonal}>
                    <Text style={styles.productModalSeasonalTitle}>Seasonal Availability</Text>
                    <Text style={styles.productModalSeasonalText}>{selectedProduct.seasonal}</Text>
                  </View>
                )}

                <View style={styles.productModalFarmInfo}>
                  <Text style={styles.productModalFarmLabel}>Available at</Text>
                  <Text style={styles.productModalFarmName}>{farm?.name}</Text>
                </View>
              </View>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* Guest Sign In Prompt Modal */}
      <SignInPromptModal
        visible={showGuestPrompt}
        onClose={() => setShowGuestPrompt(false)}
        action={guestPromptAction}
      />

      {/* Farmstand Deleted Modal */}
      <Modal
        visible={showFarmstandDeletedModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFarmstandDeletedModal(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' }}
          onPress={() => setShowFarmstandDeletedModal(false)}
        >
          <Pressable
            style={{ backgroundColor: '#FFFFFF', borderRadius: 20, marginHorizontal: 32, width: '85%', maxWidth: 380, overflow: 'hidden' }}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={{ padding: 28, alignItems: 'center' }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <AlertTriangle size={24} color="#B45309" />
              </View>
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#1C1917', textAlign: 'center', marginBottom: 10 }}>
                Farmstand No Longer Available
              </Text>
              <Text style={{ fontSize: 14, color: '#78716C', textAlign: 'center', lineHeight: 21 }}>
                This Farmstand has been deleted and can no longer receive messages.
              </Text>
            </View>
            <Pressable
              onPress={() => setShowFarmstandDeletedModal(false)}
              style={{ borderTopWidth: 1, borderTopColor: '#F5F0EA', paddingVertical: 16, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 16, fontWeight: '600', color: '#2D5A3D' }}>OK</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Verified Tooltip Modal */}
      <Modal
        visible={showVerifiedTooltip}
        transparent
        animationType="fade"
        onRequestClose={() => setShowVerifiedTooltip(false)}
      >
        <Pressable
          style={styles.verifiedTooltipOverlay}
          onPress={() => setShowVerifiedTooltip(false)}
        >
          <View style={styles.verifiedTooltipContainer}>
            <View style={styles.verifiedTooltipContent}>
              <View style={styles.verifiedTooltipHeader}>
                <ShieldCheck size={18} color={farmstand?.goldVerified ? '#D4943A' : '#2D5A3D'} fill={farmstand?.goldVerified ? '#D4943A' : '#2D5A3D'} />
                <Text style={styles.verifiedTooltipTitle}>
                  {farmstand?.goldVerified ? 'Gold Verified Farmstand' : 'Verified Farmstand'}
                </Text>
              </View>
              <Text style={styles.verifiedTooltipText}>
                {farmstand?.goldVerified
                  ? 'Trusted by the Farmstand community over time.'
                  : 'Managed by the owner'}
              </Text>
              <Pressable
                onPress={() => setShowVerifiedTooltip(false)}
                style={[
                  styles.verifiedTooltipCloseButton,
                  farmstand?.goldVerified && styles.goldTooltipCloseButton,
                ]}
              >
                <Text style={styles.verifiedTooltipCloseText}>Got it</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAF8',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#FAFAF8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#5C4033',
    marginTop: 16,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#FAFAF8',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  errorText: {
    color: '#3D3D3D',
    fontSize: 18,
    textAlign: 'center',
  },
  errorButton: {
    marginTop: 16,
    backgroundColor: '#2D5A3D',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  errorButtonText: {
    color: '#FDF8F3',
    fontWeight: '600',
  },

  // Hero Section
  heroContainer: {
    height: HERO_HEIGHT,
    position: 'relative',
    overflow: 'hidden',
  },
  heroImage: {
    width: SCREEN_WIDTH,
    height: HERO_HEIGHT,
  },
  statusBadge: {
    position: 'absolute',
    top: 100,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusText: {
    color: '#FDF8F3',
    fontSize: 13,
    fontWeight: '600',
  },
  heroBrandOverlay: {
    position: 'absolute',
    bottom: 28,
    left: 20,
  },
  heroBrandName: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  heroBrandTagline: {
    color: 'rgba(255,255,255,0.80)',
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  photoCountBadge: {
    position: 'absolute',
    bottom: 36,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  photoCountText: {
    color: '#FDF8F3',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 6,
  },
  headerActions: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerButton: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 20,
    padding: 10,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  // Main Content
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    backgroundColor: '#FAFAF8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -24,
  },

  // Title Section
  titleSection: {
    marginBottom: 24,
  },
  farmNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
  farmName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1A1A1A',
    letterSpacing: -0.5,
    flexShrink: 1,
    lineHeight: 32,
  },
  verifiedBadgeContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
    marginRight: 16,
  },
  verifiedIconButton: {
    marginLeft: 8,
    paddingRight: 4,
  },
  verifiedBadgeImage: {
    width: 32,
    height: 32,
    transform: [{ scale: 2 }],
  },
  goldBadgeImage: {
    tintColor: '#D4943A',
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 0,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF7E6',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  ratingText: {
    color: '#1A1A1A',
    fontWeight: '700',
    fontSize: 14,
    marginLeft: 4,
  },
  reviewCount: {
    color: '#6B6B6B',
    fontSize: 14,
    marginLeft: 8,
  },
  // Pending Verification Banner
  pendingVerificationBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  pendingVerificationIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FDE68A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingVerificationTextContainer: {
    flex: 1,
    marginLeft: 10,
  },
  pendingVerificationTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#92400E',
  },
  pendingVerificationSubtitle: {
    fontSize: 12,
    color: '#B45309',
    marginTop: 2,
  },
  dotSeparator: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#C4B5A4',
    marginHorizontal: 10,
  },

  // Action Zone - Hipcamp/Airbnb Style
  actionZone: {
    marginBottom: 28,
    gap: 12,
  },
  heroButton: {
    backgroundColor: '#2D5A3D',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 28,
    shadowColor: '#2D5A3D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 5,
  },
  heroButtonText: {
    color: '#FDF8F3',
    fontWeight: '600',
    fontSize: 17,
    marginLeft: 10,
    letterSpacing: 0.2,
  },
  claimHeroButton: {
    backgroundColor: '#FFFDF9',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: '#2D5A3D',
  },
  claimHeroButtonText: {
    color: '#2D5A3D',
    fontWeight: '600',
    fontSize: 17,
    marginLeft: 10,
    letterSpacing: 0.2,
  },
  pendingApprovalButton: {
    backgroundColor: '#FFFBF0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: '#B45309',
    opacity: 0.85,
  },
  pendingApprovalButtonText: {
    color: '#B45309',
    fontWeight: '600',
    fontSize: 17,
    marginLeft: 10,
    letterSpacing: 0.2,
  },
  utilityRow: {
    flexDirection: 'row',
    gap: 12,
  },
  utilityButton: {
    flex: 1,
    backgroundColor: '#FFFDF9',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(45, 90, 61, 0.25)',
  },
  utilityButtonText: {
    color: '#2D5A3D',
    fontWeight: '500',
    fontSize: 15,
    marginLeft: 8,
  },
  utilityButtonDisabled: {
    borderColor: 'rgba(196, 181, 164, 0.4)',
    backgroundColor: '#FAFAF8',
  },
  utilityButtonTextDisabled: {
    color: '#C4B5A4',
  },

  // Pending Claim Request Card - Amber/Warning style
  pendingClaimCard: {
    backgroundColor: '#FFFBEB',
    padding: 20,
    borderRadius: 16,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: 'rgba(217, 119, 6, 0.25)',
  },
  pendingIconContainer: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(217, 119, 6, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  pendingClaimLabel: {
    color: '#B45309',
    fontSize: 14,
    fontWeight: '600',
  },
  pendingClaimText: {
    color: '#92400E',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 16,
  },
  pendingButton: {
    backgroundColor: 'rgba(217, 119, 6, 0.15)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(217, 119, 6, 0.3)',
  },
  pendingButtonText: {
    color: '#B45309',
    fontWeight: '600',
    fontSize: 14,
  },

  // Compact Pending Banner - Placed near top of page
  pendingBanner: {
    backgroundColor: '#FFFBEB',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(217, 119, 6, 0.2)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pendingBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  pendingBannerTextContainer: {
    marginLeft: 10,
    flex: 1,
  },
  pendingBannerTitle: {
    color: '#92400E',
    fontSize: 13,
    fontWeight: '600',
  },
  pendingBannerSubtext: {
    color: '#B45309',
    fontSize: 11,
    marginTop: 1,
  },
  pendingBannerPill: {
    backgroundColor: 'rgba(217, 119, 6, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  pendingBannerPillText: {
    color: '#B45309',
    fontSize: 11,
    fontWeight: '600',
  },

  // Shared header style for owner card
  unclaimedCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },

  // Owner Card - Show when user owns this farmstand
  ownerCard: {
    backgroundColor: '#E8F5E9',
    padding: 20,
    borderRadius: 16,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: 'rgba(45, 90, 61, 0.25)',
  },
  ownerIconContainer: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(45, 90, 61, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  ownerCardLabel: {
    color: '#2D5A3D',
    fontSize: 14,
    fontWeight: '600',
  },
  ownerCardText: {
    color: '#3D5A4D',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 16,
  },
  manageButton: {
    backgroundColor: '#2D5A3D',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
  },
  manageButtonText: {
    color: '#FDF8F3',
    fontWeight: '600',
    fontSize: 14,
  },

  // Info Card
  infoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 4,
    marginBottom: 32,
    shadowColor: 'rgba(0, 0, 0, 1)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  infoIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F0F7F2',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  infoText: {
    flex: 1,
    color: '#3D3D3D',
    fontSize: 15,
  },
  openText: {
    color: '#2D5A3D',
    fontWeight: '600',
  },
  hoursInfo: {
    flex: 1,
  },
  hoursSubtext: {
    color: '#8B6F4E',
    fontSize: 13,
    marginTop: 2,
  },
  infoSeparator: {
    height: 1,
    backgroundColor: '#F0EDE8',
    marginHorizontal: 14,
  },
  approximateLocationWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginLeft: 50,
    backgroundColor: '#FFFBEB',
    borderRadius: 8,
    marginTop: 4,
    marginBottom: 4,
    marginRight: 14,
  },
  approximateLocationText: {
    color: '#92400E',
    fontSize: 12,
    marginLeft: 8,
    flex: 1,
  },
  expandedHours: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    marginLeft: 50,
  },
  expandedPayments: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    marginLeft: 50,
  },
  paymentChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  paymentChip: {
    backgroundColor: '#F0F7F2',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  paymentChipText: {
    color: '#2D5A3D',
    fontSize: 13,
    fontWeight: '500',
  },
  honorSystemRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F0EDE8',
  },
  honorSystemText: {
    color: '#8B6F4E',
    fontSize: 13,
    fontStyle: 'italic',
  },
  hoursRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  todayRow: {
    backgroundColor: '#F0F7F2',
    marginHorizontal: -8,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  dayLabel: {
    color: '#6B6B6B',
    fontSize: 14,
  },
  todayLabel: {
    color: '#2D5A3D',
    fontWeight: '600',
  },
  hoursValue: {
    color: '#3D3D3D',
    fontSize: 14,
    fontWeight: '500',
  },
  closedText: {
    color: '#8B6F4E',
  },
  noHoursText: {
    color: '#8B6F4E',
    fontSize: 14,
  },

  // Sections
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 14,
    letterSpacing: -0.3,
  },
  aboutText: {
    color: '#4A4A4A',
    fontSize: 15,
    lineHeight: 24,
  },

  // Owner About Prompt
  ownerAboutPrompt: {
    backgroundColor: '#FFFCF5',
    padding: 20,
    borderRadius: 16,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: 'rgba(212, 148, 58, 0.2)',
    borderStyle: 'dashed',
  },
  ownerPromptTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#5C4033',
    marginBottom: 6,
  },
  ownerPromptText: {
    fontSize: 14,
    color: '#8B6F4E',
    lineHeight: 20,
    marginBottom: 14,
  },
  ownerPromptButton: {
    backgroundColor: '#2D5A3D',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  ownerPromptButtonText: {
    color: '#FDF8F3',
    fontSize: 14,
    fontWeight: '600',
  },

  // Owner Prompt Banner - Compact inline banner for owners
  ownerPromptBanner: {
    backgroundColor: '#F0F7F2',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(45, 90, 61, 0.15)',
  },
  ownerPromptBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  ownerPromptBannerText: {
    color: '#3D5A4D',
    fontSize: 13,
    marginLeft: 10,
    flex: 1,
    lineHeight: 18,
  },
  ownerPromptBannerButton: {
    backgroundColor: '#2D5A3D',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  ownerPromptBannerButtonText: {
    color: '#FDF8F3',
    fontSize: 13,
    fontWeight: '600',
  },

  // Category Chips Section - Horizontal scroll above products
  categoryChipsSection: {
    marginBottom: 12,
  },
  categoryChipsScrollContent: {
    paddingRight: 20,
    gap: 8,
    flexDirection: 'row',
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  categoryChipText: {
    color: '#2D5A3D',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 6,
  },

  // Products Section - Horizontal Scroll
  productsSection: {
    marginBottom: 20,
  },
  productsSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 0,
    marginBottom: 14,
  },
  viewAllLink: {
    color: '#2D5A3D',
    fontSize: 15,
    fontWeight: '600',
  },
  productsScrollContent: {
    paddingRight: 20,
  },

  // Products Card (legacy - kept for fallback)
  productsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: 'rgba(0, 0, 0, 1)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  productRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F0EDE8',
  },
  productImage: {
    width: 52,
    height: 52,
    borderRadius: 10,
  },
  productImagePlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: '#F5F3F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  productInfo: {
    flex: 1,
    marginLeft: 14,
    marginRight: 10,
  },
  productName: {
    color: '#1A1A1A',
    fontWeight: '600',
    fontSize: 15,
  },
  productCategory: {
    color: '#8B6F4E',
    fontSize: 12,
    marginTop: 2,
  },
  productPricing: {
    alignItems: 'flex-end',
    marginRight: 8,
  },
  productPrice: {
    color: '#2D5A3D',
    fontWeight: '700',
    fontSize: 15,
  },
  stockBadge: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 4,
  },
  outOfStockBadge: {
    backgroundColor: '#FFEBEE',
  },
  stockText: {
    color: '#2E7D32',
    fontSize: 11,
    fontWeight: '600',
  },
  outOfStockText: {
    color: '#C62828',
  },

  // Feature Chips
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  featureChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
  },
  featureChipText: {
    color: '#2D5A3D',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 6,
  },
  productChip: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E8E4DF',
  },
  productChipText: {
    color: '#5C4033',
    fontSize: 14,
    fontWeight: '500',
  },

  // Reviews Section
  reviewsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  seeAllLink: {
    color: '#2D5A3D',
    fontSize: 15,
    fontWeight: '600',
  },
  reviewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
    shadowColor: 'rgba(0, 0, 0, 1)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  reviewAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  reviewerInfo: {
    flex: 1,
    marginLeft: 12,
  },
  reviewerName: {
    color: '#1A1A1A',
    fontWeight: '600',
    fontSize: 15,
  },
  reviewDate: {
    color: '#8B6F4E',
    fontSize: 12,
    marginTop: 2,
  },
  reviewStars: {
    flexDirection: 'row',
    gap: 2,
  },
  reviewText: {
    color: '#4A4A4A',
    fontSize: 14,
    lineHeight: 22,
  },
  ownerResponse: {
    marginTop: 14,
    padding: 14,
    backgroundColor: '#F0F7F2',
    borderRadius: 12,
  },
  ownerResponseLabel: {
    color: '#2D5A3D',
    fontWeight: '600',
    fontSize: 13,
    marginBottom: 6,
  },
  ownerResponseText: {
    color: '#4A4A4A',
    fontSize: 14,
    lineHeight: 20,
  },
  ownerResponseDate: {
    color: '#8B6F4E',
    fontSize: 12,
    marginTop: 6,
  },
  noReviews: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  noReviewsText: {
    color: '#8B6F4E',
    fontSize: 14,
  },
  writeReviewButton: {
    backgroundColor: '#C45C3E',
    paddingVertical: 16,
    borderRadius: 14,
    marginTop: 8,
    shadowColor: '#C45C3E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  writeReviewText: {
    color: '#FDF8F3',
    fontWeight: '600',
    fontSize: 16,
    textAlign: 'center',
  },

  // Review Modal
  modalContainer: {
    flex: 1,
    backgroundColor: '#FAFAF8',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EDE8',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  modalContent: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  modalFarmName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 28,
  },
  modalLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 12,
  },
  ratingSelection: {
    flexDirection: 'row',
    marginBottom: 28,
  },
  ratingStar: {
    marginRight: 8,
  },
  reviewInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E4DF',
    borderRadius: 14,
    padding: 16,
    color: '#1A1A1A',
    fontSize: 15,
    minHeight: 150,
  },
  reviewHint: {
    color: '#8B6F4E',
    fontSize: 13,
    marginTop: 10,
  },
  modalFooter: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#F0EDE8',
  },
  submitButton: {
    backgroundColor: '#2D5A3D',
    paddingVertical: 16,
    borderRadius: 14,
  },
  submitButtonDisabled: {
    backgroundColor: '#E8E4DF',
  },
  submitButtonText: {
    color: '#FDF8F3',
    fontWeight: '600',
    fontSize: 16,
    textAlign: 'center',
  },
  submitButtonTextDisabled: {
    color: '#8B6F4E',
  },

  // Product Modal
  productModalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  productModalImage: {
    width: SCREEN_WIDTH,
    height: 280,
  },
  productModalImagePlaceholder: {
    width: SCREEN_WIDTH,
    height: 280,
    backgroundColor: '#F5F3F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  productModalContent: {
    padding: 24,
  },
  productModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  productModalName: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  productModalCategory: {
    fontSize: 14,
    color: '#8B6F4E',
    marginTop: 4,
  },
  stockBadgeLarge: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  outOfStockBadgeLarge: {
    backgroundColor: '#FFEBEE',
  },
  stockTextLarge: {
    color: '#2E7D32',
    fontSize: 14,
    fontWeight: '600',
  },
  outOfStockTextLarge: {
    color: '#C62828',
  },
  productModalPriceBox: {
    backgroundColor: '#F0F7F2',
    borderRadius: 14,
    padding: 18,
    marginTop: 18,
  },
  productModalPrice: {
    fontSize: 32,
    fontWeight: '700',
    color: '#2D5A3D',
  },
  productModalUnit: {
    fontSize: 18,
    fontWeight: '400',
    color: '#5C4033',
  },
  productModalSection: {
    marginTop: 28,
  },
  productModalSectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 10,
  },
  productModalDescription: {
    fontSize: 15,
    color: '#4A4A4A',
    lineHeight: 24,
  },
  productModalNote: {
    marginTop: 24,
    backgroundColor: '#FFF8E1',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  productModalNoteTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F9A825',
    marginBottom: 6,
  },
  productModalNoteText: {
    fontSize: 14,
    color: '#5C4033',
    lineHeight: 20,
  },
  productModalSeasonal: {
    marginTop: 24,
    backgroundColor: '#E3F2FD',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#90CAF9',
  },
  productModalSeasonalTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1976D2',
    marginBottom: 6,
  },
  productModalSeasonalText: {
    fontSize: 14,
    color: '#1976D2',
    lineHeight: 20,
  },
  productModalFarmInfo: {
    marginTop: 28,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: '#F0EDE8',
  },
  productModalFarmLabel: {
    fontSize: 13,
    color: '#8B6F4E',
  },
  productModalFarmName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1A1A1A',
    marginTop: 4,
  },

  // Verified Tooltip Modal
  verifiedTooltipOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  verifiedTooltipContainer: {
    marginHorizontal: 40,
  },
  verifiedTooltipContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  verifiedTooltipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  verifiedTooltipTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1A1A1A',
    marginLeft: 8,
  },
  verifiedTooltipText: {
    fontSize: 14,
    color: '#6B6B6B',
    marginBottom: 16,
  },
  verifiedTooltipCloseButton: {
    backgroundColor: '#2D5A3D',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
  },
  goldTooltipCloseButton: {
    backgroundColor: '#D4943A',
  },
  verifiedTooltipCloseText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },

  // Reviews Row - Clickable navigation to reviews screen
  reviewsRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: 'rgba(0, 0, 0, 1)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  reviewsRowContent: {
    flex: 1,
  },
  reviewsRowTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  reviewsRowSubtitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  reviewsRowRating: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reviewsRowRatingText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A1A',
    marginLeft: 4,
  },
  reviewsRowCount: {
    fontSize: 14,
    color: '#6B6B6B',
    marginLeft: 4,
  },
  reviewsRowDot: {
    fontSize: 14,
    color: '#C4B5A4',
    marginHorizontal: 8,
  },
  reviewsRowSubtitle: {
    fontSize: 14,
    color: '#2D5A3D',
  },
});
