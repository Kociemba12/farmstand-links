import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  Modal,
  TextInput,
  ActivityIndicator,
  Image,
  Alert,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  ShieldCheck,
  MapPin,
  User,
  Clock,
  CheckCircle,
  XCircle,
  MessageCircle,
  X,
  AlertCircle,
  Check,
} from 'lucide-react-native';
import Animated, {
  FadeInDown,
  FadeIn,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { AdminGuard } from '@/components/AdminGuard';
import { useAdminStore, ClaimRequest } from '@/lib/admin-store';
import { useUserStore } from '@/lib/user-store';
import { logClaimApproved, logClaimDenied } from '@/lib/analytics-events';
import { useAuthReady, supabase, getValidSession } from '@/lib/supabase';

// Background color constant
const BG_COLOR = '#FAF7F2';
// Keep in sync with map.tsx FARMSTANDS_CACHE_KEY
const MAP_FARMSTANDS_CACHE_KEY = 'map_farmstands_cache';

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

interface ClaimRequestCardProps {
  request: ClaimRequest;
  farmstandName: string;
  farmstandLocation: string;
  onApprove: () => void;
  onDeny: () => void;
  onRequestInfo: () => void;
  isProcessing: boolean;
  delay?: number;
}

function ClaimRequestCard({
  request,
  farmstandName,
  farmstandLocation,
  onApprove,
  onDeny,
  onRequestInfo,
  isProcessing,
  delay = 0,
}: ClaimRequestCardProps) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(400)}>
      <View
        className="bg-white rounded-[20px] p-5 mb-4"
        style={{
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.06,
          shadowRadius: 12,
          elevation: 3,
        }}
      >
        {/* Farmstand Info */}
        <View className="flex-row items-start mb-4">
          <View
            className="w-12 h-12 rounded-full items-center justify-center mr-4"
            style={{ backgroundColor: '#EDE9FE' }}
          >
            <ShieldCheck size={24} color="#8B5CF6" />
          </View>
          <View className="flex-1">
            <Text className="text-stone-900 font-semibold text-base">{farmstandName}</Text>
            <View className="flex-row items-center mt-1">
              <MapPin size={14} color="#78716C" />
              <Text className="text-stone-500 text-sm ml-1">{farmstandLocation}</Text>
            </View>
          </View>
          <View className="flex-row items-center bg-stone-100 px-2 py-1 rounded-full">
            <Clock size={12} color="#78716C" />
            <Text className="text-stone-500 text-xs ml-1">{formatDate(request.created_at)}</Text>
          </View>
        </View>

        {/* Divider */}
        <View className="h-px bg-stone-100 mb-4" />

        {/* Requester Info */}
        <View className="bg-stone-50 rounded-2xl p-4 mb-4">
          <View className="flex-row items-center">
            <View className="w-9 h-9 rounded-full bg-stone-200 items-center justify-center mr-3">
              <User size={16} color="#78716C" />
            </View>
            <View className="flex-1">
              <Text className="text-stone-800 font-medium">{request.requester_name}</Text>
              <Text className="text-stone-500 text-sm">{request.requester_email}</Text>
            </View>
          </View>
        </View>

        {/* Evidence Images */}
        {request.evidence_urls && request.evidence_urls.length > 0 && (
          <View className="mb-4">
            <Text className="text-stone-600 text-sm font-medium mb-2">Evidence Photos</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {request.evidence_urls.map((url, index) => (
                  <Image
                    key={index}
                    source={{ uri: url }}
                    style={{
                      width: 120,
                      height: 120,
                      borderRadius: 12,
                    }}
                    resizeMode="cover"
                  />
                ))}
              </View>
            </ScrollView>
          </View>
        )}

        {/* Additional Notes */}
        {request.notes ? (
          <View className="bg-amber-50 rounded-2xl p-4 mb-4">
            <View className="flex-row items-center mb-2">
              <MessageCircle size={15} color="#B45309" />
              <Text className="text-amber-800 font-semibold text-sm ml-2">Additional Notes</Text>
            </View>
            <Text className="text-amber-900 text-sm leading-5">{request.notes}</Text>
          </View>
        ) : null}

        {/* Action Buttons - show for all awaiting-review statuses */}
        {(['pending', 'submitted', 'requested'] as string[]).includes(request.status) && (
          <View className="flex-row" style={{ gap: 10 }}>
            <Pressable
              onPress={onApprove}
              disabled={isProcessing}
              className={`flex-1 py-3.5 rounded-2xl flex-row items-center justify-center ${isProcessing ? 'bg-green-300' : 'bg-green-600 active:bg-green-700'}`}
            >
              <CheckCircle size={18} color="white" />
              <Text className="text-white font-semibold ml-2">Approve</Text>
            </Pressable>
            <Pressable
              onPress={onDeny}
              disabled={isProcessing}
              className={`flex-1 py-3.5 rounded-2xl flex-row items-center justify-center ${isProcessing ? 'bg-red-300' : 'bg-red-500 active:bg-red-600'}`}
            >
              <XCircle size={18} color="white" />
              <Text className="text-white font-semibold ml-2">Deny</Text>
            </Pressable>
            <Pressable
              onPress={onRequestInfo}
              disabled={isProcessing}
              className="bg-stone-100 py-3.5 px-4 rounded-2xl items-center justify-center active:bg-stone-200"
            >
              <MessageCircle size={18} color="#57534E" />
            </Pressable>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

function AdminClaimRequestsContent() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);

  // Auth readiness check - ensures session is loaded before showing UI
  const { ready: authReady } = useAuthReady();

  const getFarmstandById = useAdminStore((s) => s.getFarmstandById);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const refreshSingleFarmstand = useAdminStore((s) => s.refreshSingleFarmstand);
  const applyClaimOverride = useAdminStore((s) => s.applyClaimOverride);
  const clearClaimOverride = useAdminStore((s) => s.clearClaimOverride);
  const requestMoreInfo = useAdminStore((s) => s.requestMoreInfo);

  const [refreshing, setRefreshing] = useState(false);
  const [isLoadingRequests, setIsLoadingRequests] = useState(true);
  const [pendingRequests, setPendingRequests] = useState<ClaimRequest[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Shared modal state
  const [selectedRequest, setSelectedRequest] = useState<ClaimRequest | null>(null);
  const [modalText, setModalText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Which modal is open
  const [showDenyModal, setShowDenyModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);

  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Load pending claim requests via backend API (service role key, bypasses RLS entirely)
  // Falls back to Supabase RPC, then direct table query
  const loadClaimRequests = useCallback(async () => {
    try {
      console.log('[ClaimRequests] Loading pending claims via backend API...');

      const session = await getValidSession();
      const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';

      // Primary: backend endpoint uses service role key — no RLS, no JWT email-claim issues
      if (session?.access_token && backendUrl) {
        const resp = await fetch(`${backendUrl}/api/admin/pending-claims`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        });

        console.log('[ClaimRequests] backend API status:', resp.status);

        if (resp.ok) {
          const json = await resp.json() as { success: boolean; claims: Record<string, unknown>[] };
          const count = json.claims?.length ?? 0;
          console.log('[ClaimRequests] backend API result: count=', count);
          if (json.success && json.claims) {
            json.claims.forEach((row) => {
              console.log(`[ClaimRequests] claim id=${row.id} farmstand_id=${row.farmstand_id} farmstand_name=${row.farmstand_name ?? 'n/a'} status=${row.status}`);
            });
            setPendingRequests(json.claims.map((row) => ({
              id: row.id as string,
              farmstand_id: row.farmstand_id as string,
              requester_id: (row.requester_id as string | null) || (row.user_id as string | null),
              requester_email: (row.requester_email as string) || '',
              requester_name: (row.requester_name as string) || '',
              notes: (row.notes as string | null) || null,
              evidence_urls: (row.evidence_urls as string[]) || [],
              status: (row.status as 'pending' | 'approved' | 'denied' | 'needs_more_info') || 'pending',
              reviewed_at: row.reviewed_at as string | null,
              reviewed_by: (row.reviewed_by as string | null) || null,
              admin_message: (row.admin_message as string | null) || null,
              created_at: row.created_at as string,
              farmstand_name: (row.farmstand_name as string | null) || null,
            })));
            return;
          }
        } else {
          const errText = await resp.text();
          console.log('[ClaimRequests] backend API error:', resp.status, errText);
        }
      }

      // Fallback: SECURITY DEFINER RPC (bypasses RLS, checks admin by auth.users email)
      console.log('[ClaimRequests] Falling back to RPC...');
      const { data: rpcData, error: rpcError } = await supabase.rpc<Record<string, unknown>>(
        'get_pending_claims_for_admin',
        {}
      );
      console.log('[ClaimRequests] RPC result:', { count: (rpcData as unknown as Record<string, unknown>[] | null)?.length, error: rpcError?.message });

      if (!rpcError && rpcData) {
        const rows = rpcData as unknown as Record<string, unknown>[];
        setPendingRequests(rows.map((row) => ({
          id: row.id as string,
          farmstand_id: row.farmstand_id as string,
          requester_id: (row.requester_id as string | null) || (row.user_id as string | null),
          requester_email: (row.requester_email as string) || '',
          requester_name: (row.requester_name as string) || '',
          notes: (row.notes as string | null) || null,
          evidence_urls: (row.evidence_urls as string[]) || [],
          status: (row.status as 'pending' | 'approved' | 'denied' | 'needs_more_info') || 'pending',
          reviewed_at: row.reviewed_at as string | null,
          reviewed_by: (row.reviewed_by as string | null) || null,
          admin_message: (row.admin_message as string | null) || null,
          created_at: row.created_at as string,
          farmstand_name: (row.farmstand_name as string | null) || null,
        })));
        return;
      }

      // Last resort: direct table query (may be filtered by RLS)
      console.log('[ClaimRequests] Falling back to direct table query:', rpcError?.message);
      const { data, error } = await supabase
        .from<Record<string, unknown>>('claim_requests')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .execute();

      console.log('[ClaimRequests] direct fetch result:', { count: data?.length, error: error?.message });

      if (error) {
        console.log('[ClaimRequests] direct fetch error:', error.message);
        return;
      }

      if (data) {
        setPendingRequests(data.map((row: Record<string, unknown>) => ({
          id: row.id as string,
          farmstand_id: row.farmstand_id as string,
          requester_id: (row.requester_id as string | null) || (row.user_id as string | null),
          requester_email: (row.requester_email as string) || '',
          requester_name: (row.requester_name as string) || '',
          notes: (row.additional_notes as string | null) || (row.notes as string | null) || (row.message as string | null) || null,
          evidence_urls: (row.evidence_urls as string[]) || [],
          status: (row.status as 'pending' | 'approved' | 'denied' | 'needs_more_info') || 'pending',
          reviewed_at: row.reviewed_at as string | null,
          reviewed_by: (row.reviewed_by as string | null) || null,
          admin_message: (row.admin_message as string | null) || null,
          created_at: row.created_at as string,
        })));
      }
    } catch (err) {
      console.error('[ClaimRequests] loadClaimRequests exception:', err);
      setPendingRequests([]);
    } finally {
      setIsLoadingRequests(false);
    }
  }, []);

  // Refresh on screen focus (same as dashboard)
  useFocusEffect(
    useCallback(() => {
      console.log('[ClaimRequests] Screen focused - loading claim requests');
      // Debug: print session state on every screen focus so TestFlight logs show it
      getValidSession().then((sess) => {
        console.log('[ClaimRequests] Session on focus:', sess
          ? `valid, expires_at=${sess.expires_at}, token_prefix=${sess.access_token.slice(0, 12)}…`
          : 'MISSING — no session found');
      });
      loadAdminData();
      loadClaimRequests();
    }, [loadClaimRequests])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadAdminData(), loadClaimRequests()]);
    setRefreshing(false);
  };

  const handleApprove = async (request: ClaimRequest) => {
    if (processingId) return;
    setProcessingId(request.id);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Pre-flight: ensure session is loaded and fresh before making authenticated RPC call
      const session = await getValidSession();
      console.log('[ClaimRequests] handleApprove session check:', session
        ? `valid, expires_at=${session.expires_at}`
        : 'MISSING');
      if (!session?.access_token) {
        Alert.alert(
          'Session Missing',
          'Your session has expired. Please go back, sign out, and sign in again.',
        );
        return;
      }

      // Use the approve_claim RPC which does a clean UPDATE by PK — no constraint issues
      const { data, error } = await supabase.rpc<{ success: boolean; error?: string }>(
        'approve_claim',
        { p_claim_id: request.id }
      );

      console.log('[ClaimRequests] approve_claim RPC result:', { data, error });

      if (error) {
        Alert.alert('Approve Failed', error.message);
        return;
      }

      if (data && !data.success) {
        Alert.alert('Approve Failed', data.error ?? 'Unknown error');
        return;
      }

      // Remove from UI immediately
      setPendingRequests((prev) => prev.filter((x) => x.id !== request.id));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast('Claim approved!', 'success');

      try {
        if (request.requester_id) logClaimApproved(request.farmstand_id, request.requester_id);
      } catch {}

      // Invalidate map cache so the updated farmstand data is shown on next map view
      await AsyncStorage.removeItem(MAP_FARMSTANDS_CACHE_KEY).catch(() => {});
      // Refresh the specific farmstand in the store so FarmstandDetail / Profile see live data
      await refreshSingleFarmstand(request.farmstand_id)
        .then(() => {
          console.log('[claim] refetched farmstand state after approve', request.farmstand_id);
        })
        .catch(() => {});
      await Promise.all([loadAdminData(), loadClaimRequests()]);
    } catch (e: unknown) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Approve Failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setProcessingId(null);
    }
  };

  // Opens the deny modal (no direct RPC — we collect a message first)
  const handleDeny = (request: ClaimRequest) => {
    setSelectedRequest(request);
    setModalText('');
    setShowDenyModal(true);
  };

  const handleSubmitDeny = async () => {
    if (!selectedRequest || !user?.id) return;

    Keyboard.dismiss();
    setIsSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Capture refs before any async work so they stay stable in finally/catch
    const denyingRequest = selectedRequest;

    // OPTIMISTIC: clear ownership immediately so the claimant's screens update
    applyClaimOverride(denyingRequest.farmstand_id, {
      claimStatus: 'unclaimed',
      ownerId: null,
      claimedBy: null,
      claimedAt: null,
      userClaimRequestStatus: 'none',
    });
    console.log('[ClaimRequests] optimistic deny applied for farmstand', denyingRequest.farmstand_id);

    try {
      const session = await getValidSession();
      console.log('[ClaimRequests] handleSubmitDeny session:', session ? `ok token=...${session.access_token.slice(-8)}` : 'MISSING');
      if (!session?.access_token) {
        clearClaimOverride(denyingRequest.farmstand_id);
        Alert.alert('Session Missing', 'Your session has expired. Please sign out and sign in again.');
        return;
      }

      const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';
      const requestBody = {
        claim_id: denyingRequest.id,
        ...(modalText.trim() ? { admin_message: modalText.trim() } : {}),
      };
      console.log('[ClaimRequests] handleSubmitDeny payload:', JSON.stringify(requestBody));

      const resp = await fetch(`${backendUrl}/api/admin/deny-claim`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      console.log('[ClaimRequests] handleSubmitDeny response status:', resp.status);
      const json = await resp.json() as { success: boolean; error?: string };
      console.log('[ClaimRequests] handleSubmitDeny response body:', JSON.stringify(json));

      if (!resp.ok || !json.success) {
        const errMsg = json.error || `Server error ${resp.status}`;
        console.log('[ClaimRequests] handleSubmitDeny failed:', errMsg);
        clearClaimOverride(denyingRequest.farmstand_id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showToast('Failed to deny claim. Please try again.', 'error');
        return;
      }

      // Success path
      console.log('[ClaimRequests] handleSubmitDeny success — closing modal');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowDenyModal(false);
      setSelectedRequest(null);
      setModalText('');
      setPendingRequests((prev) => prev.filter((x) => x.id !== denyingRequest.id));
      showToast('Claim denied', 'success');

      try {
        if (denyingRequest.requester_id) logClaimDenied(denyingRequest.farmstand_id, denyingRequest.requester_id);
      } catch {}

      // Invalidate map cache and refresh farmstand state
      await AsyncStorage.removeItem(MAP_FARMSTANDS_CACHE_KEY).catch(() => {});
      await refreshSingleFarmstand(denyingRequest.farmstand_id)
        .then(() => {
          clearClaimOverride(denyingRequest.farmstand_id);
          console.log('[ClaimRequests] farmstand state refreshed after deny', denyingRequest.farmstand_id);
        })
        .catch(() => {});
      await Promise.all([loadAdminData(), loadClaimRequests()]);
    } catch (e: unknown) {
      console.log('[ClaimRequests] handleSubmitDeny exception:', e instanceof Error ? e.message : String(e));
      clearClaimOverride(denyingRequest.farmstand_id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast('Failed to deny claim. Please try again.', 'error');
    } finally {
      console.log('[ClaimRequests] handleSubmitDeny finally — clearing isSubmitting');
      setIsSubmitting(false);
    }
  };

  const handleRequestInfo = (request: ClaimRequest) => {
    setSelectedRequest(request);
    setModalText('');
    setShowInfoModal(true);
  };

  const handleSubmitInfoRequest = async () => {
    if (!selectedRequest || !user?.id || !modalText.trim()) return;

    Keyboard.dismiss();
    setIsSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const result = await requestMoreInfo(selectedRequest.id, user.id, modalText.trim());

    setIsSubmitting(false);

    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowInfoModal(false);
      setSelectedRequest(null);
      setModalText('');
      showToast('More info requested', 'success');
      await loadClaimRequests();
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast('Failed to send request. Please try again.', 'error');
    }
  };

  // Don't render anything until auth has loaded
  if (!authReady) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: BG_COLOR }}>
        <ActivityIndicator size="large" color="#8B5CF6" />
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: BG_COLOR }}>
      {/* Toast notification */}
      {toastMessage && (
        <Animated.View
          entering={FadeIn.duration(200)}
          className={`absolute top-16 left-5 right-5 z-50 rounded-2xl px-5 py-4 flex-row items-center ${
            toastMessage.type === 'success' ? 'bg-green-600' : 'bg-red-600'
          }`}
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 8,
            elevation: 8,
          }}
        >
          {toastMessage.type === 'success' ? (
            <Check size={20} color="white" />
          ) : (
            <AlertCircle size={20} color="white" />
          )}
          <Text className="text-white font-medium ml-3 flex-1">{toastMessage.text}</Text>
        </Animated.View>
      )}
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />
        }
      >
        {/* Hero Header */}
        <Animated.View entering={FadeIn.duration(500)}>
          <LinearGradient
            colors={['#7C3AED', '#8B5CF6', '#A78BFA']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              paddingTop: 0,
              paddingBottom: 60,
              borderBottomLeftRadius: 32,
              borderBottomRightRadius: 32,
            }}
          >
            <SafeAreaView edges={['top']}>
              <View className="px-5 pt-4">
                {/* Back Button */}
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.back();
                  }}
                  className="w-10 h-10 bg-white/20 rounded-full items-center justify-center mb-4"
                >
                  <ArrowLeft size={22} color="white" />
                </Pressable>

                {/* Page Info */}
                <View className="items-center pb-4">
                  <View
                    className="w-16 h-16 rounded-full items-center justify-center mb-3"
                    style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
                  >
                    <ShieldCheck size={32} color="white" />
                  </View>
                  <Text className="text-white text-2xl font-bold">Ownership Claims</Text>
                  <Text className="text-purple-200 text-sm mt-1">
                    Review requests to own an existing farmstand
                  </Text>
                </View>
              </View>
            </SafeAreaView>
          </LinearGradient>
        </Animated.View>

        {/* Stats Card - overlapping hero */}
        <View className="px-5 -mt-10">
          <Animated.View
            entering={FadeInDown.delay(100).duration(400)}
            className="bg-white rounded-2xl p-5 flex-row items-center justify-between"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.08,
              shadowRadius: 16,
              elevation: 5,
            }}
          >
            <View>
              <Text className="text-3xl font-bold text-amber-500">{pendingRequests.length}</Text>
              <Text className="text-sm text-stone-500 mt-1">Pending Ownership Claims</Text>
            </View>
            <View className="w-14 h-14 rounded-full bg-amber-100 items-center justify-center">
              <ShieldCheck size={28} color="#F59E0B" />
            </View>
          </Animated.View>
        </View>

        {/* Requests List */}
        <View className="px-5 pt-6">
          {isLoadingRequests && pendingRequests.length === 0 ? (
            <View className="items-center justify-center py-12">
              <ActivityIndicator size="large" color="#8B5CF6" />
              <Text className="text-stone-500 mt-4">Loading requests...</Text>
            </View>
          ) : pendingRequests.length === 0 ? (
            <Animated.View
              entering={FadeInDown.delay(200).duration(400)}
              className="bg-white rounded-[20px] p-8 items-center"
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 3 },
                shadowOpacity: 0.06,
                shadowRadius: 12,
                elevation: 3,
              }}
            >
              <View className="w-16 h-16 rounded-full bg-green-100 items-center justify-center mb-4">
                <CheckCircle size={32} color="#16A34A" />
              </View>
              <Text className="text-stone-900 font-semibold text-lg mb-1">All caught up!</Text>
              <Text className="text-stone-500 text-center">
                No pending ownership claims to review.
              </Text>
            </Animated.View>
          ) : (
            pendingRequests.map((request, index) => {
              const farmstand = getFarmstandById(request.farmstand_id);
              const displayName = farmstand?.name ?? request.farmstand_name ?? 'Unknown Farmstand';
              const displayLocation = farmstand ? `${farmstand.city}, ${farmstand.state}` : 'Unknown Location';
              return (
                <ClaimRequestCard
                  key={request.id}
                  request={request}
                  farmstandName={displayName}
                  farmstandLocation={displayLocation}
                  onApprove={() => handleApprove(request)}
                  onDeny={() => handleDeny(request)}
                  onRequestInfo={() => handleRequestInfo(request)}
                  isProcessing={processingId === request.id}
                  delay={200 + index * 50}
                />
              );
            })
          )}
        </View>
      </ScrollView>

      {/* Deny Modal */}
      <Modal
        visible={showDenyModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          Keyboard.dismiss();
          setShowDenyModal(false);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, backgroundColor: BG_COLOR }}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={{ flex: 1 }}>
              {/* Header */}
              <SafeAreaView edges={['top']} style={{ backgroundColor: '#fff' }}>
                <View className="flex-row items-center justify-between px-5 py-4 border-b border-stone-200 bg-white">
                  <Pressable onPress={() => { Keyboard.dismiss(); setShowDenyModal(false); }}>
                    <X size={24} color="#374151" />
                  </Pressable>
                  <Text className="text-stone-900 font-bold text-lg">Deny Claim</Text>
                  <View style={{ width: 24 }} />
                </View>
              </SafeAreaView>

              {/* Scrollable body */}
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ padding: 20, paddingBottom: 8 }}
                showsVerticalScrollIndicator={false}
              >
                <View className="flex-row items-center bg-red-50 rounded-2xl p-4 mb-6">
                  <AlertCircle size={20} color="#EF4444" />
                  <Text className="text-red-800 ml-3 flex-1 text-sm">
                    This will deny the ownership claim. The farmstand listing remains unchanged. You can optionally include a reason for the requester.
                  </Text>
                </View>

                <Text className="text-stone-700 font-semibold mb-3">Reason for denial (optional)</Text>
                <TextInput
                  className="bg-white border border-stone-200 rounded-2xl p-4 text-stone-800"
                  placeholder="e.g., Insufficient evidence of ownership provided..."
                  placeholderTextColor="#9CA3AF"
                  value={modalText}
                  onChangeText={setModalText}
                  multiline
                  textAlignVertical="top"
                  blurOnSubmit={false}
                  style={{
                    minHeight: 140,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.04,
                    shadowRadius: 8,
                    elevation: 2,
                  }}
                />
              </ScrollView>

              {/* Fixed footer — rides above keyboard via KeyboardAvoidingView */}
              <View className="px-5 pb-6 pt-4 bg-white border-t border-stone-200">
                <Pressable
                  onPress={handleSubmitDeny}
                  disabled={isSubmitting}
                  className={`py-4 rounded-2xl flex-row items-center justify-center ${
                    !isSubmitting ? 'bg-red-500' : 'bg-stone-200'
                  }`}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <>
                      <XCircle size={18} color="white" />
                      <Text className="text-white font-semibold ml-2">Deny Claim</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* Request More Info Modal */}
      <Modal
        visible={showInfoModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          Keyboard.dismiss();
          setShowInfoModal(false);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, backgroundColor: BG_COLOR }}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={{ flex: 1 }}>
              {/* Header */}
              <SafeAreaView edges={['top']} style={{ backgroundColor: '#fff' }}>
                <View className="flex-row items-center justify-between px-5 py-4 border-b border-stone-200 bg-white">
                  <Pressable onPress={() => { Keyboard.dismiss(); setShowInfoModal(false); }}>
                    <X size={24} color="#374151" />
                  </Pressable>
                  <Text className="text-stone-900 font-bold text-lg">Request More Info</Text>
                  <View style={{ width: 24 }} />
                </View>
              </SafeAreaView>

              {/* Scrollable body */}
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ padding: 20, paddingBottom: 8 }}
                showsVerticalScrollIndicator={false}
              >
                <View className="flex-row items-center bg-amber-50 rounded-2xl p-4 mb-6">
                  <AlertCircle size={20} color="#F59E0B" />
                  <Text className="text-amber-800 ml-3 flex-1 text-sm">
                    This will notify the requester that additional information is needed.
                  </Text>
                </View>

                <Text className="text-stone-700 font-semibold mb-3">What information do you need?</Text>
                <TextInput
                  className="bg-white border border-stone-200 rounded-2xl p-4 text-stone-800"
                  placeholder="e.g., Please provide a photo of your business license or proof of ownership..."
                  placeholderTextColor="#9CA3AF"
                  value={modalText}
                  onChangeText={setModalText}
                  multiline
                  textAlignVertical="top"
                  blurOnSubmit={false}
                  style={{
                    minHeight: 140,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.04,
                    shadowRadius: 8,
                    elevation: 2,
                  }}
                />
              </ScrollView>

              {/* Fixed footer — rides above keyboard via KeyboardAvoidingView */}
              <View className="px-5 pb-6 pt-4 bg-white border-t border-stone-200">
                <Pressable
                  onPress={handleSubmitInfoRequest}
                  disabled={!modalText.trim() || isSubmitting}
                  className={`py-4 rounded-2xl flex-row items-center justify-center ${
                    modalText.trim() && !isSubmitting ? 'bg-amber-500' : 'bg-stone-200'
                  }`}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <>
                      <MessageCircle size={18} color={modalText.trim() ? 'white' : '#9CA3AF'} />
                      <Text
                        className={`ml-2 font-semibold ${
                          modalText.trim() ? 'text-white' : 'text-stone-400'
                        }`}
                      >
                        Send Request
                      </Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

export default function AdminClaimRequests() {
  return (
    <AdminGuard>
      <AdminClaimRequestsContent />
    </AdminGuard>
  );
}
