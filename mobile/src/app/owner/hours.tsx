import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Switch,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Save,
  Clock,
  ChevronDown,
  CheckCircle,
  Calendar,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useUserStore, isAdminEmail } from '@/lib/user-store';
import { useAdminStore } from '@/lib/admin-store';
import { useProductsStore } from '@/lib/products-store';
import { logFarmstandEdit } from '@/lib/analytics-events';
import { Farmstand, HoursSchedule, HoursDay, OperationalStatus, SeasonalDates } from '@/lib/farmer-store';
import { FarmerRouteGuard } from '@/components/FarmerRouteGuard';

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

const OPERATIONAL_STATUS_OPTIONS: { id: OperationalStatus; label: string; color: string }[] = [
  { id: 'active', label: 'Open & Operating', color: '#16a34a' },
  { id: 'temporarily_closed', label: 'Temporarily Closed', color: '#f59e0b' },
  { id: 'seasonal', label: 'Seasonal (Closed Now)', color: '#3b82f6' },
  { id: 'permanently_closed', label: 'Permanently Closed', color: '#ef4444' },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DAYS: { key: DayKey; label: string; short: string }[] = [
  { key: 'mon', label: 'Monday', short: 'Mon' },
  { key: 'tue', label: 'Tuesday', short: 'Tue' },
  { key: 'wed', label: 'Wednesday', short: 'Wed' },
  { key: 'thu', label: 'Thursday', short: 'Thu' },
  { key: 'fri', label: 'Friday', short: 'Fri' },
  { key: 'sat', label: 'Saturday', short: 'Sat' },
  { key: 'sun', label: 'Sunday', short: 'Sun' },
];

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hour = Math.floor(i / 2);
  const minute = i % 2 === 0 ? '00' : '30';
  const hourStr = hour.toString().padStart(2, '0');
  return `${hourStr}:${minute}`;
});

const formatTime = (time: string): string => {
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${minutes.toString().padStart(2, '0')} ${period}`;
};

const DEFAULT_HOURS: HoursSchedule = {
  timezone: 'America/Los_Angeles',
  mon: { open: '09:00', close: '17:00', closed: false },
  tue: { open: '09:00', close: '17:00', closed: false },
  wed: { open: '09:00', close: '17:00', closed: false },
  thu: { open: '09:00', close: '17:00', closed: false },
  fri: { open: '09:00', close: '17:00', closed: false },
  sat: { open: '09:00', close: '17:00', closed: false },
  sun: { open: '09:00', close: '17:00', closed: true },
};

interface DayHoursRowProps {
  dayKey: DayKey;
  label: string;
  hours: HoursDay;
  onOpenChange: (time: string) => void;
  onCloseChange: (time: string) => void;
  onClosedToggle: (closed: boolean) => void;
}

function DayHoursRow({ dayKey, label, hours, onOpenChange, onCloseChange, onClosedToggle }: DayHoursRowProps) {
  const [showOpenPicker, setShowOpenPicker] = useState(false);
  const [showClosePicker, setShowClosePicker] = useState(false);

  return (
    <>
      <View className="flex-row items-center py-4 border-b border-gray-100">
        <View className="w-24">
          <Text className="text-gray-900 font-medium">{label}</Text>
        </View>

        {hours.closed ? (
          <View className="flex-1 flex-row items-center justify-center">
            <Text className="text-gray-400 font-medium">Closed</Text>
          </View>
        ) : (
          <View className="flex-1 flex-row items-center justify-center">
            <Pressable
              onPress={() => setShowOpenPicker(true)}
              className="bg-gray-100 px-3 py-2 rounded-lg"
            >
              <Text className="text-gray-900">{formatTime(hours.open ?? '09:00')}</Text>
            </Pressable>
            <Text className="text-gray-400 mx-2">to</Text>
            <Pressable
              onPress={() => setShowClosePicker(true)}
              className="bg-gray-100 px-3 py-2 rounded-lg"
            >
              <Text className="text-gray-900">{formatTime(hours.close ?? '17:00')}</Text>
            </Pressable>
          </View>
        )}

        <Switch
          value={!hours.closed}
          onValueChange={(open) => onClosedToggle(!open)}
          trackColor={{ false: '#d1d5db', true: '#86efac' }}
          thumbColor={!hours.closed ? '#16a34a' : '#9ca3af'}
        />
      </View>

      {/* Open Time Picker */}
      <Modal visible={showOpenPicker} transparent animationType="fade">
        <Pressable
          className="flex-1 bg-black/50 justify-end"
          onPress={() => setShowOpenPicker(false)}
        >
          <View className="bg-white rounded-t-3xl pt-2 pb-8 max-h-[50%]">
            <View className="w-10 h-1 bg-gray-300 rounded-full self-center mb-4" />
            <Text className="text-lg font-semibold text-gray-900 px-5 mb-3">
              {label} - Opens At
            </Text>
            <ScrollView>
              {TIME_OPTIONS.map((time) => (
                <Pressable
                  key={time}
                  onPress={() => {
                    onOpenChange(time);
                    setShowOpenPicker(false);
                  }}
                  className="flex-row items-center px-5 py-3 active:bg-gray-50"
                >
                  <Text className="text-base text-gray-700 flex-1">{formatTime(time)}</Text>
                  {hours.open === time && <CheckCircle size={20} color="#2D5A3D" />}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* Close Time Picker */}
      <Modal visible={showClosePicker} transparent animationType="fade">
        <Pressable
          className="flex-1 bg-black/50 justify-end"
          onPress={() => setShowClosePicker(false)}
        >
          <View className="bg-white rounded-t-3xl pt-2 pb-8 max-h-[50%]">
            <View className="w-10 h-1 bg-gray-300 rounded-full self-center mb-4" />
            <Text className="text-lg font-semibold text-gray-900 px-5 mb-3">
              {label} - Closes At
            </Text>
            <ScrollView>
              {TIME_OPTIONS.map((time) => (
                <Pressable
                  key={time}
                  onPress={() => {
                    onCloseChange(time);
                    setShowClosePicker(false);
                  }}
                  className="flex-row items-center px-5 py-3 active:bg-gray-50"
                >
                  <Text className="text-base text-gray-700 flex-1">{formatTime(time)}</Text>
                  {hours.close === time && <CheckCircle size={20} color="#2D5A3D" />}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

export default function HoursScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const paramFarmstandId = params.id;

  const user = useUserStore((s) => s.user);
  const isLoggedIn = useUserStore((s) => s.isLoggedIn);
  const isGuest = useUserStore((s) => s.isGuest);

  const allFarmstands = useAdminStore((s) => s.allFarmstands);
  const updateFarmstand = useAdminStore((s) => s.updateFarmstand);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);

  const logEdit = useProductsStore((s) => s.logEdit);

  const isGuestUser = isGuest();

  const [farmstand, setFarmstand] = useState<Farmstand | null>(null);
  const [farmstandId, setFarmstandId] = useState<string | null>(paramFarmstandId ?? null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hours, setHours] = useState<HoursSchedule>(DEFAULT_HOURS);
  const [noFarmstandError, setNoFarmstandError] = useState(false);
  const [operationalStatus, setOperationalStatus] = useState<OperationalStatus>('active');
  const [showOnMap, setShowOnMap] = useState(true);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showSeasonalModal, setShowSeasonalModal] = useState(false);
  const [seasonalStart, setSeasonalStart] = useState<{ month: number; day: number } | null>(null);
  const [seasonalEnd, setSeasonalEnd] = useState<{ month: number; day: number } | null>(null);

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
      setIsLoading(false);
    };

    load();
  }, [loadAdminData]);

  // Find user's farmstand when data is loaded
  useEffect(() => {
    if (isLoading || !user) return;

    let targetFarmstandId = paramFarmstandId;

    // If no ID provided in params, find the user's farmstand
    if (!targetFarmstandId) {
      // First check user.farmId
      if (user.farmId) {
        targetFarmstandId = user.farmId;
      } else {
        // Find farmstand where user is the owner
        const userFarmstand = allFarmstands.find(
          (f) => f.ownerUserId === user.id ||
                 f.ownerUserId === user.email ||
                 (f.claimStatus === 'claimed' && f.ownerUserId === user.id)
        );
        if (userFarmstand) {
          targetFarmstandId = userFarmstand.id;
        }
      }
    }

    // If still no farmstand ID found, show error
    if (!targetFarmstandId) {
      setNoFarmstandError(true);
      setIsLoading(false);
      return;
    }

    setFarmstandId(targetFarmstandId);

    const fs = allFarmstands.find((f) => f.id === targetFarmstandId);
    if (fs) {
      // Check ownership: user must own this farmstand OR be an admin (by email)
      const isAdmin = isAdminEmail(user.email);
      const isOwner = fs.ownerUserId === user.id ||
                      fs.ownerUserId === user.email ||
                      user.farmId === fs.id;

      if (!isAdmin && !isOwner) {
        Alert.alert('Unauthorized', 'You do not have permission to edit this farmstand.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
        return;
      }
      setFarmstand(fs);
      setHours(fs.hours || DEFAULT_HOURS);
      setOperationalStatus(fs.operationalStatus || 'active');
      setShowOnMap(fs.showOnMap ?? true);
      if (fs.seasonalDates) {
        setSeasonalStart({ month: fs.seasonalDates.start_month, day: fs.seasonalDates.start_day });
        setSeasonalEnd({ month: fs.seasonalDates.end_month, day: fs.seasonalDates.end_day });
      }
      setNoFarmstandError(false);
    } else {
      console.error('Farmstand not found:', targetFarmstandId, 'Available IDs:', allFarmstands.map(f => f.id));
      setNoFarmstandError(true);
    }
  }, [paramFarmstandId, allFarmstands, isLoading, user]);

  const updateDayHours = useCallback((day: DayKey, field: keyof HoursDay, value: string | boolean) => {
    setHours((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        [field]: value,
      },
    }));
  }, []);

  const applyToAllDays = useCallback((day: DayKey) => {
    const sourceHours = hours[day];
    setHours((prev) => {
      const updated = { ...prev };
      DAYS.forEach((d) => {
        updated[d.key] = { ...sourceHours };
      });
      return updated;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Applied', `Applied ${DAYS.find((d) => d.key === day)?.label} hours to all days`);
  }, [hours]);

  const setWeekdayWeekendHours = useCallback(() => {
    setHours((prev) => ({
      ...prev,
      mon: { open: '09:00', close: '17:00', closed: false },
      tue: { open: '09:00', close: '17:00', closed: false },
      wed: { open: '09:00', close: '17:00', closed: false },
      thu: { open: '09:00', close: '17:00', closed: false },
      fri: { open: '09:00', close: '17:00', closed: false },
      sat: { open: '08:00', close: '14:00', closed: false },
      sun: { open: '08:00', close: '14:00', closed: true },
    }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  // Convert time string to minutes for comparison
  const timeToMinutes = (time: string): number => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  };

  // Validate hours - ensure closeTime > openTime for open days
  const validateHours = (): { valid: boolean; error?: string } => {
    for (const day of DAYS) {
      const dayHours = hours[day.key];
      if (!dayHours.closed) {
        // Check that times are set
        if (!dayHours.open || !dayHours.close) {
          return { valid: false, error: `${day.label}: Please set both open and close times` };
        }
        // Check that close time is after open time
        const openMinutes = timeToMinutes(dayHours.open);
        const closeMinutes = timeToMinutes(dayHours.close);
        if (closeMinutes <= openMinutes) {
          return { valid: false, error: `${day.label}: Close time must be later than open time` };
        }
      }
    }
    return { valid: true };
  };

  const handleSave = async () => {
    // 1. Check authentication
    if (!isLoggedIn || !user?.id) {
      const errorDetails = {
        step: 'authentication',
        isLoggedIn,
        userId: user?.id ?? null,
      };
      console.error('Save hours failed:', errorDetails);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        'Error',
        "You must be logged in to save hours",
        [{ text: 'OK', onPress: () => router.replace('/auth/login') }]
      );
      return;
    }

    // 2. Check farmstand exists
    if (!farmstandId || !farmstand) {
      const errorDetails = {
        step: 'farmstand_lookup',
        farmstandId: farmstandId ?? null,
        farmstandExists: !!farmstand,
      };
      console.error('Save hours failed:', errorDetails);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        'Error',
        "Couldn't save hours—try again\n\nDetails: Farmstand not found (ID: " + (farmstandId ?? 'missing') + ")"
      );
      return;
    }

    // 3. Check permission - user must own this farmstand OR be an admin (by email)
    const isAdmin = isAdminEmail(user.email);
    const isOwner = farmstand.ownerUserId === user.id ||
                    farmstand.ownerUserId === user.email ||
                    user.farmId === farmstand.id;

    if (!isAdmin && !isOwner) {
      const errorDetails = {
        step: 'permission',
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        userFarmId: user.farmId,
        ownerUserId: farmstand.ownerUserId,
        farmstandId,
      };
      console.error('Save hours failed:', errorDetails);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        'Unauthorized',
        "You do not have permission to edit this farmstand.\n\nDetails: Owner ID mismatch"
      );
      return;
    }

    // 4. Validate hours before saving (only for open days)
    const validation = validateHours();
    if (!validation.valid) {
      const errorDetails = {
        step: 'validation',
        error: validation.error,
        farmstandId,
        hours,
      };
      console.error('Save hours failed:', errorDetails);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Invalid Hours', validation.error);
      return;
    }

    setIsSaving(true);

    let currentStep = 'prepare';
    try {
      // 5. Prepare hours data for save - handle closed days properly
      // For closed days, we keep the structure but mark closed=true
      // Times are kept as strings in "HH:MM" format for open days
      const hoursToSave: HoursSchedule = {
        timezone: hours.timezone || 'America/Los_Angeles',
        mon: prepareDay(hours.mon),
        tue: prepareDay(hours.tue),
        wed: prepareDay(hours.wed),
        thu: prepareDay(hours.thu),
        fri: prepareDay(hours.fri),
        sat: prepareDay(hours.sat),
        sun: prepareDay(hours.sun),
      };

      // 6. Log changes for audit trail
      currentStep = 'audit_log';
      if (JSON.stringify(hoursToSave) !== JSON.stringify(farmstand.hours)) {
        await logEdit(
          farmstandId,
          'hours',
          farmstand.hours ? JSON.stringify(farmstand.hours) : null,
          JSON.stringify(hoursToSave),
          user.id,
          'owner'
        );
      }

      // 7. Persist to storage via admin store (upsert - creates or updates)
      currentStep = 'upsert';

      // Build seasonal dates if provided
      let seasonalDates: SeasonalDates | null = null;
      if (seasonalStart && seasonalEnd) {
        seasonalDates = {
          start_month: seasonalStart.month,
          start_day: seasonalStart.day,
          end_month: seasonalEnd.month,
          end_day: seasonalEnd.day,
        };
      }

      await updateFarmstand(farmstandId, {
        hours: hoursToSave,
        operationalStatus,
        showOnMap,
        seasonalDates,
      });

      // 8. Log analytics event
      currentStep = 'analytics';
      logFarmstandEdit(farmstandId, ['hours'], user.id);

      // 9. Refresh local state from the persisted data
      currentStep = 'refresh';
      await loadAdminData();
      // Note: allFarmstands will update via the store after loadAdminData completes
      // The useEffect watching allFarmstands will refresh the local farmstand state

      // 10. Success feedback
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Hours Saved', 'Your business hours have been updated!', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorDetails = {
        step: currentStep,
        farmstandId,
        userId: user.id,
        error: errorMessage,
        fullError: error,
      };
      console.error('Save hours error:', errorDetails);
      console.error('Full error object:', error);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        'Error',
        "Couldn't save hours—try again\n\nDetails: Failed at " + currentStep + " step\n" + errorMessage
      );
    } finally {
      setIsSaving(false);
    }
  };

  // Helper to prepare a day's hours for saving
  // Ensures proper format: closed days have closed=true with null times, open days have valid HH:MM times
  const prepareDay = (day: HoursDay): HoursDay => {
    if (day.closed) {
      // For closed days, set times to null as per requirements
      return {
        open: null,
        close: null,
        closed: true,
      };
    }
    // For open days, ensure times are in HH:MM format
    return {
      open: day.open || '09:00',
      close: day.close || '17:00',
      closed: false,
    };
  };

  // Show guard for guests - AFTER all hooks
  if (isGuestUser) {
    return <FarmerRouteGuard title="Update Hours" />;
  }

  if (isLoading) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#2D5A3D" />
      </View>
    );
  }

  // Show error if user has no farmstand
  if (noFarmstandError || !farmstand) {
    return (
      <View className="flex-1 bg-gray-50">
        <SafeAreaView edges={['top']} className="bg-forest">
          <View className="flex-row items-center justify-between px-5 py-4">
            <Pressable onPress={() => router.back()} className="p-2 -ml-2">
              <ArrowLeft size={24} color="white" />
            </Pressable>
            <Text className="text-lg font-semibold text-white">Hours</Text>
            <View className="w-10" />
          </View>
        </SafeAreaView>

        <View className="flex-1 items-center justify-center px-8">
          <View className="bg-amber-100 p-4 rounded-full mb-4">
            <Clock size={48} color="#d97706" />
          </View>
          <Text className="text-gray-900 font-bold text-xl text-center mb-2">
            No Farmstand Found
          </Text>
          <Text className="text-gray-500 text-center mb-6">
            Create your Farmstand before setting hours. You need to claim or create a farmstand first.
          </Text>
          <Pressable
            onPress={() => router.push('/(tabs)')}
            className="bg-forest px-6 py-3 rounded-xl"
          >
            <Text className="text-white font-semibold">Find Your Farmstand</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-gray-50">
      <SafeAreaView edges={['top']} className="bg-forest">
        <View className="flex-row items-center justify-between px-5 py-4">
          <Pressable onPress={() => router.back()} className="p-2 -ml-2">
            <ArrowLeft size={24} color="white" />
          </Pressable>
          <Text className="text-lg font-semibold text-white">Hours</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Operating Status Section */}
        <Animated.View entering={FadeInDown.delay(0)} className="bg-white mt-4 mx-4 rounded-2xl p-5">
          <Text className="text-sm font-semibold text-gray-500 uppercase mb-4">Operating Status</Text>

          <Pressable
            onPress={() => setShowStatusModal(true)}
            className="flex-row items-center justify-between bg-gray-100 rounded-xl px-4 py-3 mb-4"
          >
            <View className="flex-row items-center">
              <View
                className="w-3 h-3 rounded-full mr-3"
                style={{ backgroundColor: OPERATIONAL_STATUS_OPTIONS.find((s) => s.id === operationalStatus)?.color }}
              />
              <Text className="text-base text-gray-900">
                {OPERATIONAL_STATUS_OPTIONS.find((s) => s.id === operationalStatus)?.label}
              </Text>
            </View>
            <ChevronDown size={20} color="#6b7280" />
          </Pressable>

          {operationalStatus === 'seasonal' && (
            <Pressable
              onPress={() => setShowSeasonalModal(true)}
              className="flex-row items-center justify-between bg-blue-50 rounded-xl px-4 py-3 border border-blue-200 mb-4"
            >
              <View className="flex-row items-center">
                <Calendar size={18} color="#3b82f6" />
                <Text className="text-blue-700 font-medium ml-2">
                  {seasonalStart && seasonalEnd
                    ? `${MONTHS[seasonalStart.month - 1]} ${seasonalStart.day} - ${MONTHS[seasonalEnd.month - 1]} ${seasonalEnd.day}`
                    : 'Set seasonal dates'}
                </Text>
              </View>
              <ChevronDown size={20} color="#3b82f6" />
            </Pressable>
          )}

          <View className="flex-row items-center justify-between pt-4 border-t border-gray-100">
            <View>
              <Text className="text-sm font-medium text-gray-700">Show on Map</Text>
              <Text className="text-xs text-gray-500">When enabled, visible on public map</Text>
            </View>
            <Switch
              value={showOnMap}
              onValueChange={setShowOnMap}
              trackColor={{ false: '#d1d5db', true: '#86efac' }}
              thumbColor={showOnMap ? '#16a34a' : '#9ca3af'}
            />
          </View>
        </Animated.View>

        {/* Quick Actions */}
        <Animated.View entering={FadeInDown.delay(100)} className="px-4 pt-4">
          <Text className="text-sm font-semibold text-gray-500 uppercase mb-3">Quick Actions</Text>
          <View className="flex-row">
            <Pressable
              onPress={setWeekdayWeekendHours}
              className="flex-1 bg-white border border-gray-200 rounded-xl py-3 mr-2 items-center"
            >
              <Text className="text-gray-700 font-medium text-sm">Standard Week</Text>
              <Text className="text-gray-400 text-xs">9-5 weekdays, 8-2 weekends</Text>
            </Pressable>
            <Pressable
              onPress={() => applyToAllDays('mon')}
              className="flex-1 bg-white border border-gray-200 rounded-xl py-3 ml-2 items-center"
            >
              <Text className="text-gray-700 font-medium text-sm">Copy Monday</Text>
              <Text className="text-gray-400 text-xs">Apply to all days</Text>
            </Pressable>
          </View>
        </Animated.View>

        {/* Weekly Hours */}
        <Animated.View entering={FadeInDown.delay(200)} className="mx-4 mt-4">
          <View className="flex-row items-center mb-3">
            <Clock size={18} color="#6b7280" />
            <Text className="text-sm font-semibold text-gray-500 uppercase ml-2">Weekly Schedule</Text>
          </View>

          <View className="bg-white rounded-2xl px-4 border border-gray-100">
            {DAYS.map((day) => (
              <DayHoursRow
                key={day.key}
                dayKey={day.key}
                label={day.label}
                hours={hours[day.key]}
                onOpenChange={(time) => updateDayHours(day.key, 'open', time)}
                onCloseChange={(time) => updateDayHours(day.key, 'close', time)}
                onClosedToggle={(closed) => updateDayHours(day.key, 'closed', closed)}
              />
            ))}
          </View>
        </Animated.View>

        {/* Preview */}
        <Animated.View entering={FadeInDown.delay(300)} className="mx-4 mt-6">
          <Text className="text-sm font-semibold text-gray-500 uppercase mb-3">Preview</Text>
          <View className="bg-green-50 rounded-2xl p-4 border border-green-200">
            <Text className="text-green-800 font-medium mb-2">How customers will see your hours:</Text>
            {DAYS.map((day) => {
              const dayHours = hours[day.key];
              return (
                <View key={day.key} className="flex-row justify-between py-1">
                  <Text className="text-green-700">{day.short}</Text>
                  <Text className="text-green-700">
                    {dayHours.closed || !dayHours.open || !dayHours.close ? 'Closed' : `${formatTime(dayHours.open)} - ${formatTime(dayHours.close)}`}
                  </Text>
                </View>
              );
            })}
          </View>
        </Animated.View>
      </ScrollView>

      {/* Save Button */}
      <SafeAreaView edges={['bottom']} className="bg-white border-t border-gray-100">
        <View className="px-5 py-4">
          <Pressable
            onPress={handleSave}
            disabled={isSaving}
            className={`py-4 rounded-xl items-center flex-row justify-center ${isSaving ? 'bg-forest/50' : 'bg-forest'}`}
          >
            {isSaving ? (
              <>
                <ActivityIndicator size="small" color="white" />
                <Text className="text-white font-semibold text-base ml-2">Saving...</Text>
              </>
            ) : (
              <>
                <Save size={20} color="white" />
                <Text className="text-white font-semibold text-base ml-2">Save Hours</Text>
              </>
            )}
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Status Selection Modal */}
      <Modal visible={showStatusModal} transparent animationType="fade" onRequestClose={() => setShowStatusModal(false)}>
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setShowStatusModal(false)}>
          <Animated.View entering={FadeInDown.duration(200)} className="bg-white rounded-t-3xl pt-2 pb-8">
            <View className="w-10 h-1 bg-gray-300 rounded-full self-center mb-4" />
            <Text className="text-lg font-semibold text-gray-900 px-5 mb-3">Operating Status</Text>

            {OPERATIONAL_STATUS_OPTIONS.map((option) => (
              <Pressable
                key={option.id}
                onPress={() => {
                  setOperationalStatus(option.id);
                  setShowStatusModal(false);
                }}
                className="flex-row items-center px-5 py-4 active:bg-gray-50"
              >
                <View className="w-4 h-4 rounded-full mr-4" style={{ backgroundColor: option.color }} />
                <Text className="text-base text-gray-700 flex-1">{option.label}</Text>
                {operationalStatus === option.id && (
                  <View className="w-6 h-6 bg-forest rounded-full items-center justify-center">
                    <CheckCircle size={14} color="white" />
                  </View>
                )}
              </Pressable>
            ))}

            <Pressable onPress={() => setShowStatusModal(false)} className="mx-5 mt-2 py-3 bg-gray-100 rounded-xl items-center">
              <Text className="text-base font-medium text-gray-600">Cancel</Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>

      {/* Seasonal Dates Modal */}
      <Modal visible={showSeasonalModal} transparent animationType="fade" onRequestClose={() => setShowSeasonalModal(false)}>
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setShowSeasonalModal(false)}>
          <Animated.View entering={FadeInDown.duration(200)} className="bg-white rounded-t-3xl pt-2 pb-8">
            <View className="w-10 h-1 bg-gray-300 rounded-full self-center mb-4" />
            <Text className="text-lg font-semibold text-gray-900 px-5 mb-4">Seasonal Operating Dates</Text>

            <View className="px-5 mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-2">Opens</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
                {MONTHS.map((month, index) => (
                  <Pressable
                    key={month}
                    onPress={() => setSeasonalStart({ month: index + 1, day: seasonalStart?.day || 1 })}
                    className={`px-3 py-2 mr-2 rounded-full ${
                      seasonalStart?.month === index + 1 ? 'bg-forest' : 'bg-gray-100'
                    }`}
                  >
                    <Text className={seasonalStart?.month === index + 1 ? 'text-white font-medium' : 'text-gray-600'}>
                      {month.slice(0, 3)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>

            <View className="px-5 mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-2">Closes</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
                {MONTHS.map((month, index) => (
                  <Pressable
                    key={month}
                    onPress={() => setSeasonalEnd({ month: index + 1, day: seasonalEnd?.day || 1 })}
                    className={`px-3 py-2 mr-2 rounded-full ${
                      seasonalEnd?.month === index + 1 ? 'bg-forest' : 'bg-gray-100'
                    }`}
                  >
                    <Text className={seasonalEnd?.month === index + 1 ? 'text-white font-medium' : 'text-gray-600'}>
                      {month.slice(0, 3)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>

            <Pressable
              onPress={() => setShowSeasonalModal(false)}
              className="mx-5 mt-2 py-3 bg-forest rounded-xl items-center"
            >
              <Text className="text-white font-semibold">Done</Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>
    </View>
  );
}
