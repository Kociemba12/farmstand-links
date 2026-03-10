import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  User,
  Shield,
  Store,
  UserCog,
  Ban,
  CheckCircle,
  Trash2,
  X,
  Users as UsersIcon,
  ChevronRight,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { AdminGuard } from '@/components/AdminGuard';
import { useAdminStore, AdminUser } from '@/lib/admin-store';
import { ADMIN_EMAIL } from '@/lib/user-store';

// Background color constant
const BG_COLOR = '#FAF7F2';

function UsersContent() {
  const router = useRouter();
  const users = useAdminStore((s) => s.users);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const updateUserRole = useAdminStore((s) => s.updateUserRole);
  const updateUserStatus = useAdminStore((s) => s.updateUserStatus);
  const deleteUser = useAdminStore((s) => s.deleteUser);

  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [showRoleMenu, setShowRoleMenu] = useState(false);

  useEffect(() => {
    loadAdminData();
  }, []);

  const getRoleStyle = (role: string) => {
    switch (role) {
      case 'admin':
        return { bg: '#EDE9FE', text: '#7C3AED', icon: Shield, iconColor: '#7C3AED' };
      case 'farmer':
        return { bg: '#DCFCE7', text: '#16A34A', icon: Store, iconColor: '#16A34A' };
      default:
        return { bg: '#F3F4F6', text: '#6B7280', icon: User, iconColor: '#6B7280' };
    }
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'active':
        return { bg: '#DCFCE7', text: '#16A34A' };
      case 'suspended':
        return { bg: '#FEE2E2', text: '#DC2626' };
      default:
        return { bg: '#F3F4F6', text: '#6B7280' };
    }
  };

  const handleOpenMenu = async (user: AdminUser) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedUser(user);
    setShowActionMenu(true);
  };

  const handleChangeRole = async (role: 'admin' | 'farmer' | 'consumer') => {
    if (!selectedUser) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await updateUserRole(selectedUser.id, role);
    setShowRoleMenu(false);
    setShowActionMenu(false);
    setSelectedUser(null);
  };

  const handleToggleStatus = async () => {
    if (!selectedUser) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const newStatus = selectedUser.status === 'active' ? 'suspended' : 'active';
    await updateUserStatus(selectedUser.id, newStatus);
    setShowActionMenu(false);
    setSelectedUser(null);
  };

  const handleDeleteUser = () => {
    if (!selectedUser) return;
    setShowActionMenu(false);

    Alert.alert(
      'Delete User',
      `Are you sure you want to delete "${selectedUser.name}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            await deleteUser(selectedUser.id);
            setSelectedUser(null);
          },
        },
      ]
    );
  };

  // Check if user is the protected admin
  const isProtectedAdmin = (email: string) => {
    return email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  };

  // Stats
  const adminCount = users.filter((u) => u.role === 'admin').length;
  const farmerCount = users.filter((u) => u.role === 'farmer').length;
  const consumerCount = users.filter((u) => u.role === 'consumer').length;

  return (
    <View className="flex-1" style={{ backgroundColor: BG_COLOR }}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Hero Header */}
        <Animated.View entering={FadeIn.duration(500)}>
          <LinearGradient
            colors={['#3B82F6', '#60A5FA', '#93C5FD']}
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
                    <UsersIcon size={32} color="white" />
                  </View>
                  <Text className="text-white text-2xl font-bold">Manage Users</Text>
                  <Text className="text-blue-200 text-sm mt-1">
                    {users.length} total user{users.length !== 1 ? 's' : ''}
                  </Text>
                </View>
              </View>
            </SafeAreaView>
          </LinearGradient>
        </Animated.View>

        {/* Stats Cards - overlapping hero */}
        <View className="px-5 -mt-10">
          <Animated.View
            entering={FadeInDown.delay(100).duration(400)}
            className="flex-row"
            style={{ gap: 10 }}
          >
            <View
              className="flex-1 bg-white rounded-2xl p-4 items-center"
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.08,
                shadowRadius: 16,
                elevation: 5,
              }}
            >
              <Text className="text-2xl font-bold text-purple-600">{adminCount}</Text>
              <Text className="text-xs text-stone-500 mt-1">Admins</Text>
            </View>
            <View
              className="flex-1 bg-white rounded-2xl p-4 items-center"
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.08,
                shadowRadius: 16,
                elevation: 5,
              }}
            >
              <Text className="text-2xl font-bold text-green-600">{farmerCount}</Text>
              <Text className="text-xs text-stone-500 mt-1">Farmers</Text>
            </View>
            <View
              className="flex-1 bg-white rounded-2xl p-4 items-center"
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.08,
                shadowRadius: 16,
                elevation: 5,
              }}
            >
              <Text className="text-2xl font-bold text-stone-600">{consumerCount}</Text>
              <Text className="text-xs text-stone-500 mt-1">Users</Text>
            </View>
          </Animated.View>
        </View>

        {/* User List */}
        <View className="px-5 pt-6">
          {users.map((user, index) => {
            const roleStyle = getRoleStyle(user.role);
            const statusStyle = getStatusStyle(user.status);
            const isAdmin = isProtectedAdmin(user.email);
            const IconComponent = roleStyle.icon;

            return (
              <Animated.View
                key={user.id}
                entering={FadeInDown.delay(200 + index * 50).duration(400)}
              >
                <View
                  className={`bg-white rounded-[20px] p-4 mb-3 ${
                    user.status === 'suspended' ? 'border-2 border-red-200' : ''
                  }`}
                  style={{
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 3 },
                    shadowOpacity: 0.06,
                    shadowRadius: 12,
                    elevation: 3,
                  }}
                >
                  <View className="flex-row items-center">
                    <View
                      className="w-12 h-12 rounded-full items-center justify-center mr-4"
                      style={{
                        backgroundColor:
                          user.status === 'suspended' ? '#FEE2E2' : roleStyle.bg,
                      }}
                    >
                      <IconComponent
                        size={22}
                        color={user.status === 'suspended' ? '#DC2626' : roleStyle.iconColor}
                      />
                    </View>
                    <View className="flex-1">
                      <View className="flex-row items-center">
                        <Text className="text-base font-semibold text-stone-900">
                          {user.name}
                        </Text>
                        {isAdmin && (
                          <View className="ml-2 bg-amber-100 px-2 py-0.5 rounded-full">
                            <Text className="text-xs text-amber-700 font-medium">Owner</Text>
                          </View>
                        )}
                      </View>
                      <Text className="text-sm text-stone-500">{user.email}</Text>
                    </View>

                    {/* Don't show menu for protected admin */}
                    {!isAdmin && (
                      <Pressable
                        onPress={() => handleOpenMenu(user)}
                        className="px-3 py-2 bg-stone-100 rounded-full active:bg-stone-200"
                      >
                        <Text className="text-xs font-medium text-stone-600">Edit</Text>
                      </Pressable>
                    )}
                  </View>

                  <View className="flex-row mt-3 pt-3 border-t border-stone-100 items-center">
                    <View
                      className="px-2.5 py-1 rounded-full mr-2"
                      style={{ backgroundColor: roleStyle.bg }}
                    >
                      <Text
                        className="text-xs font-semibold capitalize"
                        style={{ color: roleStyle.text }}
                      >
                        {user.role}
                      </Text>
                    </View>
                    <View
                      className="px-2.5 py-1 rounded-full"
                      style={{ backgroundColor: statusStyle.bg }}
                    >
                      <Text
                        className="text-xs font-semibold capitalize"
                        style={{ color: statusStyle.text }}
                      >
                        {user.status}
                      </Text>
                    </View>
                    <View className="flex-1" />
                    <Text className="text-xs text-stone-400">Joined {user.createdAt}</Text>
                  </View>

                  {user.role === 'farmer' && user.farmstandCount > 0 && (
                    <View className="flex-row items-center mt-2 pt-2 border-t border-stone-100">
                      <View className="w-6 h-6 rounded-full bg-green-100 items-center justify-center mr-2">
                        <Store size={12} color="#16A34A" />
                      </View>
                      <Text className="text-sm text-stone-600">
                        {user.farmstandCount} farmstand{user.farmstandCount !== 1 ? 's' : ''}
                      </Text>
                    </View>
                  )}
                </View>
              </Animated.View>
            );
          })}
        </View>
      </ScrollView>

      {/* Action Menu Modal */}
      <Modal
        visible={showActionMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowActionMenu(false)}
      >
        <Pressable
          className="flex-1 bg-black/50 justify-end"
          onPress={() => setShowActionMenu(false)}
        >
          <View className="bg-white rounded-t-[28px] pt-3 pb-8">
            <View className="w-12 h-1.5 bg-stone-300 rounded-full self-center mb-4" />
            <Text className="text-lg font-bold text-stone-900 px-5 mb-1">
              {selectedUser?.name}
            </Text>
            <Text className="text-sm text-stone-500 px-5 mb-4">{selectedUser?.email}</Text>

            <Pressable
              onPress={() => {
                setShowActionMenu(false);
                setTimeout(() => setShowRoleMenu(true), 200);
              }}
              className="flex-row items-center px-5 py-4 active:bg-stone-50"
            >
              <View className="w-10 h-10 rounded-full bg-purple-100 items-center justify-center mr-4">
                <UserCog size={18} color="#7C3AED" />
              </View>
              <Text className="text-base text-stone-700 flex-1">Change Role</Text>
              <ChevronRight size={18} color="#A8A29E" />
            </Pressable>

            <Pressable
              onPress={handleToggleStatus}
              className="flex-row items-center px-5 py-4 active:bg-stone-50"
            >
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

            <Pressable
              onPress={handleDeleteUser}
              className="flex-row items-center px-5 py-4 active:bg-stone-50"
            >
              <View className="w-10 h-10 rounded-full bg-red-100 items-center justify-center mr-4">
                <Trash2 size={18} color="#EF4444" />
              </View>
              <Text className="text-base text-red-500 flex-1">Delete User</Text>
              <ChevronRight size={18} color="#A8A29E" />
            </Pressable>

            <Pressable
              onPress={() => setShowActionMenu(false)}
              className="mx-5 mt-4 py-3.5 bg-stone-100 rounded-2xl items-center"
            >
              <Text className="text-base font-medium text-stone-600">Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Role Selection Modal */}
      <Modal
        visible={showRoleMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRoleMenu(false)}
      >
        <Pressable
          className="flex-1 bg-black/50 justify-center items-center px-6"
          onPress={() => setShowRoleMenu(false)}
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
            <View className="flex-row items-center justify-between px-5 py-4 border-b border-stone-100">
              <Text className="text-lg font-bold text-stone-900">Change Role</Text>
              <Pressable
                onPress={() => setShowRoleMenu(false)}
                className="w-8 h-8 bg-stone-100 rounded-full items-center justify-center"
              >
                <X size={18} color="#78716C" />
              </Pressable>
            </View>

            {(['consumer', 'farmer', 'admin'] as const).map((role) => {
              const isSelected = selectedUser?.role === role;
              const roleStyle = getRoleStyle(role);
              const IconComponent = roleStyle.icon;

              return (
                <Pressable
                  key={role}
                  onPress={() => handleChangeRole(role)}
                  className={`flex-row items-center px-5 py-4 ${
                    isSelected ? 'bg-green-50' : 'active:bg-stone-50'
                  }`}
                >
                  <View
                    className="w-11 h-11 rounded-full items-center justify-center mr-4"
                    style={{ backgroundColor: roleStyle.bg }}
                  >
                    <IconComponent size={20} color={roleStyle.iconColor} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-medium text-stone-900 capitalize">
                      {role}
                    </Text>
                    <Text className="text-sm text-stone-500">
                      {role === 'admin' && 'Full access to all features'}
                      {role === 'farmer' && 'Can manage their own farmstands'}
                      {role === 'consumer' && 'Can browse and save farmstands'}
                    </Text>
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
