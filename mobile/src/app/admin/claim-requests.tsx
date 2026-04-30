import React, { useState, useCallback, useEffect } from 'react';
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
  Keyboard,
  Platform,
  Dimensions,
  Share,
} from 'react-native';
import ImageViewing from 'react-native-image-viewing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
  ZoomIn,
  RefreshCw,
  Send,
  Copy,
  Bug,
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

// ── TEMPORARY: Claim Push Debug Panel ─────────────────────────────────────────
// Admin-only debug tool. Remove after push notifications are confirmed working.
interface ClaimPushDebugInfo {
  claimId: string | null;
  farmstandId: string | null;
  claimUserId: string | null;
  adminUserId: string | null;
  claimStatusBefore: string | null;
  claimStatusAfter: string;
  pushTargetUserId: string | null;
  profileToken: string | null;
  userPushTokensCount: number;
  userPushTokenValues: string[];
  pushPayload: { title: string; body: string; data: Record<string, unknown> } | null;
  pushResult: 'not_started' | 'sending' | 'success' | 'failed' | 'skipped';
  expoResponse: { status: number; body: string } | null;
  pushError: string | null;
  alertCreated: boolean;
  alertError: string | null;
  timestamp: string;
}

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
  onPhotoPress: (urls: string[], index: number) => void;
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
  onPhotoPress,
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
            <View className="flex-row items-center mb-2">
              <Text className="text-stone-600 text-sm font-medium">Evidence Photos</Text>
              <Text className="text-stone-400 text-xs ml-2">({request.evidence_urls.length}) · tap to expand</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {request.evidence_urls.map((url, index) => (
                  <Pressable
                    key={index}
                    onPress={() => onPhotoPress(request.evidence_urls, index)}
                    style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
                  >
                    <View>
                      {typeof url === 'string' && url.trim().length > 0 ? (
                        <Image
                          source={{ uri: url }}
                          style={{ width: 120, height: 120, borderRadius: 12 }}
                          resizeMode="cover"
                        />
                      ) : (
                        <View
                          style={{
                            width: 120,
                            height: 120,
                            borderRadius: 12,
                            backgroundColor: '#E7E5E4',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <AlertCircle size={24} color="#A8A29E" />
                        </View>
                      )}
                      <View
                        style={{
                          position: 'absolute',
                          bottom: 6,
                          right: 6,
                          backgroundColor: 'rgba(0,0,0,0.45)',
                          borderRadius: 6,
                          padding: 3,
                        }}
                      >
                        <ZoomIn size={13} color="white" />
                      </View>
                    </View>
                  </Pressable>
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

        {/* Needs More Info badge */}
        {(request.status === 'needs_more_info' || !!request.admin_message) && (
          <View
            style={{
              backgroundColor: '#FEF3C7',
              borderRadius: 12,
              padding: 12,
              marginBottom: 12,
              borderWidth: 1,
              borderColor: '#FDE68A',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: request.admin_message ? 4 : 0 }}>
              <MessageCircle size={14} color="#B45309" />
              <Text style={{ color: '#B45309', fontSize: 12, fontWeight: '700', marginLeft: 6 }}>
                More information requested
              </Text>
            </View>
            {request.admin_message ? (
              <Text style={{ color: '#92400E', fontSize: 12, lineHeight: 17, marginTop: 2 }}>
                "{request.admin_message}"
              </Text>
            ) : null}
          </View>
        )}

        {/* Action Buttons - show for all awaiting-review statuses */}
        {(['pending', 'submitted', 'requested', 'needs_more_info'] as string[]).includes(request.status) && (
          <View style={{ gap: 8 }}>
            {/* Row 1: Approve + Deny */}
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
            </View>
            {/* Row 2: Request Info (secondary, outlined) */}
            <Pressable
              onPress={onRequestInfo}
              disabled={isProcessing}
              style={{
                borderWidth: 1.5,
                borderColor: '#A8A29E',
                borderRadius: 16,
                paddingVertical: 11,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                opacity: isProcessing ? 0.4 : 1,
              }}
            >
              <MessageCircle size={16} color="#57534E" />
              <Text style={{ color: '#57534E', fontWeight: '600', fontSize: 14 }}>
                {request.status === 'needs_more_info' || !!request.admin_message ? 'Update Request' : 'Request Info'}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

// ── TEMPORARY: Push Debug Panel ────────────────────────────────────────────────
// Shows after claim approval to diagnose push notification delivery.

function truncateToken(token: string | null): string {
  if (!token) return 'NULL';
  if (token.length <= 40) return token;
  return token.slice(0, 20) + '…' + token.slice(-12);
}

function DebugRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ fontSize: 10, fontWeight: '700', color: '#78716C', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>
        {label}
      </Text>
      <Text
        style={{
          fontSize: 13,
          color: '#1C1917',
          fontFamily: mono ? Platform.OS === 'ios' ? 'Courier New' : 'monospace' : undefined,
          lineHeight: 18,
        }}
        selectable
      >
        {value}
      </Text>
    </View>
  );
}

function PushStatusBadge({ result }: { result: ClaimPushDebugInfo['pushResult'] }) {
  const colors: Record<ClaimPushDebugInfo['pushResult'], { bg: string; text: string; label: string }> = {
    not_started: { bg: '#E7E5E4', text: '#78716C', label: 'Not Started' },
    sending: { bg: '#DBEAFE', text: '#1D4ED8', label: 'Sending…' },
    success: { bg: '#DCFCE7', text: '#15803D', label: '✅ Success' },
    failed: { bg: '#FEE2E2', text: '#DC2626', label: '❌ Failed' },
    skipped: { bg: '#FEF3C7', text: '#B45309', label: '⚠️ Skipped' },
  };
  const c = colors[result];
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
      <Text style={{ color: c.text, fontWeight: '700', fontSize: 13 }}>{c.label}</Text>
    </View>
  );
}

interface PushDebugModalProps {
  visible: boolean;
  debugInfo: ClaimPushDebugInfo | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onTestPush: () => Promise<void>;
  onCopy: () => void;
  isRefreshing: boolean;
  isTestPushSending: boolean;
}

function PushDebugModal({
  visible,
  debugInfo,
  onClose,
  onRefresh,
  onTestPush,
  onCopy,
  isRefreshing,
  isTestPushSending,
}: PushDebugModalProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: '#FAF7F2', paddingBottom: insets.bottom }}>
        {/* Header */}
        <SafeAreaView edges={['top']} style={{ backgroundColor: '#1C1917' }}>
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingVertical: 14,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Bug size={18} color="#FCD34D" />
              <Text style={{ color: '#FCD34D', fontWeight: '700', fontSize: 15 }}>
                PUSH DEBUG PANEL
              </Text>
              <Text style={{ color: '#78716C', fontSize: 10, fontWeight: '600' }}>ADMIN ONLY</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <X size={22} color="#A8A29E" />
            </Pressable>
          </View>
        </SafeAreaView>

        {/* Body */}
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        >
          {!debugInfo ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <ActivityIndicator color="#8B5CF6" />
              <Text style={{ color: '#78716C', marginTop: 12 }}>Loading debug info…</Text>
            </View>
          ) : (
            <>
              {/* Push Status Banner */}
              <View style={{
                backgroundColor: '#1C1917',
                borderRadius: 16,
                padding: 14,
                marginBottom: 16,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <Text style={{ color: '#E7E5E4', fontWeight: '600', fontSize: 14 }}>Push Send Result</Text>
                <PushStatusBadge result={debugInfo.pushResult} />
              </View>

              {/* Main debug card */}
              <View style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 20,
                padding: 16,
                marginBottom: 12,
                borderWidth: 1,
                borderColor: '#E7E5E4',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.05,
                shadowRadius: 8,
                elevation: 2,
              }}>
                <Text style={{ fontWeight: '700', fontSize: 12, color: '#78716C', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 14 }}>
                  IDs &amp; Status
                </Text>
                <DebugRow label="1. Claim ID" value={debugInfo.claimId ?? 'N/A'} mono />
                <DebugRow label="2. Farmstand ID" value={debugInfo.farmstandId ?? 'N/A'} mono />
                <DebugRow label="3. Claim User ID (push recipient)" value={debugInfo.claimUserId ?? 'N/A'} mono />
                <DebugRow label="4. Admin User ID" value={debugInfo.adminUserId ?? 'N/A'} mono />
                <DebugRow label="5. Claim Status Before" value={debugInfo.claimStatusBefore ?? 'unknown'} />
                <DebugRow label="6. Claim Status After" value={debugInfo.claimStatusAfter} />
                <DebugRow label="7. Push Target User ID" value={debugInfo.pushTargetUserId ?? 'N/A'} mono />
              </View>

              {/* Token card */}
              <View style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 20,
                padding: 16,
                marginBottom: 12,
                borderWidth: 1,
                borderColor: '#E7E5E4',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.05,
                shadowRadius: 8,
                elevation: 2,
              }}>
                <Text style={{ fontWeight: '700', fontSize: 12, color: '#78716C', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 14 }}>
                  Push Tokens
                </Text>
                <DebugRow
                  label="8. Profile Token (profiles.expo_push_token)"
                  value={debugInfo.profileToken ? truncateToken(debugInfo.profileToken) : '❌ NULL — no push sent'}
                  mono
                />
                <DebugRow
                  label="9. user_push_tokens rows found"
                  value={String(debugInfo.userPushTokensCount)}
                />
                {debugInfo.userPushTokenValues.length > 0 ? (
                  <DebugRow
                    label="10. Token Values (user_push_tokens)"
                    value={debugInfo.userPushTokenValues.map(truncateToken).join('\n')}
                    mono
                  />
                ) : (
                  <DebugRow label="10. Token Values (user_push_tokens)" value="(none found)'" />
                )}
              </View>

              {/* Payload card */}
              <View style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 20,
                padding: 16,
                marginBottom: 12,
                borderWidth: 1,
                borderColor: '#E7E5E4',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.05,
                shadowRadius: 8,
                elevation: 2,
              }}>
                <Text style={{ fontWeight: '700', fontSize: 12, color: '#78716C', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 14 }}>
                  Push Payload &amp; Result
                </Text>
                {debugInfo.pushPayload ? (
                  <>
                    <DebugRow label="11a. Title" value={debugInfo.pushPayload.title} />
                    <DebugRow label="11b. Body" value={debugInfo.pushPayload.body} />
                    <DebugRow label="11c. Data" value={JSON.stringify(debugInfo.pushPayload.data, null, 2)} mono />
                  </>
                ) : (
                  <DebugRow label="11. Push Payload" value="(not constructed — push skipped)" />
                )}
                <View style={{ marginTop: 4, marginBottom: 10 }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#78716C', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>
                    11d. Push Send Result
                  </Text>
                  <PushStatusBadge result={debugInfo.pushResult} />
                </View>
                {debugInfo.expoResponse && (
                  <DebugRow
                    label="12. Expo Raw Response"
                    value={`HTTP ${debugInfo.expoResponse.status}\n${debugInfo.expoResponse.body}`}
                    mono
                  />
                )}
                {debugInfo.pushError && (
                  <View style={{ backgroundColor: '#FEF2F2', borderRadius: 12, padding: 12, marginTop: 4, marginBottom: 10 }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: '#DC2626', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>
                      13. Push Error
                    </Text>
                    <Text style={{ color: '#7F1D1D', fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' }} selectable>
                      {debugInfo.pushError}
                    </Text>
                  </View>
                )}
              </View>

              {/* Alert + Timestamp card */}
              <View style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 20,
                padding: 16,
                marginBottom: 16,
                borderWidth: 1,
                borderColor: '#E7E5E4',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.05,
                shadowRadius: 8,
                elevation: 2,
              }}>
                <Text style={{ fontWeight: '700', fontSize: 12, color: '#78716C', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 14 }}>
                  Inbox Alert &amp; Timing
                </Text>
                <DebugRow
                  label="14. Alert Created"
                  value={debugInfo.alertCreated ? '✅ Yes' : `❌ No${debugInfo.alertError ? ` — ${debugInfo.alertError}` : ''}`}
                />
                <DebugRow label="15. Timestamp" value={new Date(debugInfo.timestamp).toLocaleString()} />
              </View>

              {/* Action buttons */}
              <View style={{ gap: 10 }}>
                <Pressable
                  onPress={onRefresh}
                  disabled={isRefreshing}
                  style={{
                    backgroundColor: isRefreshing ? '#E7E5E4' : '#F5F0EB',
                    borderRadius: 16,
                    paddingVertical: 14,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    borderWidth: 1,
                    borderColor: '#D7CFC8',
                  }}
                >
                  {isRefreshing ? (
                    <ActivityIndicator size="small" color="#78716C" />
                  ) : (
                    <RefreshCw size={16} color="#57534E" />
                  )}
                  <Text style={{ color: '#57534E', fontWeight: '600', fontSize: 14 }}>
                    {isRefreshing ? 'Refreshing…' : 'Refresh Debug'}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={onTestPush}
                  disabled={isTestPushSending || !debugInfo.claimUserId}
                  style={{
                    backgroundColor: isTestPushSending ? '#E7E5E4' : '#7C3AED',
                    borderRadius: 16,
                    paddingVertical: 14,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    opacity: !debugInfo.claimUserId ? 0.4 : 1,
                  }}
                >
                  {isTestPushSending ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <Send size={16} color="white" />
                  )}
                  <Text style={{ color: 'white', fontWeight: '600', fontSize: 14 }}>
                    {isTestPushSending ? 'Sending Test Push…' : 'Send Test Push To Claim User'}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={onCopy}
                  style={{
                    backgroundColor: '#F5F0EB',
                    borderRadius: 16,
                    paddingVertical: 14,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    borderWidth: 1,
                    borderColor: '#D7CFC8',
                  }}
                >
                  <Copy size={16} color="#57534E" />
                  <Text style={{ color: '#57534E', fontWeight: '600', fontSize: 14 }}>Copy Debug Info</Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
// ── END TEMPORARY PUSH DEBUG PANEL ────────────────────────────────────────────

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

  const insets = useSafeAreaInsets();
  const [modalKbHeight, setModalKbHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent  = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setModalKbHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvent, () => setModalKbHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const modalBottomPad = modalKbHeight > 0 ? modalKbHeight : insets.bottom;


  const [isLoadingRequests, setIsLoadingRequests] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<ClaimRequest[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Shared modal state
  const [selectedRequest, setSelectedRequest] = useState<ClaimRequest | null>(null);
  const [modalText, setModalText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Lightbox state
  const [lightboxImages, setLightboxImages] = useState<{ uri: string }[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxVisible, setLightboxVisible] = useState(false);

  const openLightbox = (urls: string[], index: number) => {
    const safe = urls.filter((u) => typeof u === 'string' && u.trim().length > 0);
    if (safe.length === 0) return;
    setLightboxImages(safe.map((uri) => ({ uri })));
    setLightboxIndex(Math.min(index, safe.length - 1));
    setLightboxVisible(true);
  };

  // Which modal is open
  const [showDenyModal, setShowDenyModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [infoModalError, setInfoModalError] = useState<string | null>(null);

  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // ── TEMPORARY: Push debug panel state ─────────────────────────────────────
  const [debugInfo, setDebugInfo] = useState<ClaimPushDebugInfo | null>(null);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [isRefreshingDebug, setIsRefreshingDebug] = useState(false);
  const [isTestPushSending, setIsTestPushSending] = useState(false);

  const showToast = (text: string, type: 'success' | 'error') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 2500);
  };

  // ── TEMPORARY: Push debug panel handlers ──────────────────────────────────
  const handleDebugRefresh = async () => {
    if (!debugInfo?.claimUserId) return;
    setIsRefreshingDebug(true);
    try {
      const session = await getValidSession();
      const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';
      if (!session?.access_token || !backendUrl) return;
      const params = new URLSearchParams({ user_id: debugInfo.claimUserId });
      if (debugInfo.farmstandId) params.append('farmstand_id', debugInfo.farmstandId);
      const resp = await fetch(`${backendUrl}/api/admin/claim-push-debug?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!resp.ok) return;
      const crct1 = resp.headers.get('content-type') ?? '';
      if (!crct1.includes('application/json')) {
        console.log('[ClaimRequests] claim-push-debug non-JSON response (HTTP', resp.status, '), content-type:', crct1);
        return;
      }
      const json = await resp.json() as {
        success: boolean;
        snapshot?: {
          profileToken: string | null;
          userPushTokensCount: number;
          userPushTokenValues: string[];
          latestAlert: { found: boolean; alertId: string | null; type: string | null; createdAt: string | null };
          timestamp: string;
        };
      };
      if (json.success && json.snapshot) {
        setDebugInfo((prev) => prev ? {
          ...prev,
          profileToken: json.snapshot!.profileToken,
          userPushTokensCount: json.snapshot!.userPushTokensCount,
          userPushTokenValues: json.snapshot!.userPushTokenValues,
          alertCreated: json.snapshot!.latestAlert.found,
          timestamp: json.snapshot!.timestamp,
        } : prev);
      }
    } catch (e) {
      console.log('[DebugPanel] refresh error:', e);
    } finally {
      setIsRefreshingDebug(false);
    }
  };

  const handleDebugTestPush = async () => {
    if (!debugInfo?.claimUserId) return;
    setIsTestPushSending(true);
    try {
      const session = await getValidSession();
      const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';
      if (!session?.access_token || !backendUrl) return;
      const resp = await fetch(`${backendUrl}/api/admin/claim-push-debug/test-push`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: debugInfo.claimUserId,
          farmstand_id: debugInfo.farmstandId ?? undefined,
        }),
      });
      const crct2 = resp.headers.get('content-type') ?? '';
      if (!crct2.includes('application/json')) {
        console.log('[ClaimRequests] test-push non-JSON response (HTTP', resp.status, '), content-type:', crct2);
        return;
      }
      const json = await resp.json() as {
        success: boolean;
        debug?: {
          profileToken: string | null;
          userPushTokensCount: number;
          userPushTokenValues: string[];
          pushResult: ClaimPushDebugInfo['pushResult'];
          expoResponse: { status: number; body: string } | null;
          pushError: string | null;
          timestamp: string;
        };
      };
      if (json.debug) {
        setDebugInfo((prev) => prev ? {
          ...prev,
          profileToken: json.debug!.profileToken,
          userPushTokensCount: json.debug!.userPushTokensCount,
          userPushTokenValues: json.debug!.userPushTokenValues,
          pushResult: json.debug!.pushResult,
          expoResponse: json.debug!.expoResponse,
          pushError: json.debug!.pushError,
          timestamp: json.debug!.timestamp,
        } : prev);
      }
    } catch (e) {
      console.log('[DebugPanel] test push error:', e);
    } finally {
      setIsTestPushSending(false);
    }
  };

  const handleDebugCopy = () => {
    if (!debugInfo) return;
    const lines = [
      `=== CLAIM PUSH DEBUG ===`,
      `Timestamp: ${debugInfo.timestamp}`,
      ``,
      `Claim ID: ${debugInfo.claimId ?? 'N/A'}`,
      `Farmstand ID: ${debugInfo.farmstandId ?? 'N/A'}`,
      `Claim User ID: ${debugInfo.claimUserId ?? 'N/A'}`,
      `Admin User ID: ${debugInfo.adminUserId ?? 'N/A'}`,
      `Claim Status Before: ${debugInfo.claimStatusBefore ?? 'N/A'}`,
      `Claim Status After: ${debugInfo.claimStatusAfter}`,
      `Push Target User ID: ${debugInfo.pushTargetUserId ?? 'N/A'}`,
      ``,
      `Profile Token: ${debugInfo.profileToken ?? 'NULL'}`,
      `user_push_tokens count: ${debugInfo.userPushTokensCount}`,
      `user_push_tokens values: ${debugInfo.userPushTokenValues.join(', ') || '(none)'}`,
      ``,
      `Push Payload Title: ${debugInfo.pushPayload?.title ?? 'N/A'}`,
      `Push Payload Body: ${debugInfo.pushPayload?.body ?? 'N/A'}`,
      `Push Payload Data: ${JSON.stringify(debugInfo.pushPayload?.data ?? {})}`,
      ``,
      `Push Result: ${debugInfo.pushResult}`,
      `Expo Response: ${debugInfo.expoResponse ? `HTTP ${debugInfo.expoResponse.status} ${debugInfo.expoResponse.body}` : 'N/A'}`,
      `Push Error: ${debugInfo.pushError ?? 'none'}`,
      ``,
      `Alert Created: ${debugInfo.alertCreated ? 'YES' : 'NO'}`,
      `Alert Error: ${debugInfo.alertError ?? 'none'}`,
    ];
    Share.share({ message: lines.join('\n'), title: 'Claim Push Debug Info' }).catch(() => {});
  };
  // ── END TEMPORARY: Push debug panel handlers ───────────────────────────────

  // Load pending claim requests via backend API (service role key, bypasses RLS entirely)
  // Falls back to Supabase RPC, then direct table query
  const loadClaimRequests = useCallback(async () => {
    try {
      const session = await getValidSession();
      const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';

      if (__DEV__) console.log('[ClaimRequests] loadClaimRequests — backendUrl:', backendUrl || '(not configured)');

      // Primary: backend endpoint — wrapped in its own try/catch so network errors fall through to Supabase fallback
      if (session?.access_token && backendUrl) {
        try {
          if (__DEV__) console.log('[ClaimRequests] Loading pending claims via backend API:', `${backendUrl}/api/admin/pending-claims`);
          const resp = await fetch(`${backendUrl}/api/admin/pending-claims`, {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
          });

          console.log('[ClaimRequests] backend API status:', resp.status);

          const crct3 = resp.headers.get('content-type') ?? '';
          if (resp.ok && crct3.includes('application/json')) {
            const json = await resp.json() as { success: boolean; claims: Record<string, unknown>[] };
            const count = json.claims?.length ?? 0;
            const statusSummary = json.claims?.map(r => r.status).join(', ') || 'none';
            console.log('[ClaimRequests] backend API result: count=', count, '| statuses:', statusSummary);
            if (json.success && json.claims) {
              json.claims.forEach((row) => {
                console.log(`[ClaimRequests] claim id=${row.id} farmstand_id=${row.farmstand_id} farmstand_name=${row.farmstand_name ?? 'n/a'} status=${row.status}`);
              });
              const mapped = json.claims.map((row) => ({
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
              }));
              if (__DEV__) console.log('[ClaimRequests] backend mapped rows:', mapped.length, '| first:', mapped[0] ? `id=${mapped[0].id} status=${mapped[0].status}` : 'none');
              setPendingRequests(mapped);
              return;
            }
          } else {
            const errText = await resp.text();
            if (__DEV__) console.warn('[ClaimRequests] backend API error:', resp.status, errText.slice(0, 200));
          }
        } catch (backendErr) {
          if (__DEV__) console.warn('[ClaimRequests] backend fetch exception (falling back to Supabase):', backendErr);
        }
      }

      // Fallback: authenticated Supabase direct query — same pattern as dashboard count
      console.log('[ClaimRequests] Using authenticated Supabase fallback...');
      const { data, error } = await supabase
        .from<Record<string, unknown>>('claim_requests')
        .select('*')
        .in('status', ['pending', 'needs_more_info'])
        .requireAuth()
        .order('created_at', { ascending: false })
        .execute();

      console.log('[ClaimRequests] Supabase fallback raw row count:', data?.length ?? 0, '| error:', error?.message ?? 'none');

      if (error) {
        if (__DEV__) console.warn('[ClaimRequests] Supabase fallback error:', error.message);
        setPendingRequests([]);
        return;
      }

      const rows = data ?? [];
      const mapped = rows.map((row: Record<string, unknown>) => ({
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
        farmstand_name: null,
      }));

      if (__DEV__) {
        console.log('[ClaimRequests] Supabase fallback mapped rows:', mapped.length);
        if (mapped.length > 0) {
          console.log('[ClaimRequests] Supabase fallback first row — id:', mapped[0].id, '| status:', mapped[0].status, '| farmstand_id:', mapped[0].farmstand_id);
        }
      }

      setPendingRequests(mapped);
      console.log('[ClaimRequests] pendingRequests set to', mapped.length, 'rows');
    } catch (err) {
      if (__DEV__) console.warn('[ClaimRequests] loadClaimRequests exception:', err);
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

      if (__DEV__) console.log('[ClaimRequests] approve_claim RPC — claim_id:', request.id, '| claimant user_id:', request.requester_id ?? 'MISSING', '| farmstand_id:', request.farmstand_id);

      // Use the approve_claim RPC which does a clean UPDATE by PK — no constraint issues
      const { data, error } = await supabase.rpc<{ success: boolean; error?: string }>(
        'approve_claim',
        { p_claim_id: request.id }
      );

      if (__DEV__) console.log('[ClaimRequests] approve_claim RPC result — data:', JSON.stringify(data), '| error:', error?.message ?? null);
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

      // Send push notification to the new owner (best-effort, non-blocking)
      if (request.requester_id) {
        const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';
        const farmstand = getFarmstandById(request.farmstand_id);
        try {
          console.log('[ClaimRequests] Sending approval push to user:', request.requester_id);
          const pushResp = await fetch(`${backendUrl}/api/admin/approve-claim-push`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              user_id: request.requester_id,
              farmstand_id: request.farmstand_id,
              farmstand_name: farmstand?.name ?? request.farmstand_name ?? undefined,
              claim_id: request.id,
              claim_status_before: request.status ?? 'pending',
            }),
          });
          console.log('[ClaimRequests] Approval push result:', pushResp.status);
        } catch (pushErr) {
          console.log('[ClaimRequests] Approval push failed (non-fatal):', pushErr);
        }
      }

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

    // Capture before async work so refs stay stable in finally/catch
    const denyingRequest = selectedRequest;
    const denialReason = modalText.trim() || null;

    if (__DEV__) {
      console.log('[ClaimRequests] handleSubmitDeny — claim id:', denyingRequest.id);
      console.log('[ClaimRequests] handleSubmitDeny — denial reason:', denialReason ?? '(none)');
    }

    // Optimistic: clear ownership immediately so claimant screens update
    applyClaimOverride(denyingRequest.farmstand_id, {
      claimStatus: 'unclaimed',
      ownerId: null,
      claimedBy: null,
      claimedAt: null,
      userClaimRequestStatus: 'none',
    });

    try {
      const session = await getValidSession();
      if (!session?.access_token) {
        clearClaimOverride(denyingRequest.farmstand_id);
        Alert.alert('Session Missing', 'Your session has expired. Please sign out and sign in again.');
        return;
      }

      const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';
      let denied = false;

      // Primary: backend API — wrapped in its own try/catch so network errors fall through
      if (backendUrl) {
        try {
          if (__DEV__) console.log('[ClaimRequests] deny — backend URL:', `${backendUrl}/api/admin/deny-claim`);
          const requestBody = {
            claim_id: denyingRequest.id,
            ...(denialReason ? { admin_message: denialReason } : {}),
          };
          const resp = await fetch(`${backendUrl}/api/admin/deny-claim`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          });
          if (__DEV__) console.log('[ClaimRequests] deny backend response status:', resp.status);
          const crct4 = resp.headers.get('content-type') ?? '';
          if (resp.ok && crct4.includes('application/json')) {
            const json = await resp.json() as { success: boolean; error?: string };
            if (__DEV__) console.log('[ClaimRequests] deny backend response body:', JSON.stringify(json));
            if (json.success) {
              denied = true;
            } else {
              if (__DEV__) console.warn('[ClaimRequests] deny backend returned failure:', json.error);
            }
          } else {
            if (__DEV__) console.warn('[ClaimRequests] deny backend non-JSON or error status:', resp.status);
          }
        } catch (backendErr) {
          if (__DEV__) console.warn('[ClaimRequests] deny backend exception (falling back to Supabase):', backendErr);
        }
      } else {
        if (__DEV__) console.log('[ClaimRequests] deny — no BACKEND_URL configured, using Supabase directly');
      }

      // Fallback: authenticated Supabase direct update
      if (!denied) {
        if (__DEV__) console.log('[ClaimRequests] deny — using Supabase fallback for claim id:', denyingRequest.id);
        const now = new Date().toISOString();
        const { data: updateData, error: updateError } = await supabase
          .from<Record<string, unknown>>('claim_requests')
          .update({
            status: 'denied',
            admin_message: denialReason,
            reviewed_at: now,
            reviewed_by_admin_id: user.id,
          })
          .eq('id', denyingRequest.id)
          .execute();
        if (__DEV__) {
          console.log('[ClaimRequests] deny Supabase update error:', updateError?.message ?? 'none');
          console.log('[ClaimRequests] deny Supabase update data:', JSON.stringify(updateData));
        }
        if (updateError) {
          if (__DEV__) console.warn('[ClaimRequests] deny Supabase update failed:', updateError.message);
          clearClaimOverride(denyingRequest.farmstand_id);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          showToast('Failed to deny claim. Please try again.', 'error');
          return;
        }
        denied = true;
      }

      // Success
      if (__DEV__) console.log('[ClaimRequests] deny success — removing from list and closing modal');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowDenyModal(false);
      setSelectedRequest(null);
      setModalText('');
      setPendingRequests((prev) => prev.filter((x) => x.id !== denyingRequest.id));
      showToast('Claim denied', 'success');

      try {
        if (denyingRequest.requester_id) logClaimDenied(denyingRequest.farmstand_id, denyingRequest.requester_id);
      } catch {}

      await AsyncStorage.removeItem(MAP_FARMSTANDS_CACHE_KEY).catch(() => {});
      await refreshSingleFarmstand(denyingRequest.farmstand_id)
        .then(() => {
          clearClaimOverride(denyingRequest.farmstand_id);
        })
        .catch(() => {});
      await Promise.all([loadAdminData(), loadClaimRequests()]);
    } catch (e: unknown) {
      if (__DEV__) console.warn('[ClaimRequests] handleSubmitDeny exception:', e instanceof Error ? e.message : String(e));
      clearClaimOverride(denyingRequest.farmstand_id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast('Failed to deny claim. Please try again.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestInfo = (request: ClaimRequest) => {
    setSelectedRequest(request);
    setModalText('');
    setInfoModalError(null);
    setShowInfoModal(true);
  };

  const handleSubmitInfoRequest = async () => {
    if (!selectedRequest || !user?.id || !modalText.trim()) return;

    Keyboard.dismiss();
    setIsSubmitting(true);
    setInfoModalError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const infoRequest = selectedRequest;
    const infoMessage = modalText.trim();

    try {
      const session = await getValidSession();
      console.log('[RequestInfo] submit — claim_id=', infoRequest.id, 'has_session=', !!session?.access_token);
      if (!session?.access_token) {
        setInfoModalError('Session expired. Please close this screen, sign out, and sign back in.');
        return;
      }

      const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';
      let infoSent = false;

      // Primary: backend API — wrapped in its own try/catch so network errors fall through
      if (backendUrl) {
        try {
          if (__DEV__) console.log('[RequestInfo] posting to', `${backendUrl}/api/admin/request-more-info`);
          const resp = await fetch(`${backendUrl}/api/admin/request-more-info`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              claim_id: infoRequest.id,
              admin_message: infoMessage,
            }),
          });
          if (__DEV__) console.log('[RequestInfo] backend response status:', resp.status);
          const crct = resp.headers.get('content-type') ?? '';
          if (resp.ok && crct.includes('application/json')) {
            const json = await resp.json() as { success: boolean; error?: string };
            if (__DEV__) console.log('[RequestInfo] backend response body:', JSON.stringify(json));
            if (json.success) {
              infoSent = true;
            } else {
              if (__DEV__) console.warn('[RequestInfo] backend returned failure:', json.error);
            }
          } else {
            if (__DEV__) console.warn('[RequestInfo] backend non-JSON or error status:', resp.status);
          }
        } catch (fetchErr) {
          if (__DEV__) console.warn('[RequestInfo] backend fetch exception (falling back to Supabase):', fetchErr);
        }
      } else {
        if (__DEV__) console.log('[RequestInfo] no BACKEND_URL configured, using Supabase directly');
      }

      // Fallback: authenticated Supabase direct update
      if (!infoSent) {
        if (__DEV__) console.log('[RequestInfo] using Supabase fallback for claim id:', infoRequest.id);
        const { data: updateData, error: updateError } = await supabase
          .from<Record<string, unknown>>('claim_requests')
          .update({
            status: 'needs_more_info',
            admin_message: infoMessage,
            reviewed_at: new Date().toISOString(),
          })
          .eq('id', infoRequest.id)
          .select('id,status,admin_message')
          .requireAuth()
          .execute();
        if (__DEV__) {
          console.log('[RequestInfo] Supabase update error:', updateError?.message ?? 'none');
          console.log('[RequestInfo] Supabase update data:', JSON.stringify(updateData));
        }
        if (updateError) {
          if (__DEV__) console.warn('[RequestInfo] Supabase update failed:', updateError.message);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setInfoModalError(updateError.message || 'Failed to send request. Please try again.');
          return;
        }
        infoSent = true;
      }

      // Success
      if (__DEV__) console.log('[RequestInfo] info request sent successfully');
      const now = new Date().toISOString();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowInfoModal(false);
      setSelectedRequest(null);
      setModalText('');
      setInfoModalError(null);
      setPendingRequests((prev) =>
        prev.map((r) =>
          r.id === infoRequest.id
            ? { ...r, status: 'needs_more_info', admin_message: infoMessage, reviewed_at: now }
            : r
        )
      );
      showToast('Request sent', 'success');
      loadClaimRequests().catch(() => {});
    } catch (e: unknown) {
      if (__DEV__) console.warn('[RequestInfo] unexpected exception:', e instanceof Error ? e.message : String(e));
      setInfoModalError('Something went wrong. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSubmitting(false);
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
                  onPhotoPress={openLightbox}
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
        onRequestClose={() => { Keyboard.dismiss(); setShowDenyModal(false); }}
      >
        <View style={{ flex: 1, backgroundColor: BG_COLOR, paddingBottom: modalBottomPad }}>
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
              style={{ minHeight: 140, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 }}
            />
          </ScrollView>

          {/* Footer */}
          <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e7e5e4' }}>
            <Pressable
              onPress={handleSubmitDeny}
              disabled={isSubmitting}
              style={{
                paddingVertical: 16,
                borderRadius: 18,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: isSubmitting ? '#E7E5E4' : '#EF4444',
              }}
            >
              {isSubmitting ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <>
                  <XCircle size={18} color="white" />
                  <Text style={{ color: 'white', fontWeight: '600', fontSize: 16, marginLeft: 8 }}>Deny Claim</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Request More Info Modal */}
      <Modal
        visible={showInfoModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { Keyboard.dismiss(); setShowInfoModal(false); setInfoModalError(null); }}
      >
        <View style={{ flex: 1, backgroundColor: BG_COLOR, paddingBottom: modalBottomPad }}>
          {/* Header */}
          <SafeAreaView edges={['top']} style={{ backgroundColor: '#fff' }}>
            <View className="flex-row items-center justify-between px-5 py-4 border-b border-stone-200 bg-white">
              <Pressable onPress={() => { Keyboard.dismiss(); setShowInfoModal(false); setInfoModalError(null); }}>
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
                This will ask the claimant to provide additional information before their ownership claim can be reviewed.
              </Text>
            </View>

            <Text className="text-stone-700 font-semibold mb-3">What information do you need?</Text>
            <TextInput
              className="bg-white border border-stone-200 rounded-2xl p-4 text-stone-800"
              placeholder="Example: Please upload a photo of the farmstand sign, product display, business card, or other proof that you own or manage this farmstand."
              placeholderTextColor="#9CA3AF"
              value={modalText}
              onChangeText={(t) => { setModalText(t); if (infoModalError) setInfoModalError(null); }}
              multiline
              textAlignVertical="top"
              blurOnSubmit={false}
              style={{ minHeight: 140, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 }}
            />
          </ScrollView>

          {/* Inline error banner */}
          {infoModalError ? (
            <View style={{ marginHorizontal: 20, marginBottom: 8, backgroundColor: '#FEF2F2', borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center' }}>
              <AlertCircle size={16} color="#DC2626" />
              <Text style={{ color: '#991B1B', fontSize: 13, marginLeft: 8, flex: 1, lineHeight: 18 }}>{infoModalError}</Text>
            </View>
          ) : null}

          {/* Footer */}
          <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e7e5e4' }}>
            {(() => {
              const isValid = modalText.trim().length > 0;
              console.log('[RequestInfo] trimmed=', modalText.trim().length, 'isValid=', isValid, 'isSubmitting=', isSubmitting);
              return (
                <Pressable
                  onPress={() => { console.log('[RequestInfo] tapped isValid=', isValid); handleSubmitInfoRequest(); }}
                  disabled={!isValid || isSubmitting}
                  style={{
                    paddingVertical: 16,
                    borderRadius: 18,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isSubmitting ? '#E7E5E4' : isValid ? '#F59E0B' : '#E7E5E4',
                  }}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="#9CA3AF" size="small" />
                  ) : (
                    <>
                      <MessageCircle size={18} color={isValid ? '#ffffff' : '#9CA3AF'} />
                      <Text style={{ marginLeft: 8, fontWeight: '600', fontSize: 16, color: isValid ? '#ffffff' : '#9CA3AF' }}>
                        Send Request
                      </Text>
                    </>
                  )}
                </Pressable>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Full-screen image lightbox */}
      <ImageViewing
        images={lightboxImages}
        imageIndex={lightboxIndex}
        visible={lightboxVisible}
        onRequestClose={() => setLightboxVisible(false)}
        swipeToCloseEnabled
        doubleTapToZoomEnabled
        presentationStyle="overFullScreen"
        HeaderComponent={({ imageIndex }) => (
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 10,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 56,
              paddingHorizontal: 20,
              paddingBottom: 16,
            }}
          >
            <Pressable
              onPress={() => setLightboxVisible(false)}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: 'rgba(0,0,0,0.55)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              hitSlop={12}
            >
              <X size={20} color="white" />
            </Pressable>
            {lightboxImages.length > 1 && (
              <View
                style={{
                  backgroundColor: 'rgba(0,0,0,0.55)',
                  borderRadius: 14,
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                }}
              >
                <Text style={{ color: 'white', fontSize: 13, fontWeight: '600' }}>
                  {imageIndex + 1} / {lightboxImages.length}
                </Text>
              </View>
            )}
          </View>
        )}
      />

      {/* TEMPORARY: Push Debug Modal — admin only */}
      <PushDebugModal
        visible={showDebugPanel}
        debugInfo={debugInfo}
        onClose={() => setShowDebugPanel(false)}
        onRefresh={handleDebugRefresh}
        onTestPush={handleDebugTestPush}
        onCopy={handleDebugCopy}
        isRefreshing={isRefreshingDebug}
        isTestPushSending={isTestPushSending}
      />
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
