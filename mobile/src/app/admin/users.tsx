import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Modal,
  Alert,
  TextInput,
  Linking,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  User,
  Store,
  UserCog,
  Ban,
  CheckCircle,
  Trash2,
  X,
  Users as UsersIcon,
  ChevronRight,
  Search,
  Mail,
  Bell,
  Check,
  AlertCircle,
  RefreshCw,
  Crown,
  ShieldOff,
  AlertTriangle,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { AdminGuard } from '@/components/AdminGuard';
import { getValidSession } from '@/lib/supabase';
import { useAdminStore, BackendUser } from '@/lib/admin-store';

// ── Types ────────────────────────────────────────────────────────────────────

// Re-export so other screens can import if needed
export type AdminUser = BackendUser;

// Visible filter categories — Admin is intentionally excluded
type RoleFilter = 'all' | 'farmer' | 'premium' | 'consumer';

// ── Constants ────────────────────────────────────────────────────────────────

const BG_COLOR = '#FAF7F2';
const BACKEND_URL = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';

// ── Category helpers (deterministic per requirements) ────────────────────────
// farmer  = owns / has claimed a farmstand  (role === 'farmer' OR farmstand_count > 0)
// premium = derived from farmstands where premium_status='active' OR trial hasn't expired
// consumer= not a farmer AND not premium
// A user can be BOTH farmer and premium — both badges are shown.

function isFarmer(u: BackendUser): boolean {
  return u.role === 'farmer' || (u.farmstand_count ?? 0) > 0;
}

function isPremium(u: BackendUser): boolean {
  return u.is_premium === true;
}

function isConsumer(u: BackendUser): boolean {
  return !isFarmer(u) && !isPremium(u);
}

function getRoleStyle(u: BackendUser) {
  if (isFarmer(u)) return { bg: '#DCFCE7', text: '#16A34A', icon: Store, iconColor: '#16A34A' };
  if (isPremium(u)) return { bg: '#FEF3C7', text: '#D97706', icon: Crown, iconColor: '#D97706' };
  return { bg: '#F3F4F6', text: '#6B7280', icon: User, iconColor: '#6B7280' };
}

function getRoleLabel(u: BackendUser): string {
  if (isFarmer(u)) return 'Farmer';
  if (isPremium(u)) return 'Premium';
  return 'Consumer';
}

function getStatusStyle(status: string) {
  return status === 'suspended'
    ? { bg: '#FEE2E2', text: '#DC2626' }
    : { bg: '#D1FAE5', text: '#059669' };
}

function formatJoinDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  } catch {
    return isoDate;
  }
}

// ── Main Screen ───────────────────────────────────────────────────────────────

function UsersContent() {
  const router = useRouter();

  // ── Shared store (single source of truth for both Dashboard + this screen) ──
  const managedUsers        = useAdminStore(s => s.managedUsers);
  const allFarmstands       = useAdminStore(s => s.allFarmstands);
  const loadManagedUsers    = useAdminStore(s => s.loadManagedUsers);
  const patchManagedUserRole   = useAdminStore(s => s.patchManagedUserRole);
  const patchManagedUserStatus = useAdminStore(s => s.patchManagedUserStatus);
  const removeManagedUser      = useAdminStore(s => s.removeManagedUser);
  const deleteManagedUser      = useAdminStore(s => s.deleteManagedUser);
  const purgeFarmstandAfterAdminRemove = useAdminStore(s => s.purgeFarmstandAfterAdminRemove);

  // Local UI state
  const [loading, setLoading]     = useState(managedUsers.length === 0);
  const [error, setError]         = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Filter / search
  const [search, setSearch]           = useState('');
  const [roleFilter, setRoleFilter]   = useState<RoleFilter>('all');

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Action menu
  const [selectedUser, setSelectedUser]   = useState<BackendUser | null>(null);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [showRoleMenu, setShowRoleMenu]     = useState(false);
  const [isDeleting, setIsDeleting]         = useState(false);

  // Alert broadcast modal
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [alertTitle, setAlertTitle]         = useState('');
  const [alertMessage, setAlertMessage]     = useState('');
  const [alertRoute, setAlertRoute]         = useState('');
  const [isSending, setIsSending]           = useState(false);
  const [sendResult, setSendResult]         = useState<{ success: boolean; message: string } | null>(null);

  // Remove ownership modal
  const [showRemoveOwnershipModal, setShowRemoveOwnershipModal] = useState(false);
  const [removeOwnershipTarget, setRemoveOwnershipTarget] = useState<{
    farmstandId: string;
    farmstandName: string;
    userId: string;
    userName: string;
  } | null>(null);
  const [isRemovingOwnership, setIsRemovingOwnership] = useState(false);

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchUsers = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    const result = await loadManagedUsers();

    if (result.error) setError(result.error);
    setLoading(false);
    setRefreshing(false);
  }, [loadManagedUsers]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // ── Enrich managedUsers with premium status ───────────────────────────────
  // Premium is determined by combining two sources:
  //   1. u.is_premium — returned by the backend, which now ONLY counts active
  //      (non-deleted) farmstands where the user is still the current owner.
  //   2. computedIsPremium — derived from allFarmstands (non-deleted, active
  //      farmstands in the store) as a real-time cross-check.
  // Both sources are kept in sync: remove-ownership and deletion both clear
  // premium fields immediately in the store and trigger a backend reload.
  const enrichedUsers = useMemo((): BackendUser[] => {
    const nowStr = new Date().toISOString();
    const DEBUG_EMAILS = new Set(['joekociemba@gmail.com', 'jcunningh0430@gmail.com']);

    return managedUsers.map(u => {
      const userFarmstands = allFarmstands.filter(
        f => !f.deletedAt && (f.ownerUserId === u.id || f.claimedByUserId === u.id)
      );
      const computedIsPremium = userFarmstands.some(
        f =>
          f.premiumStatus === 'active' ||
          f.premiumStatus === 'trial' ||
          (f.premiumTrialExpiresAt != null && f.premiumTrialExpiresAt > nowStr)
      );

      // Both sources agree: user is premium only if backend AND local store confirm it.
      // Using || so a freshly approved claim (not yet in managedUsers) is still shown.
      const finalIsPremium = u.is_premium || computedIsPremium;

      if (DEBUG_EMAILS.has(u.email ?? '')) {
        const fsInfo = userFarmstands.map(f => `${f.name}:${f.premiumStatus}`).join(', ') || 'none in allFarmstands';
        const failReason = !finalIsPremium
          ? `FAILED — backend=${u.is_premium} allFarmstandStatuses=[${userFarmstands.map(f => f.premiumStatus).join(',')}]`
          : 'PASS';
        console.log(
          `[PremiumDebug:${u.email}] final=${finalIsPremium} | backend=${u.is_premium} | ` +
          `computed=${computedIsPremium} | farmstands=[${fsInfo}] | ${failReason}`
        );
      } else {
        console.log(`[PremiumDebug] ${u.email} | final=${finalIsPremium} backend=${u.is_premium} computed=${computedIsPremium}`);
      }

      return { ...u, is_premium: finalIsPremium };
    });
  }, [managedUsers, allFarmstands]);

  // ── Filtered list ─────────────────────────────────────────────────────────
  // All derivations come from enrichedUsers (admin-free + premium re-computed).

  const filteredUsers = enrichedUsers.filter(u => {
    // Category filter
    const matchesRole =
      roleFilter === 'all'      ? true
      : roleFilter === 'farmer'   ? isFarmer(u)
      : roleFilter === 'premium'  ? isPremium(u)
      :                             isConsumer(u); // 'consumer'

    // Search filter
    const q = search.toLowerCase().trim();
    const matchesSearch =
      !q ||
      (u.full_name ?? '').toLowerCase().includes(q) ||
      (u.email ?? '').toLowerCase().includes(q);

    return matchesRole && matchesSearch;
  });

  // ── Stats (computed from the full non-filtered enrichedUsers) ─────────────

  const farmerCount   = enrichedUsers.filter(isFarmer).length;
  const premiumCount  = enrichedUsers.filter(isPremium).length;
  const consumerCount = enrichedUsers.filter(isConsumer).length;

  // ── Selection helpers ─────────────────────────────────────────────────────

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(filteredUsers.map(u => u.id)));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const clearSelection = () => setSelectedIds(new Set());

  const selectedUsers = filteredUsers.filter(u => selectedIds.has(u.id));

  // ── Email action ──────────────────────────────────────────────────────────

  const handleEmail = async () => {
    const validEmails = selectedUsers.map(u => u.email).filter(Boolean);
    if (validEmails.length === 0) {
      Alert.alert('No Valid Emails', 'None of the selected users have email addresses.');
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const mailtoUrl =
      validEmails.length === 1
        ? `mailto:${validEmails[0]}`
        : `mailto:?bcc=${validEmails.join(',')}`;

    const supported = await Linking.canOpenURL(mailtoUrl);
    if (!supported) {
      Alert.alert('Mail Not Available', 'Copy the addresses manually:\n\n' + validEmails.join('\n'));
      return;
    }
    await Linking.openURL(mailtoUrl);
  };

  // ── Alert broadcast ───────────────────────────────────────────────────────

  const handleOpenAlertModal = () => {
    setAlertTitle('');
    setAlertMessage('');
    setAlertRoute('');
    setSendResult(null);
    setShowAlertModal(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleSendAlert = async () => {
    if (!alertTitle.trim() || !alertMessage.trim()) {
      Alert.alert('Missing Fields', 'Please enter both a title and a message.');
      return;
    }
    const targetIds = selectedUsers.map(u => u.id);
    if (targetIds.length === 0) {
      Alert.alert('No Users Selected', 'Select at least one user to send an alert.');
      return;
    }
    setIsSending(true);
    setSendResult(null);
    try {
      const session = await getValidSession();
      if (!session) {
        setSendResult({ success: false, message: 'Session expired. Please sign in again.' });
        return;
      }
      const payload: Record<string, unknown> = {
        user_ids: targetIds,
        type: 'platform_announcement',
        title: alertTitle.trim(),
        message: alertMessage.trim(),
      };
      if (alertRoute.trim()) payload.deep_link = alertRoute.trim();

      const resp = await fetch(`${BACKEND_URL}/api/admin/broadcast-alert`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const uct1 = resp.headers.get('content-type') ?? '';
      if (!uct1.includes('application/json')) {
        console.log('[AdminUsers] broadcast-alert non-JSON response (HTTP', resp.status, '), content-type:', uct1);
        setSendResult({ success: false, message: `Unexpected response from server (HTTP ${resp.status})` });
        return;
      }
      const data = (await resp.json()) as { success: boolean; sent_count?: number; error?: string };
      if (data.success) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const n = data.sent_count ?? targetIds.length;
        setSendResult({ success: true, message: `Alert sent to ${n} user${n !== 1 ? 's' : ''}. Push notifications delivered where available.` });
      } else {
        setSendResult({ success: false, message: data.error ?? 'Failed to send alert.' });
      }
    } catch (err) {
      console.error('[AdminUsers] Broadcast error:', err);
      setSendResult({ success: false, message: 'Network error. Please try again.' });
    } finally {
      setIsSending(false);
    }
  };

  // ── User management actions ───────────────────────────────────────────────

  const handleOpenMenu = async (user: BackendUser) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedUser(user);
    setShowActionMenu(true);
  };

  const handleChangeRole = async (role: 'admin' | 'farmer' | 'consumer') => {
    if (!selectedUser) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const session = await getValidSession();
      if (!session) return;
      const resp = await fetch(`${BACKEND_URL}/api/admin/users/${selectedUser.id}/role`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role }),
      });
      if (resp.ok) patchManagedUserRole(selectedUser.id, role);
    } catch (err) {
      console.error('[AdminUsers] Role update error:', err);
    }
    setShowRoleMenu(false);
    setShowActionMenu(false);
    setSelectedUser(null);
  };

  const handleToggleStatus = async () => {
    if (!selectedUser) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const newStatus: 'active' | 'suspended' =
      selectedUser.status === 'active' ? 'suspended' : 'active';
    try {
      const session = await getValidSession();
      if (!session) return;
      const resp = await fetch(`${BACKEND_URL}/api/admin/users/${selectedUser.id}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus }),
      });
      if (resp.ok) patchManagedUserStatus(selectedUser.id, newStatus);
    } catch (err) {
      console.error('[AdminUsers] Status update error:', err);
    }
    setShowActionMenu(false);
    setSelectedUser(null);
  };

  // userToDelete is passed directly — never relies on selectedUser state to avoid wrong-ID bugs
  const handleDeleteUser = (userToDelete: BackendUser) => {
    if (__DEV__) console.log('[AdminUsers] delete button pressed — auth user id:', userToDelete.id, '| email:', userToDelete.email);
    setShowActionMenu(false);
    Alert.alert(
      'Delete User',
      `Permanently delete "${userToDelete.full_name}"?\n\nThis removes all their data and cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (isDeleting) return;
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setIsDeleting(true);
            if (__DEV__) console.log('[AdminUsers] confirmed delete — sending auth user id:', userToDelete.id);
            const result = await deleteManagedUser(userToDelete.id);
            setIsDeleting(false);
            console.log('[DELETE RESPONSE]', result);
            if (result.success) {
              console.log('[DELETE SUCCESS]', userToDelete.id);
              setSelectedIds(prev => { const n = new Set(prev); n.delete(userToDelete.id); return n; });
              setSelectedUser(null);
              setShowActionMenu(false);
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } else {
              Alert.alert('Delete Failed', result?.error || JSON.stringify(result) || 'Unknown error');
            }
          },
        },
      ]
    );
  };

  // ── Remove Ownership ──────────────────────────────────────────────────────

  const handleOpenRemoveOwnership = (farmstandId: string, farmstandName: string, userId: string, userName: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRemoveOwnershipTarget({ farmstandId, farmstandName, userId, userName });
    setShowRemoveOwnershipModal(true);
  };

  const handleConfirmRemoveOwnership = async () => {
    if (!removeOwnershipTarget) return;
    const { farmstandId, farmstandName, userId } = removeOwnershipTarget;
    console.log('[ManageUsersRemoveFarmstand] starting remove for farmstandId:', farmstandId, '/ userId:', userId);
    setIsRemovingOwnership(true);
    try {
      const session = await getValidSession();
      if (!session) {
        Alert.alert('Error', 'Session expired. Please sign in again.');
        return;
      }
      const resp = await fetch(`${BACKEND_URL}/api/admin/remove-ownership`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          farmstand_id: farmstandId,
          user_id: userId,
          farmstand_name: farmstandName,
        }),
      });
      const uct2 = resp.headers.get('content-type') ?? '';
      if (!uct2.includes('application/json')) {
        console.log('[AdminUsers] remove-ownership non-JSON response (HTTP', resp.status, '), content-type:', uct2);
        Alert.alert('Error', `Unexpected response from server (HTTP ${resp.status})`);
        return;
      }
      const data = (await resp.json()) as { success: boolean; error?: string };
      if (data.success) {
        // Fully purge the farmstand from all local stores (allFarmstands, managedUsers, bootstrap/profile)
        await purgeFarmstandAfterAdminRemove(farmstandId);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setShowRemoveOwnershipModal(false);
        setRemoveOwnershipTarget(null);
      } else {
        console.log('[ManageUsersRemoveFarmstand] failed:', data.error);
        Alert.alert('Error', data.error ?? 'Failed to remove farmstand. Please try again.');
      }
    } catch (err) {
      console.log('[ManageUsersRemoveFarmstand] failed:', err);
      Alert.alert('Error', 'Network error. Please try again.');
    } finally {
      setIsRemovingOwnership(false);
    }
  };

  // ── Filter pill renderer ──────────────────────────────────────────────────

  const renderFilterPill = (label: string, value: RoleFilter) => {
    const active = roleFilter === value;
    return (
      <Pressable
        key={value}
        onPress={() => { setRoleFilter(value); Haptics.selectionAsync(); }}
        className="px-4 py-2 rounded-full mr-2"
        style={{ backgroundColor: active ? '#2D5A3D' : '#F0EAE0' }}
      >
        <Text className="text-sm font-semibold" style={{ color: active ? '#FFFFFF' : '#78716C' }}>
          {label}
        </Text>
      </Pressable>
    );
  };

  // ── Loading / Error states ────────────────────────────────────────────────

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: BG_COLOR }}>
        <ActivityIndicator size="large" color="#2D5A3D" />
        <Text className="mt-3 text-stone-500 text-sm">Loading users...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: BG_COLOR }}>
        <View className="w-14 h-14 rounded-full bg-red-100 items-center justify-center mb-4">
          <AlertCircle size={28} color="#DC2626" />
        </View>
        <Text className="text-stone-900 font-bold text-lg text-center mb-2">Could Not Load Users</Text>
        <Text className="text-stone-500 text-sm text-center mb-6">{error}</Text>
        <Pressable
          onPress={() => fetchUsers()}
          className="flex-row items-center bg-stone-900 px-5 py-3 rounded-full"
        >
          <RefreshCw size={16} color="white" />
          <Text className="ml-2 text-white font-semibold">Try Again</Text>
        </Pressable>
      </View>
    );
  }

  // ── Full render ───────────────────────────────────────────────────────────

  return (
    <View className="flex-1" style={{ backgroundColor: BG_COLOR }}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: selectedIds.size > 0 ? 120 : 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero Header */}
        <Animated.View entering={FadeIn.duration(500)}>
          <LinearGradient
            colors={['#3B82F6', '#60A5FA', '#93C5FD']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ paddingBottom: 60, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 }}
          >
            <SafeAreaView edges={['top']}>
              <View className="px-5 pt-4">
                <Pressable
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
                  className="w-10 h-10 bg-white/20 rounded-full items-center justify-center mb-4"
                >
                  <ArrowLeft size={22} color="white" />
                </Pressable>
                <View className="items-center pb-4">
                  <View
                    className="w-16 h-16 rounded-full items-center justify-center mb-3"
                    style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
                  >
                    <UsersIcon size={32} color="white" />
                  </View>
                  <Text className="text-white text-2xl font-bold">Manage Users</Text>
                  {/* Total accounts — excludes admins, matches the data set exactly */}
                  <Text className="text-blue-200 text-sm mt-1">
                    {managedUsers.length} total account{managedUsers.length !== 1 ? 's' : ''}
                  </Text>
                </View>
              </View>
            </SafeAreaView>
          </LinearGradient>
        </Animated.View>

        {/* Stat Cards — Farmers · Premium · Users (no Admin card) */}
        <View className="px-5 -mt-10">
          <Animated.View
            entering={FadeInDown.delay(100).duration(400)}
            className="flex-row"
            style={{ gap: 10 }}
          >
            {[
              { label: 'Farmers',  count: farmerCount,   color: '#16A34A' },
              { label: 'Premium',  count: premiumCount,  color: '#D97706' },
              { label: 'Users',    count: consumerCount, color: '#57534E' },
            ].map(({ label, count, color }) => (
              <View
                key={label}
                className="flex-1 bg-white rounded-2xl p-4 items-center"
                style={{
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.08,
                  shadowRadius: 16,
                  elevation: 5,
                }}
              >
                <Text className="text-2xl font-bold" style={{ color }}>{count}</Text>
                <Text className="text-xs text-stone-500 mt-1">{label}</Text>
              </View>
            ))}
          </Animated.View>
        </View>

        {/* Search + Filters */}
        <Animated.View entering={FadeInDown.delay(180).duration(400)} className="px-5 pt-5">
          {/* Search */}
          <View
            className="flex-row items-center bg-white rounded-2xl px-4 py-3 mb-3"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.06,
              shadowRadius: 8,
              elevation: 3,
            }}
          >
            <Search size={18} color="#A8A29E" />
            <TextInput
              className="flex-1 ml-3 text-stone-900 text-sm"
              placeholder="Search by name or email..."
              placeholderTextColor="#A8A29E"
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')}>
                <X size={16} color="#A8A29E" />
              </Pressable>
            )}
          </View>

          {/* Filter chips: All · Farmers · Premium · Consumers */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            className="mb-3"
          >
            {renderFilterPill('All', 'all')}
            {renderFilterPill('Farmers', 'farmer')}
            {renderFilterPill('Premium', 'premium')}
            {renderFilterPill('Consumers', 'consumer')}
          </ScrollView>

          {/* Results count + select controls */}
          {filteredUsers.length > 0 && (
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-xs text-stone-500">
                {filteredUsers.length} result{filteredUsers.length !== 1 ? 's' : ''}
                {selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ''}
              </Text>
              {selectedIds.size > 0 ? (
                <Pressable onPress={clearSelection}>
                  <Text className="text-xs font-semibold text-red-500">Clear</Text>
                </Pressable>
              ) : (
                <Pressable onPress={selectAll}>
                  <Text className="text-xs font-semibold text-blue-600">Select All</Text>
                </Pressable>
              )}
            </View>
          )}
        </Animated.View>

        {/* Empty state */}
        {filteredUsers.length === 0 && !loading && (
          <View className="items-center justify-center px-8 pt-12">
            <View className="w-14 h-14 rounded-full bg-stone-100 items-center justify-center mb-3">
              <UsersIcon size={28} color="#A8A29E" />
            </View>
            <Text className="text-stone-700 font-semibold text-base text-center mb-1">No users found</Text>
            <Text className="text-stone-400 text-sm text-center">
              {search ? 'Try a different search term.' : 'No accounts match this filter.'}
            </Text>
          </View>
        )}

        {/* User List */}
        <View className="px-5 pt-2">
          {filteredUsers.map((user, index) => {
            const roleStyle   = getRoleStyle(user);
            const statusStyle = getStatusStyle(user.status);
            const isSelected  = selectedIds.has(user.id);
            const IconComponent = roleStyle.icon;

            // Compute farmstands here so both the ownership section and the delete button can use it
            const userFarmstands = isFarmer(user)
              ? allFarmstands.filter(
                  f => (f.ownerUserId && f.ownerUserId === user.id) ||
                       (f.claimedByUserId && f.claimedByUserId === user.id)
                )
              : [];

            return (
              <Animated.View
                key={user.id}
                entering={FadeInDown.delay(220 + index * 40).duration(350)}
              >
                {/* Card container — NOT a Pressable so farmstand and delete sections don't interfere */}
                <View
                  className={`bg-white rounded-[20px] mb-3 overflow-hidden ${
                    user.status === 'suspended' ? 'border-2 border-red-200' : ''
                  } ${isSelected ? 'border-2 border-blue-400' : ''}`}
                  style={{
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 3 },
                    shadowOpacity: isSelected ? 0.1 : 0.06,
                    shadowRadius: 12,
                    elevation: isSelected ? 5 : 3,
                  }}
                >
                  {/* ── Tappable header section (tap = select, long-press = action menu) ── */}
                  <Pressable onPress={() => toggleSelect(user.id)} onLongPress={() => handleOpenMenu(user)}>
                    <View className="p-4">
                      <View className="flex-row items-center">
                        {/* Avatar / checkbox */}
                        <View className="mr-3">
                          {isSelected ? (
                            <View className="w-10 h-10 rounded-full bg-blue-500 items-center justify-center">
                              <Check size={18} color="white" />
                            </View>
                          ) : (
                            <View
                              className="w-10 h-10 rounded-full items-center justify-center"
                              style={{ backgroundColor: user.status === 'suspended' ? '#FEE2E2' : roleStyle.bg }}
                            >
                              <IconComponent size={20} color={user.status === 'suspended' ? '#DC2626' : roleStyle.iconColor} />
                            </View>
                          )}
                        </View>

                        {/* Info */}
                        <View className="flex-1">
                          <Text className="text-base font-semibold text-stone-900">{user.full_name}</Text>
                          <Text className="text-xs text-stone-500 mt-0.5" numberOfLines={1}>{user.email}</Text>
                        </View>

                        {/* Edit — opens action menu (role/status changes) */}
                        <Pressable
                          onPress={() => handleOpenMenu(user)}
                          hitSlop={8}
                          className="px-3 py-2 bg-stone-100 rounded-full active:bg-stone-200"
                        >
                          <Text className="text-xs font-medium text-stone-600">Edit</Text>
                        </Pressable>
                      </View>

                      {/* Badges */}
                      <View className="flex-row mt-3 pt-3 border-t border-stone-100 items-center flex-wrap" style={{ gap: 6 }}>
                        {isFarmer(user) && (
                          <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: '#DCFCE7' }}>
                            <Text className="text-xs font-semibold" style={{ color: '#16A34A' }}>Farmer</Text>
                          </View>
                        )}
                        {isPremium(user) && (
                          <View className="flex-row items-center px-2.5 py-1 rounded-full" style={{ backgroundColor: '#FEF3C7' }}>
                            <Crown size={10} color="#D97706" style={{ marginRight: 3 }} />
                            <Text className="text-xs font-semibold" style={{ color: '#D97706' }}>Premium</Text>
                          </View>
                        )}
                        {isConsumer(user) && (
                          <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: '#F3F4F6' }}>
                            <Text className="text-xs font-semibold" style={{ color: '#6B7280' }}>Consumer</Text>
                          </View>
                        )}
                        <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: statusStyle.bg }}>
                          <Text className="text-xs font-semibold capitalize" style={{ color: statusStyle.text }}>
                            {user.status}
                          </Text>
                        </View>
                        <View className="flex-1" />
                        <Text className="text-xs text-stone-400">Joined {formatJoinDate(user.created_at)}</Text>
                      </View>
                    </View>
                  </Pressable>

                  {/* ── Farmstand Ownership section — outside the selection Pressable ── */}
                  {userFarmstands.length > 0 && (
                    <View className="border-t border-stone-100 px-4 pb-3 pt-2">
                      <Text className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">
                        Farmstand Ownership
                      </Text>
                      {userFarmstands.map(fs => (
                        <View key={fs.id} className="flex-row items-center mb-1.5">
                          <View className="w-5 h-5 rounded-full bg-green-100 items-center justify-center mr-2">
                            <Store size={10} color="#16A34A" />
                          </View>
                          <View className="flex-1 mr-2">
                            <Text className="text-xs font-medium text-stone-700" numberOfLines={1}>
                              {fs.name || 'Unnamed Farmstand'}
                            </Text>
                            {(fs.city || fs.state) && (
                              <Text className="text-xs text-stone-400">
                                {[fs.city, fs.state].filter(Boolean).join(', ')}
                              </Text>
                            )}
                          </View>
                          {/* Removes farmstand ownership — uses fs.id (farmstand) + user.id (owner auth UUID) */}
                          <Pressable
                            onPress={() => handleOpenRemoveOwnership(fs.id, fs.name || 'Unnamed Farmstand', user.id, user.full_name)}
                            className="flex-row items-center px-2.5 py-1.5 rounded-full active:opacity-70"
                            style={{ backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' }}
                          >
                            <ShieldOff size={11} color="#EF4444" />
                            <Text className="text-xs font-semibold ml-1" style={{ color: '#EF4444' }}>
                              Remove Ownership
                            </Text>
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* ── Delete Account — uses user.id (auth UUID) directly, no selectedUser indirection ── */}
                  <View className="border-t border-stone-100 px-4 pb-3 pt-2">
                    <Pressable
                      onPress={() => handleDeleteUser(user)}
                      className="flex-row items-center justify-center py-2 rounded-xl active:opacity-70"
                      style={{ backgroundColor: '#FEF2F2' }}
                    >
                      <Trash2 size={13} color="#EF4444" />
                      <Text className="text-xs font-semibold ml-1.5" style={{ color: '#EF4444' }}>
                        Delete Account
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </Animated.View>
            );
          })}
        </View>

        {/* Refresh button */}
        {!loading && (
          <View className="items-center pt-2 pb-4">
            <Pressable
              onPress={() => fetchUsers(true)}
              className="flex-row items-center px-4 py-2 bg-white rounded-full border border-stone-200 active:bg-stone-50"
            >
              <RefreshCw size={14} color={refreshing ? '#2D5A3D' : '#A8A29E'} />
              <Text className="ml-2 text-xs text-stone-500">{refreshing ? 'Refreshing...' : 'Refresh list'}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* Floating action bar */}
      {selectedIds.size > 0 && (
        <Animated.View
          entering={FadeInDown.duration(300)}
          className="absolute bottom-0 left-0 right-0"
          style={{
            paddingBottom: Platform.OS === 'ios' ? 34 : 16,
            paddingTop: 12,
            paddingHorizontal: 20,
            backgroundColor: '#FFFFFF',
            borderTopWidth: 1,
            borderTopColor: '#E7E0D8',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -4 },
            shadowOpacity: 0.08,
            shadowRadius: 16,
            elevation: 12,
          }}
        >
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-xs font-semibold text-stone-600">
              {selectedIds.size} user{selectedIds.size !== 1 ? 's' : ''} selected
            </Text>
            <Pressable onPress={clearSelection}>
              <X size={18} color="#A8A29E" />
            </Pressable>
          </View>
          <View className="flex-row" style={{ gap: 10 }}>
            <Pressable
              onPress={handleEmail}
              className="flex-1 flex-row items-center justify-center py-3.5 rounded-2xl active:opacity-80"
              style={{ backgroundColor: '#3B82F6' }}
            >
              <Mail size={16} color="white" />
              <Text className="ml-2 text-white font-semibold text-sm">
                Email {selectedIds.size > 1 ? `(BCC ${selectedIds.size})` : ''}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleOpenAlertModal}
              className="flex-1 flex-row items-center justify-center py-3.5 rounded-2xl active:opacity-80"
              style={{ backgroundColor: '#2D5A3D' }}
            >
              <Bell size={16} color="white" />
              <Text className="ml-2 text-white font-semibold text-sm">
                Alert {selectedIds.size > 1 ? `(${selectedIds.size})` : ''}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      )}

      {/* Action Menu Modal */}
      <Modal visible={showActionMenu} transparent animationType="fade" onRequestClose={() => setShowActionMenu(false)}>
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setShowActionMenu(false)}>
          <View className="bg-white rounded-t-[28px] pt-3 pb-8">
            <View className="w-12 h-1.5 bg-stone-300 rounded-full self-center mb-4" />
            <Text className="text-lg font-bold text-stone-900 px-5 mb-0.5">{selectedUser?.full_name}</Text>
            <Text className="text-sm text-stone-500 px-5 mb-4">{selectedUser?.email}</Text>

            <Pressable
              onPress={() => { setShowActionMenu(false); setTimeout(() => setShowRoleMenu(true), 200); }}
              className="flex-row items-center px-5 py-4 active:bg-stone-50"
            >
              <View className="w-10 h-10 rounded-full bg-purple-100 items-center justify-center mr-4">
                <UserCog size={18} color="#7C3AED" />
              </View>
              <Text className="text-base text-stone-700 flex-1">Change Role</Text>
              <ChevronRight size={18} color="#A8A29E" />
            </Pressable>

            <Pressable onPress={handleToggleStatus} className="flex-row items-center px-5 py-4 active:bg-stone-50">
              {selectedUser?.status === 'active' ? (
                <>
                  <View className="w-10 h-10 rounded-full bg-amber-100 items-center justify-center mr-4">
                    <Ban size={18} color="#F59E0B" />
                  </View>
                  <Text className="text-base text-amber-600 flex-1">Suspend User</Text>
                </>
              ) : (
                <>
                  <View className="w-10 h-10 rounded-full bg-green-100 items-center justify-center mr-4">
                    <CheckCircle size={18} color="#16A34A" />
                  </View>
                  <Text className="text-base text-green-600 flex-1">Reactivate User</Text>
                </>
              )}
              <ChevronRight size={18} color="#A8A29E" />
            </Pressable>

            <Pressable onPress={() => selectedUser && handleDeleteUser(selectedUser)} className="flex-row items-center px-5 py-4 active:bg-stone-50">
              <View className="w-10 h-10 rounded-full bg-red-100 items-center justify-center mr-4">
                <Trash2 size={18} color="#EF4444" />
              </View>
              <Text className="text-base text-red-500 flex-1">Delete User</Text>
              <ChevronRight size={18} color="#A8A29E" />
            </Pressable>

            <Pressable onPress={() => setShowActionMenu(false)} className="mx-5 mt-4 py-3.5 bg-stone-100 rounded-2xl items-center">
              <Text className="text-base font-medium text-stone-600">Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Role Selection Modal */}
      <Modal visible={showRoleMenu} transparent animationType="fade" onRequestClose={() => setShowRoleMenu(false)}>
        <Pressable className="flex-1 bg-black/50 justify-center items-center px-6" onPress={() => setShowRoleMenu(false)}>
          <View
            className="bg-white rounded-[24px] w-full overflow-hidden"
            style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 10 }}
          >
            <View className="flex-row items-center justify-between px-5 py-4 border-b border-stone-100">
              <Text className="text-lg font-bold text-stone-900">Change Role</Text>
              <Pressable onPress={() => setShowRoleMenu(false)} className="w-8 h-8 bg-stone-100 rounded-full items-center justify-center">
                <X size={18} color="#78716C" />
              </Pressable>
            </View>

            {(['consumer', 'farmer'] as const).map((role) => {
              const currentLabel = selectedUser ? getRoleLabel(selectedUser) : '';
              const isSelected   = currentLabel.toLowerCase() === role;
              const rs = role === 'farmer'
                ? { bg: '#DCFCE7', text: '#16A34A', icon: Store, iconColor: '#16A34A', desc: 'Can manage their own farmstands' }
                : { bg: '#F3F4F6', text: '#6B7280', icon: User, iconColor: '#6B7280', desc: 'Can browse and save farmstands' };
              const IconCmp = rs.icon;
              return (
                <Pressable
                  key={role}
                  onPress={() => handleChangeRole(role)}
                  className={`flex-row items-center px-5 py-4 ${isSelected ? 'bg-green-50' : 'active:bg-stone-50'}`}
                >
                  <View className="w-11 h-11 rounded-full items-center justify-center mr-4" style={{ backgroundColor: rs.bg }}>
                    <IconCmp size={20} color={rs.iconColor} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-medium text-stone-900 capitalize">{role}</Text>
                    <Text className="text-sm text-stone-500">{rs.desc}</Text>
                  </View>
                  {isSelected && (
                    <View className="w-8 h-8 rounded-full bg-green-100 items-center justify-center">
                      <CheckCircle size={18} color="#16A34A" />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>

      {/* Remove Ownership Confirmation Modal */}
      <Modal
        visible={showRemoveOwnershipModal}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!isRemovingOwnership) setShowRemoveOwnershipModal(false); }}
      >
        <Pressable
          className="flex-1 bg-black/50 justify-center items-center px-6"
          onPress={() => { if (!isRemovingOwnership) setShowRemoveOwnershipModal(false); }}
        >
          <Pressable
            onPress={() => {}}
            className="bg-white rounded-[24px] w-full overflow-hidden"
            style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 10 }}
          >
            {/* Header */}
            <View className="px-5 pt-5 pb-4 border-b border-stone-100">
              <View className="flex-row items-center mb-3">
                <View className="w-10 h-10 rounded-full bg-red-100 items-center justify-center mr-3">
                  <AlertTriangle size={20} color="#EF4444" />
                </View>
                <Text className="text-lg font-bold text-stone-900">Remove Ownership</Text>
              </View>
              <Text className="text-sm text-stone-600 leading-5">
                This will remove{' '}
                <Text className="font-semibold text-stone-900">{removeOwnershipTarget?.userName}</Text>
                {' '}as the owner of{' '}
                <Text className="font-semibold text-stone-900">{removeOwnershipTarget?.farmstandName}</Text>
                {'.'}
              </Text>
            </View>

            {/* Info */}
            <View className="px-5 py-4 bg-amber-50">
              <Text className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">What happens</Text>
              {[
                'The farmstand remains active and visible on the app',
                'The user loses owner/edit access immediately',
                'The farmstand returns to unclaimed status',
                'The user receives an inbox notification',
              ].map((line, i) => (
                <View key={i} className="flex-row items-start mb-1.5">
                  <Text className="text-amber-500 mr-2 mt-0.5">•</Text>
                  <Text className="text-xs text-amber-800 flex-1">{line}</Text>
                </View>
              ))}
            </View>

            {/* Actions */}
            <View className="px-5 py-4 flex-row" style={{ gap: 10 }}>
              <Pressable
                onPress={() => { if (!isRemovingOwnership) setShowRemoveOwnershipModal(false); }}
                className="flex-1 py-3.5 rounded-2xl items-center bg-stone-100 active:bg-stone-200"
                disabled={isRemovingOwnership}
              >
                <Text className="text-sm font-semibold text-stone-600">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleConfirmRemoveOwnership}
                className="flex-1 py-3.5 rounded-2xl items-center active:opacity-80"
                style={{ backgroundColor: '#EF4444' }}
                disabled={isRemovingOwnership}
              >
                {isRemovingOwnership ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text className="text-sm font-semibold text-white">Remove Ownership</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Alert Broadcast Modal */}
      <Modal
        visible={showAlertModal}
        transparent
        animationType="slide"
        onRequestClose={() => { if (!isSending) setShowAlertModal(false); }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
          <Pressable
            className="flex-1 bg-black/50 justify-end"
            onPress={() => { if (!isSending) setShowAlertModal(false); }}
          >
            <Pressable onPress={() => {}} className="bg-white rounded-t-[28px] pt-3 pb-8 px-5">
              <View className="w-12 h-1.5 bg-stone-300 rounded-full self-center mb-5" />

              <View className="flex-row items-center justify-between mb-5">
                <View>
                  <Text className="text-xl font-bold text-stone-900">Send Alert</Text>
                  <Text className="text-sm text-stone-500 mt-0.5">To {selectedIds.size} user{selectedIds.size !== 1 ? 's' : ''}</Text>
                </View>
                <Pressable
                  onPress={() => { if (!isSending) setShowAlertModal(false); }}
                  className="w-9 h-9 bg-stone-100 rounded-full items-center justify-center"
                >
                  <X size={18} color="#78716C" />
                </Pressable>
              </View>

              {sendResult && (
                <View className={`rounded-xl p-4 mb-4 flex-row items-start ${sendResult.success ? 'bg-green-50' : 'bg-red-50'}`}>
                  <View className="mr-3 mt-0.5">
                    {sendResult.success ? <CheckCircle size={18} color="#16A34A" /> : <AlertCircle size={18} color="#DC2626" />}
                  </View>
                  <Text className={`flex-1 text-sm ${sendResult.success ? 'text-green-700' : 'text-red-700'}`}>
                    {sendResult.message}
                  </Text>
                </View>
              )}

              {!sendResult?.success && (
                <>
                  <View className="mb-4">
                    <Text className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">Alert Title</Text>
                    <TextInput
                      className="bg-stone-50 rounded-xl px-4 py-3 text-stone-900 text-base border border-stone-200"
                      placeholder="e.g. Important Update"
                      placeholderTextColor="#A8A29E"
                      value={alertTitle}
                      onChangeText={setAlertTitle}
                      maxLength={100}
                      editable={!isSending}
                    />
                  </View>
                  <View className="mb-4">
                    <Text className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">Message</Text>
                    <TextInput
                      className="bg-stone-50 rounded-xl px-4 py-3 text-stone-900 text-sm border border-stone-200"
                      placeholder="Write your message here..."
                      placeholderTextColor="#A8A29E"
                      value={alertMessage}
                      onChangeText={setAlertMessage}
                      multiline
                      numberOfLines={4}
                      textAlignVertical="top"
                      style={{ minHeight: 96 }}
                      maxLength={500}
                      editable={!isSending}
                    />
                  </View>
                  <View className="mb-6">
                    <Text className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">Deep Link (optional)</Text>
                    <TextInput
                      className="bg-stone-50 rounded-xl px-4 py-3 text-stone-900 text-sm border border-stone-200"
                      placeholder="e.g. FarmstandDetail, Inbox"
                      placeholderTextColor="#A8A29E"
                      value={alertRoute}
                      onChangeText={setAlertRoute}
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!isSending}
                    />
                    <Text className="text-xs text-stone-400 mt-1.5">Leave blank to open the Alerts tab when tapped.</Text>
                  </View>
                  <Pressable
                    onPress={handleSendAlert}
                    disabled={isSending}
                    className="flex-row items-center justify-center py-4 rounded-2xl active:opacity-80"
                    style={{ backgroundColor: isSending ? '#A8A29E' : '#2D5A3D' }}
                  >
                    {isSending ? <ActivityIndicator size="small" color="white" /> : <Bell size={18} color="white" />}
                    <Text className="ml-2 text-white font-bold text-base">
                      {isSending ? 'Sending...' : `Send to ${selectedIds.size} User${selectedIds.size !== 1 ? 's' : ''}`}
                    </Text>
                  </Pressable>
                </>
              )}

              {sendResult?.success && (
                <Pressable onPress={() => setShowAlertModal(false)} className="py-4 rounded-2xl items-center bg-stone-100 mt-2">
                  <Text className="text-stone-700 font-semibold text-base">Done</Text>
                </Pressable>
              )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

export default function Users() {
  return (
    <AdminGuard>
      <UsersContent />
    </AdminGuard>
  );
}
