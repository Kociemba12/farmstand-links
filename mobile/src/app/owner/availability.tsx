import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Save,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Package,
  MessageSquare,
  Calendar,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useUserStore } from '@/lib/user-store';
import { useAdminStore } from '@/lib/admin-store';
import { useProductsStore } from '@/lib/products-store';
import { logFarmstandEdit } from '@/lib/analytics-events';
import { Farmstand, OperationalStatus } from '@/lib/farmer-store';
import { FarmerRouteGuard } from '@/components/FarmerRouteGuard';

const STATUS_OPTIONS: { id: OperationalStatus; label: string; description: string; color: string; icon: React.ReactNode }[] = [
  {
    id: 'active',
    label: 'Open',
    description: 'We are open for business',
    color: '#16a34a',
    icon: <CheckCircle size={24} color="#16a34a" />,
  },
  {
    id: 'temporarily_closed',
    label: 'Temporarily Closed',
    description: 'Closed for a short time, will reopen soon',
    color: '#f59e0b',
    icon: <Clock size={24} color="#f59e0b" />,
  },
  {
    id: 'seasonal',
    label: 'Seasonal Closure',
    description: 'Closed for the season',
    color: '#3b82f6',
    icon: <Calendar size={24} color="#3b82f6" />,
  },
  {
    id: 'permanently_closed',
    label: 'Permanently Closed',
    description: 'No longer in operation',
    color: '#ef4444',
    icon: <XCircle size={24} color="#ef4444" />,
  },
];

export default function AvailabilityScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const farmstandId = params.id;

  const user = useUserStore((s) => s.user);
  const isLoggedIn = useUserStore((s) => s.isLoggedIn);
  const isGuest = useUserStore((s) => s.isGuest);

  const getFarmstandById = useAdminStore((s) => s.getFarmstandById);
  const updateFarmstand = useAdminStore((s) => s.updateFarmstand);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);

  const products = useProductsStore((s) => s.products);
  const loadProducts = useProductsStore((s) => s.loadProducts);
  const getProductsForFarmstand = useProductsStore((s) => s.getProductsForFarmstand);
  const markAllInStock = useProductsStore((s) => s.markAllInStock);
  const markAllOutOfStock = useProductsStore((s) => s.markAllOutOfStock);
  const logEdit = useProductsStore((s) => s.logEdit);


  const isGuestUser = isGuest();

  const [farmstand, setFarmstand] = useState<Farmstand | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [operationalStatus, setOperationalStatus] = useState<OperationalStatus>('active');
  const [todaysNote, setTodaysNote] = useState('');
  const [showOnMap, setShowOnMap] = useState(true);

  // Check authorization
  useEffect(() => {
    if (!isLoggedIn) {
      router.replace('/auth/login');
    }
  }, [isLoggedIn]);

  // Load data
  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      await loadAdminData();
      await loadProducts();

      if (farmstandId) {
        const fs = getFarmstandById(farmstandId);
        if (fs) {
          // Verify ownership
          if (fs.ownerUserId !== user?.id && fs.ownerUserId !== user?.email) {
            Alert.alert('Unauthorized', 'You do not have permission to edit this farmstand.', [
              { text: 'OK', onPress: () => router.back() },
            ]);
            return;
          }
          setFarmstand(fs);
          setOperationalStatus(fs.operationalStatus || 'active');
          setTodaysNote(fs.todaysNote || '');
          setShowOnMap(fs.showOnMap);
        }
      }
      setIsLoading(false);
    };

    load();
  }, [farmstandId]);

  const farmstandProducts = farmstandId ? getProductsForFarmstand(farmstandId) : [];
  const inStockCount = farmstandProducts.filter((p) => p.is_in_stock && p.is_active).length;
  const outOfStockCount = farmstandProducts.filter((p) => !p.is_in_stock && p.is_active).length;
  const totalProducts = farmstandProducts.filter((p) => p.is_active).length;

  const handleStatusChange = async (status: OperationalStatus) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setOperationalStatus(status);
  };

  const handleMarkAllInStock = async () => {
    if (!farmstandId || !user?.id) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await markAllInStock(farmstandId, user.id);
    Alert.alert('Done', 'All products marked as in stock');
  };

  const handleMarkAllOutOfStock = async () => {
    if (!farmstandId || !user?.id) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await markAllOutOfStock(farmstandId, user.id);
    Alert.alert('Done', 'All products marked as out of stock');
  };

  const handleSave = async () => {
    if (!farmstandId || !user?.id || !farmstand) return;

    setIsSaving(true);

    try {
      // Log changes
      if (operationalStatus !== farmstand.operationalStatus) {
        await logEdit(
          farmstandId,
          'operationalStatus',
          farmstand.operationalStatus || null,
          operationalStatus,
          user.id,
          'owner'
        );
      }

      if (todaysNote !== (farmstand.todaysNote || '')) {
        await logEdit(
          farmstandId,
          'todaysNote',
          farmstand.todaysNote || null,
          todaysNote || null,
          user.id,
          'owner'
        );
      }

      if (showOnMap !== farmstand.showOnMap) {
        await logEdit(
          farmstandId,
          'showOnMap',
          String(farmstand.showOnMap),
          String(showOnMap),
          user.id,
          'owner'
        );
      }

      await updateFarmstand(farmstandId, {
        operationalStatus,
        todaysNote: todaysNote.trim() || null,
        showOnMap,
      });

      logFarmstandEdit(farmstandId, ['availability'], user.id);

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', 'Your availability has been updated!', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error) {
      console.error('Save error:', error);
      Alert.alert('Error', 'Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  // Show guard for guests - AFTER all hooks
  if (isGuestUser) {
    return <FarmerRouteGuard title="Availability" />;
  }

  if (isLoading) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#2D5A3D" />
      </View>
    );
  }

  const currentStatus = STATUS_OPTIONS.find((s) => s.id === operationalStatus);

  return (
    <View className="flex-1 bg-gray-50">
      <SafeAreaView edges={['top']} className="bg-forest">
        <View className="flex-row items-center justify-between px-5 py-4">
          <Pressable onPress={() => router.back()} className="p-2 -ml-2">
            <ArrowLeft size={24} color="white" />
          </Pressable>
          <Text className="text-lg font-semibold text-white">Availability</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Current Status Banner */}
        <Animated.View
          entering={FadeInDown.delay(0)}
          className="mx-4 mt-4 rounded-2xl p-5 border"
          style={{
            backgroundColor: `${currentStatus?.color}10`,
            borderColor: `${currentStatus?.color}40`,
          }}
        >
          <View className="flex-row items-center">
            {currentStatus?.icon}
            <View className="ml-4 flex-1">
              <Text className="text-gray-900 font-bold text-lg">{currentStatus?.label}</Text>
              <Text className="text-gray-600 text-sm">{currentStatus?.description}</Text>
            </View>
          </View>
        </Animated.View>

        {/* Operating Status Selection */}
        <Animated.View entering={FadeInDown.delay(100)} className="mx-4 mt-4">
          <Text className="text-sm font-semibold text-gray-500 uppercase mb-3">Operating Status</Text>

          {STATUS_OPTIONS.map((status) => (
            <Pressable
              key={status.id}
              onPress={() => handleStatusChange(status.id)}
              className={`flex-row items-center p-4 rounded-xl mb-2 border ${
                operationalStatus === status.id
                  ? 'bg-white border-forest'
                  : 'bg-white border-gray-100'
              }`}
            >
              {status.icon}
              <View className="ml-4 flex-1">
                <Text className="text-gray-900 font-medium">{status.label}</Text>
                <Text className="text-gray-500 text-sm">{status.description}</Text>
              </View>
              {operationalStatus === status.id && (
                <View className="w-6 h-6 bg-forest rounded-full items-center justify-center">
                  <CheckCircle size={14} color="white" />
                </View>
              )}
            </Pressable>
          ))}
        </Animated.View>

        {/* Today's Note */}
        <Animated.View entering={FadeInDown.delay(200)} className="mx-4 mt-6">
          <View className="flex-row items-center mb-3">
            <MessageSquare size={18} color="#6b7280" />
            <Text className="text-sm font-semibold text-gray-500 uppercase ml-2">Today's Note</Text>
          </View>
          <View className="bg-amber-50 rounded-2xl p-4 border border-amber-200">
            <Text className="text-amber-700 text-sm mb-3">
              Share a quick update with customers - what's fresh, special deals, or anything else!
            </Text>
            <TextInput
              value={todaysNote}
              onChangeText={setTodaysNote}
              placeholder="e.g., 'Fresh strawberries just picked today! First come, first served.'"
              placeholderTextColor="#d97706"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              className="bg-white rounded-xl px-4 py-3 text-base text-gray-900 min-h-[80px] border border-amber-200"
            />
          </View>
        </Animated.View>

        {/* Products Stock Overview */}
        {totalProducts > 0 && (
          <Animated.View entering={FadeInDown.delay(300)} className="mx-4 mt-6">
            <View className="flex-row items-center mb-3">
              <Package size={18} color="#6b7280" />
              <Text className="text-sm font-semibold text-gray-500 uppercase ml-2">Product Stock</Text>
            </View>

            <View className="bg-white rounded-2xl p-4 border border-gray-100">
              {/* Stats Row */}
              <View className="flex-row mb-4">
                <View className="flex-1 items-center">
                  <Text className="text-3xl font-bold text-green-600">{inStockCount}</Text>
                  <Text className="text-gray-500 text-sm">In Stock</Text>
                </View>
                <View className="w-px bg-gray-200" />
                <View className="flex-1 items-center">
                  <Text className="text-3xl font-bold text-red-500">{outOfStockCount}</Text>
                  <Text className="text-gray-500 text-sm">Out of Stock</Text>
                </View>
                <View className="w-px bg-gray-200" />
                <View className="flex-1 items-center">
                  <Text className="text-3xl font-bold text-gray-700">{totalProducts}</Text>
                  <Text className="text-gray-500 text-sm">Total</Text>
                </View>
              </View>

              {/* Quick Actions */}
              <View className="flex-row pt-4 border-t border-gray-100">
                <Pressable
                  onPress={handleMarkAllInStock}
                  className="flex-1 bg-green-50 border border-green-200 rounded-xl py-3 mr-2 items-center"
                >
                  <CheckCircle size={18} color="#16a34a" />
                  <Text className="text-green-700 font-medium text-sm mt-1">All In Stock</Text>
                </Pressable>
                <Pressable
                  onPress={handleMarkAllOutOfStock}
                  className="flex-1 bg-red-50 border border-red-200 rounded-xl py-3 ml-2 items-center"
                >
                  <XCircle size={18} color="#ef4444" />
                  <Text className="text-red-700 font-medium text-sm mt-1">All Out</Text>
                </Pressable>
              </View>

              <Pressable
                onPress={() => router.push(`/owner/products?id=${farmstandId}`)}
                className="mt-3 py-3 border-t border-gray-100"
              >
                <Text className="text-forest font-medium text-center">Manage Individual Products</Text>
              </Pressable>
            </View>
          </Animated.View>
        )}

        {/* Map Visibility */}
        <Animated.View entering={FadeInDown.delay(400)} className="mx-4 mt-6">
          <Text className="text-sm font-semibold text-gray-500 uppercase mb-3">Visibility</Text>

          <View className="bg-white rounded-2xl p-4 border border-gray-100 flex-row items-center justify-between">
            <View className="flex-1">
              <Text className="text-gray-900 font-medium">Show on Map</Text>
              <Text className="text-gray-500 text-sm">
                {showOnMap
                  ? 'Your farmstand is visible to customers'
                  : 'Your farmstand is hidden from the map'}
              </Text>
            </View>
            <Switch
              value={showOnMap}
              onValueChange={setShowOnMap}
              trackColor={{ false: '#fca5a5', true: '#86efac' }}
              thumbColor={showOnMap ? '#16a34a' : '#ef4444'}
            />
          </View>

          {!showOnMap && (
            <View className="flex-row items-start mt-3 px-2">
              <AlertTriangle size={16} color="#f59e0b" />
              <Text className="text-amber-600 text-sm ml-2 flex-1">
                While hidden, customers won't be able to find your farmstand on the map or in search results.
              </Text>
            </View>
          )}
        </Animated.View>
      </ScrollView>

      {/* Save Button */}
      <SafeAreaView edges={['bottom']} className="bg-white border-t border-gray-100">
        <View className="px-5 py-4">
          <Pressable
            onPress={handleSave}
            disabled={isSaving}
            className="bg-forest py-4 rounded-xl items-center flex-row justify-center"
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <>
                <Save size={20} color="white" />
                <Text className="text-white font-semibold text-base ml-2">Save Changes</Text>
              </>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
