import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Clock } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFarmerStore, HoursSchedule, HoursDay } from '@/lib/farmer-store';
import * as Haptics from 'expo-haptics';

const DAYS = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
] as const;

const TIME_OPTIONS = [
  '06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '09:30',
  '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
  '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00',
];

function formatTime(time: string): string {
  const [hours, minutes] = time.split(':');
  const h = parseInt(hours, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export default function UpdateHoursScreen() {
  const router = useRouter();
  const { farmstandId } = useLocalSearchParams<{ farmstandId: string }>();

  const getFarmstandById = useFarmerStore((s) => s.getFarmstandById);
  const updateFarmstand = useFarmerStore((s) => s.updateFarmstand);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hours, setHours] = useState<HoursSchedule | null>(null);
  const [selectedDay, setSelectedDay] = useState<DayKey | null>(null);
  const [selectingTime, setSelectingTime] = useState<'open' | 'close' | null>(null);

  useEffect(() => {
    if (farmstandId) {
      const farmstand = getFarmstandById(farmstandId);
      if (farmstand?.hours) {
        setHours(farmstand.hours);
      } else {
        // Default hours
        setHours({
          timezone: 'America/Los_Angeles',
          mon: { open: '09:00', close: '17:00', closed: false },
          tue: { open: '09:00', close: '17:00', closed: false },
          wed: { open: '09:00', close: '17:00', closed: false },
          thu: { open: '09:00', close: '17:00', closed: false },
          fri: { open: '09:00', close: '17:00', closed: false },
          sat: { open: '09:00', close: '17:00', closed: false },
          sun: { open: '09:00', close: '17:00', closed: true },
        });
      }
      setIsLoading(false);
    }
  }, [farmstandId, getFarmstandById]);

  const handleBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  const toggleDayClosed = async (day: DayKey) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!hours) return;

    setHours({
      ...hours,
      [day]: {
        ...hours[day],
        closed: !hours[day].closed,
      },
    });
  };

  const selectTime = async (day: DayKey, type: 'open' | 'close') => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedDay(day);
    setSelectingTime(type);
  };

  const handleTimeSelect = async (time: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!hours || !selectedDay || !selectingTime) return;

    setHours({
      ...hours,
      [selectedDay]: {
        ...hours[selectedDay],
        [selectingTime]: time,
      },
    });

    setSelectedDay(null);
    setSelectingTime(null);
  };

  const handleSave = async () => {
    if (!hours) return;

    setIsSaving(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await updateFarmstand(farmstandId!, { hours });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', 'Your hours have been updated.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error) {
      Alert.alert('Error', 'Failed to save hours. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#2D5A3D" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-cream">
      <SafeAreaView edges={['top']} className="bg-forest">
        <View className="flex-row items-center px-4 py-4">
          <Pressable onPress={handleBack} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#FDF8F3" />
          </Pressable>
          <Text className="text-cream text-xl font-bold ml-2">Update Hours</Text>
        </View>
      </SafeAreaView>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="px-5 py-6">
          <View className="bg-white rounded-2xl border border-sand overflow-hidden mb-6">
            {DAYS.map((day, index) => {
              const dayHours = hours?.[day.key];
              return (
                <View
                  key={day.key}
                  className={`p-4 ${index !== DAYS.length - 1 ? 'border-b border-sand' : ''}`}
                >
                  <View className="flex-row items-center justify-between mb-3">
                    <Text className="text-charcoal font-semibold">{day.label}</Text>
                    <Pressable
                      onPress={() => toggleDayClosed(day.key)}
                      className={`px-3 py-1 rounded-full ${
                        dayHours?.closed ? 'bg-terracotta/10' : 'bg-mint/20'
                      }`}
                    >
                      <Text
                        className={`text-sm font-medium ${
                          dayHours?.closed ? 'text-terracotta' : 'text-forest'
                        }`}
                      >
                        {dayHours?.closed ? 'Closed' : 'Open'}
                      </Text>
                    </Pressable>
                  </View>

                  {!dayHours?.closed && (
                    <View className="flex-row items-center">
                      <Pressable
                        onPress={() => selectTime(day.key, 'open')}
                        className="flex-1 bg-cream rounded-lg py-3 items-center border border-sand"
                      >
                        <Text className="text-charcoal font-medium">
                          {formatTime(dayHours?.open || '09:00')}
                        </Text>
                      </Pressable>
                      <Text className="text-wood mx-3">to</Text>
                      <Pressable
                        onPress={() => selectTime(day.key, 'close')}
                        className="flex-1 bg-cream rounded-lg py-3 items-center border border-sand"
                      >
                        <Text className="text-charcoal font-medium">
                          {formatTime(dayHours?.close || '17:00')}
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {/* Time Picker */}
          {selectedDay && selectingTime && (
            <View className="bg-white rounded-2xl border border-sand p-4 mb-6">
              <Text className="text-charcoal font-bold mb-3">
                Select {selectingTime === 'open' ? 'Opening' : 'Closing'} Time
              </Text>
              <View className="flex-row flex-wrap">
                {TIME_OPTIONS.map((time) => (
                  <Pressable
                    key={time}
                    onPress={() => handleTimeSelect(time)}
                    className={`px-3 py-2 rounded-lg mr-2 mb-2 ${
                      hours?.[selectedDay]?.[selectingTime] === time
                        ? 'bg-forest'
                        : 'bg-cream border border-sand'
                    }`}
                  >
                    <Text
                      className={
                        hours?.[selectedDay]?.[selectingTime] === time
                          ? 'text-cream font-medium'
                          : 'text-charcoal'
                      }
                    >
                      {formatTime(time)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                onPress={() => {
                  setSelectedDay(null);
                  setSelectingTime(null);
                }}
                className="mt-3 py-2 items-center"
              >
                <Text className="text-wood">Cancel</Text>
              </Pressable>
            </View>
          )}

          {/* Tips */}
          <View className="bg-mint/10 rounded-2xl p-4 border border-mint/30">
            <View className="flex-row items-start">
              <Clock size={20} color="#2D5A3D" />
              <View className="ml-3 flex-1">
                <Text className="text-charcoal font-semibold mb-1">Tip</Text>
                <Text className="text-bark text-sm">
                  Keep your hours up to date so customers know when to visit. You can also
                  add special hours for holidays in the future.
                </Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Save Button */}
      <SafeAreaView edges={['bottom']} className="bg-cream border-t border-sand">
        <View className="px-5 py-4">
          <Pressable
            onPress={handleSave}
            disabled={isSaving}
            className={`py-4 rounded-xl items-center ${
              isSaving ? 'bg-sand' : 'bg-forest'
            }`}
          >
            {isSaving ? (
              <ActivityIndicator color="#FDF8F3" />
            ) : (
              <Text className="text-cream font-semibold text-lg">Save Hours</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
