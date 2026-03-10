import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  Search,
  Filter,
  Plus,
  Edit3,
  Copy,
  Eye,
  EyeOff,
  Trash2,
  MapPin,
  X,
  Check,
  Store,
  ChevronRight,
  AlertCircle,
  Clock,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { AdminGuard } from '@/components/AdminGuard';
import { useAdminStore } from '@/lib/admin-store';
import { Farmstand, FarmstandStatus } from '@/lib/farmer-store';
import { GoldVerifiedRibbon } from '@/components/GoldVerifiedRibbon';
import { useAuthReady, safeApproveFarmstand, safeDeleteFarmstand, safeDenyFarmstandAndAlert, getValidSession, getAdminAuthDebugInfo, supabase } from '@/lib/supabase';
import { createAlert } from '@/lib/alerts-store';

// Background color constant
const BG_COLOR = '#FAF7F2';

// Status filter options
type StatusFilter = 'all' | 'pending' | 'active';
const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending Review' },
  { key: 'active', label: 'Active' },
];

interface FarmstandRowProps {
  farmstand: Farmstand;
  onEdit: () => void;
  onDuplicate: () => void;
  onToggleVisibility: () => void;
  onDelete: () => void;
  onViewOnMap: () => void;
  onApprove?: () => void;
  onDeny?: () => void;
  delay?: number;
  isProcessing?: boolean;
}

function FarmstandRow({
  farmstand,
  onEdit,
  onDuplicate,
  onToggleVisibility,
  onDelete,
  onViewOnMap,
  onApprove,
  onDeny,
  delay = 0,
  isProcessing = false,
}: FarmstandRowProps) {
  const [showMenu, setShowMenu] = useState(false);

  const isPending = farmstand.status === 'pending';

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(400)}>
      <View
        className="bg-white rounded-[20px] p-4 mb-3"
        style={{
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.06,
          shadowRadius: 12,
          elevation: 3,
          borderLeftWidth: isPending ? 4 : 0,
          borderLeftColor: isPending ? '#F59E0B' : 'transparent',
        }}
      >
        <View className="flex-row items-start justify-between">
          <View className="flex-1 mr-3">
            <View className="flex-row items-center mb-2">
              <View
                className="w-10 h-10 rounded-full items-center justify-center mr-3"
                style={{ backgroundColor: isPending ? '#FEF3C7' : '#E8F0E8' }}
              >
                <Store size={18} color={isPending ? '#D97706' : '#2D5A3D'} />
              </View>
              <View className="flex-1">
                <View className="flex-row items-center">
                  <Text className="text-base font-semibold text-stone-900" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {farmstand.name}
                  </Text>
                  {farmstand.goldVerified && <GoldVerifiedRibbon size={14} />}
                </View>
                <View className="flex-row items-center mt-0.5">
                  <MapPin size={12} color="#78716C" />
                  <Text className="text-sm text-stone-500 ml-1">
                    {farmstand.city || 'No city'}, {farmstand.state || 'OR'}
                  </Text>
                </View>
              </View>
              {/* Status Badge */}
              <View
                className="px-2.5 py-1 rounded-full"
                style={{
                  backgroundColor: isPending ? '#FEF3C7' : '#DCFCE7',
                }}
              >
                <Text
                  className="text-xs font-semibold"
                  style={{ color: isPending ? '#D97706' : '#16A34A' }}
                >
                  {isPending ? 'Pending Review' : 'Active'}
                </Text>
              </View>
            </View>

            {/* Pending Review subtext */}
            {isPending && (
              <View className="mb-2 px-2 py-1 bg-amber-50 rounded-lg flex-row items-center">
                <Clock size={12} color="#D97706" />
                <Text className="text-xs text-amber-700 ml-1">Awaiting listing approval</Text>
              </View>
            )}

            {/* Action Buttons for Pending */}
            {isPending && (
              <View className="flex-row mb-3" style={{ gap: 8 }}>
                <Pressable
                  onPress={() => {
                    if (!isProcessing) onDeny?.();
                  }}
                  disabled={isProcessing}
                  className={`flex-1 flex-row items-center justify-center py-2.5 rounded-xl border ${
                    isProcessing ? 'bg-stone-100 border-stone-200' : 'bg-red-50 border-red-200 active:bg-red-100'
                  }`}
                >
                  {isProcessing ? (
                    <ActivityIndicator size="small" color="#78716C" />
                  ) : (
                    <>
                      <X size={16} color="#EF4444" />
                      <Text className="text-sm font-semibold text-red-600 ml-1.5">Deny</Text>
                    </>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => {
                    if (!isProcessing) onApprove?.();
                  }}
                  disabled={isProcessing}
                  className={`flex-1 flex-row items-center justify-center py-2.5 rounded-xl ${
                    isProcessing ? 'bg-stone-400' : 'bg-green-600 active:bg-green-700'
                  }`}
                >
                  {isProcessing ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <>
                      <Check size={16} color="white" />
                      <Text className="text-sm font-semibold text-white ml-1.5">Approve</Text>
                    </>
                  )}
                </Pressable>
              </View>
            )}

            <View className="flex-row items-center justify-between pt-2 border-t border-stone-100">
              <Text className="text-xs text-stone-400">
                Updated {formatDate(farmstand.updatedAt)}
              </Text>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowMenu(true);
                }}
                className="px-3 py-1.5 bg-stone-100 rounded-full active:bg-stone-200"
              >
                <Text className="text-xs font-medium text-stone-600">Actions</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* Action Menu Modal */}
        <Modal
          visible={showMenu}
          transparent
          animationType="fade"
          onRequestClose={() => setShowMenu(false)}
        >
          <Pressable
            className="flex-1 bg-black/50 justify-end"
            onPress={() => setShowMenu(false)}
          >
            <View className="bg-white rounded-t-[28px] pt-3 pb-8">
              <View className="w-12 h-1.5 bg-stone-300 rounded-full self-center mb-4" />
              <Text className="text-lg font-bold text-stone-900 px-5 mb-1">
                {farmstand.name}
              </Text>
              <Text className="text-sm text-stone-500 px-5 mb-4">
                {farmstand.city}, {farmstand.state}
              </Text>

              <Pressable
                onPress={() => {
                  setShowMenu(false);
                  onEdit();
                }}
                className="flex-row items-center px-5 py-4 active:bg-stone-50"
              >
                <View className="w-10 h-10 rounded-full bg-blue-100 items-center justify-center mr-4">
                  <Edit3 size={18} color="#3B82F6" />
                </View>
                <Text className="text-base text-stone-700 flex-1">Edit Farmstand</Text>
                <ChevronRight size={18} color="#A8A29E" />
              </Pressable>

              <Pressable
                onPress={() => {
                  setShowMenu(false);
                  onDuplicate();
                }}
                className="flex-row items-center px-5 py-4 active:bg-stone-50"
              >
                <View className="w-10 h-10 rounded-full bg-purple-100 items-center justify-center mr-4">
                  <Copy size={18} color="#8B5CF6" />
                </View>
                <Text className="text-base text-stone-700 flex-1">Duplicate</Text>
                <ChevronRight size={18} color="#A8A29E" />
              </Pressable>

              {!isPending && (
                <Pressable
                  onPress={() => {
                    setShowMenu(false);
                    onToggleVisibility();
                  }}
                  className="flex-row items-center px-5 py-4 active:bg-stone-50"
                >
                  <View className="w-10 h-10 rounded-full bg-amber-100 items-center justify-center mr-4">
                    {farmstand.status === 'hidden' ? (
                      <Eye size={18} color="#F59E0B" />
                    ) : (
                      <EyeOff size={18} color="#F59E0B" />
                    )}
                  </View>
                  <Text className="text-base text-stone-700 flex-1">
                    {farmstand.status === 'hidden' ? 'Show on Map' : 'Hide from Map'}
                  </Text>
                  <ChevronRight size={18} color="#A8A29E" />
                </Pressable>
              )}

              <Pressable
                onPress={() => {
                  setShowMenu(false);
                  onViewOnMap();
                }}
                className="flex-row items-center px-5 py-4 active:bg-stone-50"
              >
                <View className="w-10 h-10 rounded-full bg-green-100 items-center justify-center mr-4">
                  <MapPin size={18} color="#16A34A" />
                </View>
                <Text className="text-base text-stone-700 flex-1">View on Map</Text>
                <ChevronRight size={18} color="#A8A29E" />
              </Pressable>

              <Pressable
                onPress={() => {
                  setShowMenu(false);
                  onDelete();
                }}
                className="flex-row items-center px-5 py-4 active:bg-stone-50"
              >
                <View className="w-10 h-10 rounded-full bg-red-100 items-center justify-center mr-4">
                  <Trash2 size={18} color="#EF4444" />
                </View>
                <Text className="text-base text-red-500 flex-1">Delete</Text>
                <ChevronRight size={18} color="#A8A29E" />
              </Pressable>

              <Pressable
                onPress={() => setShowMenu(false)}
                className="mx-5 mt-4 py-3.5 bg-stone-100 rounded-2xl items-center"
              >
                <Text className="text-base font-medium text-stone-600">Cancel</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
      </View>
    </Animated.View>
  );
}

function ManageFarmstandsContent() {
  const router = useRouter();

  // Auth readiness check - ensures session is loaded before showing UI
  const { ready: authReady } = useAuthReady();

  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const allFarmstands = useAdminStore((s) => s.allFarmstands);
  const updateFarmstandStatus = useAdminStore((s) => s.updateFarmstandStatus);
  const duplicateFarmstand = useAdminStore((s) => s.duplicateFarmstand);
  const verifyFarmstandSubmission = useAdminStore((s) => s.verifyFarmstandSubmission);
  const isLoading = useAdminStore((s) => s.isLoading);

  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<'updated' | 'name' | 'city'>('updated');
  const [refreshing, setRefreshing] = useState(false);
  const [processingFarmstandId, setProcessingFarmstandId] = useState<string | null>(null);

  // Toast state
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Deny modal state
  const [showDenyModal, setShowDenyModal] = useState(false);
  const [selectedFarmstandId, setSelectedFarmstandId] = useState<string | null>(null);
  const [selectedFarmstandName, setSelectedFarmstandName] = useState<string>('');
  const [denyReason, setDenyReason] = useState('');

  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteFarmstandId, setDeleteFarmstandId] = useState<string | null>(null);
  const [deleteFarmstandName, setDeleteFarmstandName] = useState<string>('');

  useEffect(() => {
    loadAdminData();
  }, []);

  // Auto-refresh when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadAdminData();
    }, [loadAdminData])
  );

  // Pull-to-refresh handler
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAdminData();
    setRefreshing(false);
  }, [loadAdminData]);

  // Show toast helper
  const showToast = useCallback((text: string, type: 'success' | 'error') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 2500);
  }, []);

  const filteredFarmstands = useMemo(() => {
    // Exclude soft-deleted and denied farmstands — they must never appear in this list
    let result = [...allFarmstands].filter((f) => !f.deletedAt && f.status !== 'denied');

    // Apply status filter
    if (statusFilter === 'pending') {
      result = result.filter((f) => f.status === 'pending');
    } else if (statusFilter === 'active') {
      result = result.filter((f) => f.status === 'active');
    }
    // 'all' shows both pending and active

    // Apply search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.name.toLowerCase().includes(query) ||
          f.city?.toLowerCase().includes(query) ||
          f.zip?.includes(query)
      );
    }

    // Default sort: pending first, then by the selected sort within each group
    result.sort((a, b) => {
      // Pending comes first
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;

      // Within same status, apply selected sort
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'city':
          return (a.city || '').localeCompare(b.city || '');
        case 'updated':
        default:
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });

    return result;
  }, [allFarmstands, searchQuery, statusFilter, sortBy]);

  // Count by status for filter chips
  const pendingCount = allFarmstands.filter((f) => f.status === 'pending' && !f.deletedAt).length;
  const activeCount = allFarmstands.filter((f) => f.status === 'active' && !f.deletedAt).length;

  // ── Admin Auth Debug ──────────────────────────────────────────────────
  const handleAuthDebug = async () => {
    const info = await getAdminAuthDebugInfo();
    Alert.alert('Admin Auth Debug', info, [{ text: 'OK' }]);
  };

  const handleEdit = (farmstand: Farmstand) => {
    router.push(`/admin/farmstand-edit?id=${farmstand.id}`);
  };

  const handleDuplicate = async (farmstand: Farmstand) => {
    try {
      const newId = await duplicateFarmstand(farmstand.id);
      showToast('Farmstand duplicated as draft', 'success');
      router.push(`/admin/farmstand-edit?id=${newId}`);
    } catch {
      showToast('Failed to duplicate farmstand', 'error');
    }
  };

  const handleToggleVisibility = async (farmstand: Farmstand) => {
    const newStatus: FarmstandStatus = farmstand.status === 'hidden' ? 'active' : 'hidden';
    await updateFarmstandStatus(farmstand.id, newStatus);
    await loadAdminData(); // Refresh from Supabase
    showToast(newStatus === 'hidden' ? 'Farmstand hidden' : 'Farmstand visible', 'success');
  };

  const handleOpenDeleteModal = (farmstand: Farmstand) => {
    setDeleteFarmstandId(farmstand.id);
    setDeleteFarmstandName(farmstand.name);
    setShowDeleteModal(true);
  };

  const handleDelete = async () => {
    if (!deleteFarmstandId) return;

    const idToDelete = deleteFarmstandId;
    setProcessingFarmstandId(idToDelete);
    // Close modal immediately so UI feels responsive
    setShowDeleteModal(false);
    setDeleteFarmstandId(null);
    setDeleteFarmstandName('');

    try {
      // Hard delete directly from Supabase - no RPC, just DELETE row
      await safeDeleteFarmstand(idToDelete);

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast('Farmstand deleted', 'success');

      // Refetch from DB so local state matches reality
      await loadAdminData();
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg = error instanceof Error ? error.message : 'Failed to delete farmstand';
      if (msg === 'AUTH_REQUIRED') {
        Alert.alert('Sign In Required', 'Please sign in to delete farmstands.');
      } else {
        showToast(msg, 'error');
      }
      // Re-fetch to restore correct state since delete failed
      await loadAdminData();
    } finally {
      setProcessingFarmstandId(null);
    }
  };

  const handleViewOnMap = (farmstand: Farmstand) => {
    if (farmstand.latitude && farmstand.longitude) {
      router.push(`/(tabs)/map?lat=${farmstand.latitude}&lng=${farmstand.longitude}`);
    } else {
      showToast('This farmstand has no location set', 'error');
    }
  };

  // Approve handler - uses safe function with session refresh
  const handleApprove = async (farmstand: Farmstand) => {
    if (processingFarmstandId === farmstand.id) return;

    // DIAGNOSTIC: log full session state before attempting approve
    const nowSeconds = Math.floor(Date.now() / 1000);
    const debugSession = await getValidSession();
    console.log('[handleApprove] session exists:', !!debugSession,
      '| expires_at:', debugSession?.expires_at ?? 'n/a',
      '| now:', nowSeconds,
      '| seconds_until_expiry:', debugSession?.expires_at ? debugSession.expires_at - nowSeconds : 'n/a',
      '| token_prefix:', debugSession?.access_token ? debugSession.access_token.slice(0, 12) + '…' : 'none',
      '| refresh_token_exists:', !!debugSession?.refresh_token);

    if (!debugSession) {
      const debugInfo = await getAdminAuthDebugInfo();
      Alert.alert(
        'Session Missing — Cannot Approve',
        `getValidSession() returned null.\n\n${debugInfo}\n\nPlease sign in again.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign In', onPress: () => router.push('/auth/login') },
        ]
      );
      return;
    }

    setProcessingFarmstandId(farmstand.id);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      console.log('[handleApprove] Calling safeApproveFarmstand for:', farmstand.id);
      await safeApproveFarmstand(farmstand.id);

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast('Listing approved!', 'success');

      // Immediately re-fetch from Supabase
      await loadAdminData();
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const errorMessage = error instanceof Error ? error.message : 'An error occurred';
      console.log('[handleApprove] Error:', errorMessage);

      if (errorMessage === 'AUTH_REQUIRED') {
        Alert.alert(
          'Sign In Required',
          'Session expired. Please sign in again to approve farmstands.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign In', onPress: () => router.push('/auth/login') },
          ]
        );
      } else {
        showToast(errorMessage, 'error');
      }
    } finally {
      setProcessingFarmstandId(null);
    }
  };

  // Open deny modal
  const handleOpenDenyModal = (farmstand: Farmstand) => {
    if (processingFarmstandId === farmstand.id) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedFarmstandId(farmstand.id);
    setSelectedFarmstandName(farmstand.name);
    setDenyReason('');
    setShowDenyModal(true);
  };

  const handleDeny = async () => {
    if (!selectedFarmstandId) return;

    const farmstandId = selectedFarmstandId;
    const reasonToDeny = denyReason.trim() || null;

    // Guard: ensure a valid session exists before proceeding (same pattern as handleApprove)
    const debugSession = await getValidSession();
    if (!debugSession) {
      const debugInfo = await getAdminAuthDebugInfo();
      Alert.alert(
        'Session Missing — Cannot Deny',
        `getValidSession() returned null.\n\n${debugInfo}\n\nPlease sign in again.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign In', onPress: () => router.push('/auth/login') },
        ]
      );
      return;
    }

    // Capture snapshot for rollback
    const snapshot = useAdminStore.getState().allFarmstands;

    // Close modal and optimistically remove from store
    setShowDenyModal(false);
    setSelectedFarmstandId(null);
    setSelectedFarmstandName('');
    setDenyReason('');
    useAdminStore.setState({
      allFarmstands: snapshot.filter((f) => f.id !== farmstandId),
    });
    setProcessingFarmstandId(farmstandId);

    try {
      // Use safe helper: verifies session freshness + calls admin_deny_farmstand_and_alert RPC
      console.log('[handleDeny] Calling safeDenyFarmstandAndAlert:', { farmstandId, reasonToDeny });
      await safeDenyFarmstandAndAlert(farmstandId, reasonToDeny);
      console.log('[handleDeny] safeDenyFarmstandAndAlert succeeded');

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      showToast('Listing denied', 'success');
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const errorMessage = error instanceof Error ? error.message : 'An error occurred';
      console.log('[handleDeny] Error:', JSON.stringify(error, null, 2));

      // Rollback optimistic remove
      useAdminStore.setState({ allFarmstands: snapshot });

      if (errorMessage === 'AUTH_REQUIRED') {
        Alert.alert(
          'Sign In Required',
          'Session expired. Please sign in again to deny farmstands.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign In', onPress: () => router.push('/auth/login') },
          ]
        );
      } else {
        showToast(errorMessage, 'error');
      }
    } finally {
      setProcessingFarmstandId(null);
    }
  };

  // Don't render anything until auth has loaded
  if (!authReady) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: BG_COLOR }}>
        <ActivityIndicator size="large" color="#16A34A" />
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
            shadowOpacity: 0.15,
            shadowRadius: 12,
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

      {/* Header */}
      <Animated.View entering={FadeIn.duration(500)}>
        <LinearGradient
          colors={['#16A34A', '#22C55E', '#4ADE80']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            paddingTop: 0,
            paddingBottom: 24,
            borderBottomLeftRadius: 32,
            borderBottomRightRadius: 32,
          }}
        >
          <SafeAreaView edges={['top']}>
            <View className="px-5 pt-4">
              {/* Top Row */}
              <View className="flex-row items-center justify-between mb-4">
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.back();
                  }}
                  className="w-10 h-10 bg-white/20 rounded-full items-center justify-center"
                >
                  <ArrowLeft size={22} color="white" />
                </Pressable>
                <Text className="text-lg font-bold text-white">Manage Listings</Text>
                <View className="flex-row items-center gap-2">
                  {/* DEBUG: Tap to inspect auth state in TestFlight */}
                  {__DEV__ && (
                  <Pressable
                    onPress={handleAuthDebug}
                    className="w-10 h-10 bg-yellow-400/80 rounded-full items-center justify-center"
                  >
                    <AlertCircle size={20} color="#78350f" />
                  </Pressable>
                  )}
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.push('/admin/farmstand-edit');
                    }}
                    className="w-10 h-10 bg-white rounded-full items-center justify-center"
                  >
                    <Plus size={22} color="#16A34A" />
                  </Pressable>
                </View>
              </View>

              {/* Search Bar */}
              <View
                className="flex-row items-center bg-white rounded-2xl px-4 py-3"
                style={{
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.1,
                  shadowRadius: 8,
                  elevation: 4,
                }}
              >
                <Search size={20} color="#78716C" />
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search by name, city, or zip..."
                  placeholderTextColor="#A8A29E"
                  className="flex-1 ml-3 text-base text-stone-900"
                />
                {searchQuery.length > 0 && (
                  <Pressable onPress={() => setSearchQuery('')}>
                    <X size={18} color="#A8A29E" />
                  </Pressable>
                )}
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
      </Animated.View>

      {/* Status Filter Chips */}
      <View className="px-5 py-4">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
          {STATUS_FILTERS.map((filter) => {
            const count = filter.key === 'all'
              ? pendingCount + activeCount
              : filter.key === 'pending'
              ? pendingCount
              : activeCount;

            return (
              <Pressable
                key={filter.key}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setStatusFilter(filter.key);
                }}
                className={`flex-row items-center px-4 py-2 rounded-full mr-2 ${
                  statusFilter === filter.key ? 'bg-green-600' : 'bg-white'
                }`}
                style={{
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.04,
                  shadowRadius: 4,
                  elevation: 2,
                }}
              >
                <Text
                  className={`text-sm font-medium ${
                    statusFilter === filter.key ? 'text-white' : 'text-stone-600'
                  }`}
                >
                  {filter.label}
                </Text>
                <View
                  className={`ml-2 px-2 py-0.5 rounded-full ${
                    statusFilter === filter.key ? 'bg-white/30' : 'bg-stone-100'
                  }`}
                >
                  <Text
                    className={`text-xs font-semibold ${
                      statusFilter === filter.key ? 'text-white' : 'text-stone-500'
                    }`}
                  >
                    {count}
                  </Text>
                </View>
              </Pressable>
            );
          })}

          {/* Filter Toggle */}
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowFilters(!showFilters);
            }}
            className={`flex-row items-center px-4 py-2 rounded-full ${
              showFilters ? 'bg-green-100' : 'bg-white'
            }`}
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.04,
              shadowRadius: 4,
              elevation: 2,
            }}
          >
            <Filter size={16} color={showFilters ? '#16A34A' : '#78716C'} />
            <Text
              className={`text-sm font-medium ml-2 ${
                showFilters ? 'text-green-700' : 'text-stone-600'
              }`}
            >
              Sort
            </Text>
          </Pressable>
        </ScrollView>
      </View>

      {/* Sort Options Panel */}
      {showFilters && (
        <Animated.View
          entering={FadeInDown.duration(300)}
          className="bg-white mx-5 mb-4 rounded-2xl p-4"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.06,
            shadowRadius: 12,
            elevation: 3,
          }}
        >
          <Text className="text-xs font-semibold text-stone-400 uppercase mb-3">Sort By</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
            {[
              { key: 'updated', label: 'Recently Updated' },
              { key: 'name', label: 'Name' },
              { key: 'city', label: 'City' },
            ].map((option) => (
              <Pressable
                key={option.key}
                onPress={() => setSortBy(option.key as typeof sortBy)}
                className={`px-4 py-2 rounded-full mr-2 ${
                  sortBy === option.key ? 'bg-green-600' : 'bg-stone-100'
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    sortBy === option.key ? 'text-white' : 'text-stone-600'
                  }`}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </Animated.View>
      )}

      {/* Farmstand List */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#16A34A"
            colors={['#16A34A']}
          />
        }
      >
        {isLoading && filteredFarmstands.length === 0 ? (
          <View className="py-20 items-center">
            <ActivityIndicator size="large" color="#16A34A" />
          </View>
        ) : filteredFarmstands.length === 0 ? (
          <Animated.View
            entering={FadeInDown.delay(100).duration(400)}
            className="bg-white rounded-[20px] p-8 items-center"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 3 },
              shadowOpacity: 0.06,
              shadowRadius: 12,
              elevation: 3,
            }}
          >
            <View className="w-16 h-16 rounded-full bg-stone-100 items-center justify-center mb-4">
              <Store size={28} color="#A8A29E" />
            </View>
            <Text className="text-stone-500 text-base">No farmstands found</Text>
          </Animated.View>
        ) : (
          filteredFarmstands.map((farmstand, index) => (
            <FarmstandRow
              key={farmstand.id}
              farmstand={farmstand}
              onEdit={() => handleEdit(farmstand)}
              onDuplicate={() => handleDuplicate(farmstand)}
              onToggleVisibility={() => handleToggleVisibility(farmstand)}
              onDelete={() => handleOpenDeleteModal(farmstand)}
              onViewOnMap={() => handleViewOnMap(farmstand)}
              onApprove={() => handleApprove(farmstand)}
              onDeny={() => handleOpenDenyModal(farmstand)}
              delay={100 + index * 30}
              isProcessing={processingFarmstandId === farmstand.id}
            />
          ))
        )}
      </ScrollView>

      {/* Deny Modal */}
      <Modal
        visible={showDenyModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDenyModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()} accessible={false}>
            <View className="flex-1 bg-black/50 justify-center items-center px-6">
              <Pressable onPress={() => {}} style={{ width: '100%' }}>
                <View
                  className="bg-white rounded-[24px] w-full overflow-hidden"
                  style={{
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 10 },
                    shadowOpacity: 0.15,
                    shadowRadius: 20,
                    elevation: 10,
                  }}
                >
                  <View className="p-5 border-b border-stone-100">
                    <View className="flex-row items-center">
                      <View className="w-11 h-11 rounded-full bg-red-100 items-center justify-center mr-4">
                        <AlertCircle size={22} color="#EF4444" />
                      </View>
                      <View className="flex-1">
                        <Text className="text-lg font-bold text-stone-900">Deny Listing</Text>
                        <Text className="text-sm text-stone-500" numberOfLines={1}>{selectedFarmstandName}</Text>
                      </View>
                    </View>
                  </View>

                  <View className="p-5">
                    <Text className="text-sm font-medium text-stone-700 mb-3">
                      Reason for denial (optional)
                    </Text>
                    <TextInput
                      value={denyReason}
                      onChangeText={setDenyReason}
                      placeholder="Enter reason..."
                      placeholderTextColor="#A8A29E"
                      multiline
                      numberOfLines={3}
                      blurOnSubmit={false}
                      returnKeyType="done"
                      onSubmitEditing={() => Keyboard.dismiss()}
                      className="bg-stone-50 rounded-2xl px-4 py-3 text-base text-stone-900"
                      style={{ textAlignVertical: 'top', minHeight: 100 }}
                    />
                  </View>

                  <View className="flex-row p-5 pt-0" style={{ gap: 12 }}>
                    <Pressable
                      onPress={() => setShowDenyModal(false)}
                      className="flex-1 py-3.5 bg-stone-100 rounded-2xl items-center"
                    >
                      <Text className="text-base font-medium text-stone-600">Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleDeny}
                      disabled={processingFarmstandId !== null}
                      className="flex-1 py-3.5 bg-red-600 rounded-2xl items-center"
                    >
                      {processingFarmstandId !== null ? (
                        <ActivityIndicator size="small" color="white" />
                      ) : (
                        <Text className="text-base font-medium text-white">Deny</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              </Pressable>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <Pressable
          className="flex-1 bg-black/50 justify-center items-center px-6"
          onPress={() => setShowDeleteModal(false)}
        >
          <View
            className="bg-white rounded-[24px] w-full overflow-hidden"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.15,
              shadowRadius: 20,
              elevation: 10,
            }}
          >
            <View className="p-5 border-b border-stone-100">
              <View className="flex-row items-center">
                <View className="w-11 h-11 rounded-full bg-red-100 items-center justify-center mr-4">
                  <Trash2 size={22} color="#EF4444" />
                </View>
                <View className="flex-1">
                  <Text className="text-lg font-bold text-stone-900">Delete Farmstand</Text>
                  <Text className="text-sm text-stone-500" numberOfLines={1}>{deleteFarmstandName}</Text>
                </View>
              </View>
            </View>

            <View className="p-5">
              <Text className="text-base text-stone-600">
                Are you sure you want to delete this farmstand? This action will soft-delete the farmstand and it will no longer appear in any lists.
              </Text>
            </View>

            <View className="flex-row p-5 pt-0" style={{ gap: 12 }}>
              <Pressable
                onPress={() => setShowDeleteModal(false)}
                className="flex-1 py-3.5 bg-stone-100 rounded-2xl items-center"
              >
                <Text className="text-base font-medium text-stone-600">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleDelete}
                disabled={processingFarmstandId !== null}
                className="flex-1 py-3.5 bg-red-600 rounded-2xl items-center"
              >
                {processingFarmstandId !== null ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text className="text-base font-medium text-white">Delete</Text>
                )}
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

export default function ManageFarmstands() {
  return (
    <AdminGuard>
      <ManageFarmstandsContent />
    </AdminGuard>
  );
}
