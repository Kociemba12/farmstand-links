import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft,
  Store,
  MapPin,
  AlertCircle,
  ChevronRight,
  Clock,
  CheckCircle,
  XCircle,
  Info,
} from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useUserStore } from '@/lib/user-store';
import { useAdminStore } from '@/lib/admin-store';
import { Farmstand } from '@/lib/farmer-store';

type FilterType = 'all' | 'pending' | 'verified' | 'rejected' | 'needs_info';

const FILTERS: { key: FilterType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'verified', label: 'Verified' },
  { key: 'needs_info', label: 'Needs Info' },
  { key: 'rejected', label: 'Rejected' },
];

// Get verification status pill styling
const getVerificationStatusPill = (verificationStatus: string | undefined) => {
  switch (verificationStatus) {
    case 'VERIFIED':
      return { label: 'Verified', color: '#16A34A', bg: '#DCFCE7', icon: CheckCircle };
    case 'PENDING_VERIFICATION':
      return { label: 'Pending', color: '#D97706', bg: '#FEF3C7', icon: Clock };
    case 'NEEDS_INFO':
      return { label: 'Needs Info', color: '#2563EB', bg: '#DBEAFE', icon: Info };
    case 'REJECTED':
      return { label: 'Rejected', color: '#DC2626', bg: '#FEE2E2', icon: XCircle };
    default:
      return { label: 'Pending', color: '#D97706', bg: '#FEF3C7', icon: Clock };
  }
};

// Format date for display
const formatDate = (dateString: string | undefined) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function SubmissionsScreen() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const allFarmstands = useAdminStore((s) => s.allFarmstands);
  const isLoading = useAdminStore((s) => s.isLoading);

  const [activeFilter, setActiveFilter] = useState<FilterType>('all');

  // Reload data when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadAdminData();
    }, [loadAdminData])
  );

  // Find farmstands SUBMITTED by this user
  const mySubmissions = allFarmstands.filter(
    (f) => f.createdByUserId === user?.id
  );

  // Apply filter
  const filteredSubmissions = mySubmissions.filter((submission) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'pending') return submission.verificationStatus === 'PENDING_VERIFICATION';
    if (activeFilter === 'verified') return submission.verificationStatus === 'VERIFIED';
    if (activeFilter === 'rejected') return submission.verificationStatus === 'REJECTED';
    if (activeFilter === 'needs_info') return submission.verificationStatus === 'NEEDS_INFO';
    return true;
  });

  // Sort by createdAt (newest first)
  const sortedSubmissions = [...filteredSubmissions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const handleBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  const handleFilterPress = (filter: FilterType) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveFilter(filter);
  };

  const handleSubmissionPress = (submission: Farmstand) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/farm/${submission.id}`);
  };

  // Get count for each filter
  const getCounts = () => ({
    all: mySubmissions.length,
    pending: mySubmissions.filter((s) => s.verificationStatus === 'PENDING_VERIFICATION').length,
    verified: mySubmissions.filter((s) => s.verificationStatus === 'VERIFIED').length,
    rejected: mySubmissions.filter((s) => s.verificationStatus === 'REJECTED').length,
    needs_info: mySubmissions.filter((s) => s.verificationStatus === 'NEEDS_INFO').length,
  });

  const counts = getCounts();

  return (
    <>
      {/* Hide the default navigation header */}
      <Stack.Screen options={{ headerShown: false }} />

      <View className="flex-1 bg-[#FAF7F2]">
        <SafeAreaView className="flex-1" edges={['top']}>
          {/* Header */}
          <View className="flex-row items-center px-4 py-3 border-b border-stone-200 bg-white">
          <Pressable onPress={handleBack} className="p-2 -ml-2 active:opacity-70">
            <ArrowLeft size={24} color="#1C1917" />
          </Pressable>
          <Text className="flex-1 text-lg font-bold text-stone-900 ml-2">My Submissions</Text>
          <View className="bg-stone-100 px-3 py-1 rounded-full">
            <Text className="text-stone-600 text-sm font-medium">{mySubmissions.length}</Text>
          </View>
        </View>

        {/* Filter Chips */}
        <View className="bg-white border-b border-stone-100">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}
          >
            {FILTERS.map((filter) => {
              const isActive = activeFilter === filter.key;
              const count = counts[filter.key];
              return (
                <Pressable
                  key={filter.key}
                  onPress={() => handleFilterPress(filter.key)}
                  className={`flex-row items-center px-4 py-2 rounded-full ${
                    isActive ? 'bg-forest' : 'bg-stone-100'
                  }`}
                >
                  <Text
                    className={`text-sm font-medium ${
                      isActive ? 'text-white' : 'text-stone-700'
                    }`}
                  >
                    {filter.label}
                  </Text>
                  {count > 0 && (
                    <View
                      className={`ml-2 px-1.5 py-0.5 rounded-full ${
                        isActive ? 'bg-white/20' : 'bg-stone-200'
                      }`}
                    >
                      <Text
                        className={`text-xs font-semibold ${
                          isActive ? 'text-white' : 'text-stone-600'
                        }`}
                      >
                        {count}
                      </Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Content */}
        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#2D5A3D" />
          </View>
        ) : sortedSubmissions.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <View className="w-20 h-20 rounded-full bg-stone-100 items-center justify-center mb-4">
              <Store size={36} color="#A8A29E" />
            </View>
            <Text className="text-stone-900 text-lg font-semibold text-center mb-2">
              {activeFilter === 'all' ? 'No Submissions Yet' : `No ${FILTERS.find(f => f.key === activeFilter)?.label} Submissions`}
            </Text>
            <Text className="text-stone-500 text-center">
              {activeFilter === 'all'
                ? 'Farmstands you add will appear here so you can track their verification status.'
                : 'Try a different filter to see your submissions.'}
            </Text>
          </View>
        ) : (
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ padding: 16 }}
            showsVerticalScrollIndicator={false}
          >
            <Text className="text-stone-500 text-sm mb-4">
              Submitted listings are visible on the map while an admin reviews them.
            </Text>

            {sortedSubmissions.map((submission, index) => {
              const statusPill = getVerificationStatusPill(submission.verificationStatus);
              const StatusIcon = statusPill.icon;

              return (
                <Animated.View
                  key={submission.id}
                  entering={FadeInDown.delay(index * 50).duration(300)}
                >
                  <Pressable
                    onPress={() => handleSubmissionPress(submission)}
                    className="bg-white rounded-2xl p-4 mb-3 active:scale-[0.98]"
                    style={{
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.04,
                      shadowRadius: 8,
                      elevation: 2,
                    }}
                  >
                    <View className="flex-row items-start">
                      {/* Thumbnail */}
                      <View className="w-16 h-16 rounded-xl overflow-hidden bg-stone-100">
                        {submission.photos?.[0] ? (
                          <Image
                            source={{ uri: submission.photos[0] }}
                            style={{ width: 64, height: 64 }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View className="w-full h-full items-center justify-center">
                            <Store size={28} color="#A8A29E" />
                          </View>
                        )}
                      </View>

                      {/* Info */}
                      <View className="flex-1 ml-3">
                        <View className="flex-row items-center justify-between mb-1">
                          <Text
                            className="text-stone-900 font-semibold text-base flex-1 mr-2"
                            numberOfLines={1}
                          >
                            {submission.name}
                          </Text>
                        </View>

                        <View className="flex-row items-center mb-2">
                          <MapPin size={12} color="#78716C" />
                          <Text className="text-stone-500 text-sm ml-1">
                            {submission.city || 'Unknown'}, {submission.state || 'OR'}
                          </Text>
                        </View>

                        {/* Status Row */}
                        <View className="flex-row items-center justify-between">
                          <View
                            className="flex-row items-center px-2.5 py-1 rounded-full"
                            style={{ backgroundColor: statusPill.bg }}
                          >
                            <StatusIcon size={12} color={statusPill.color} />
                            <Text
                              className="text-xs font-semibold ml-1"
                              style={{ color: statusPill.color }}
                            >
                              {statusPill.label}
                            </Text>
                          </View>
                          <Text className="text-stone-400 text-xs">
                            {formatDate(submission.createdAt)}
                          </Text>
                        </View>

                        {/* Admin Notes (if applicable) */}
                        {submission.verificationStatus === 'NEEDS_INFO' &&
                          submission.submissionAdminNotes && (
                            <View className="flex-row items-center mt-2 bg-blue-50 px-2 py-1.5 rounded-lg">
                              <AlertCircle size={12} color="#2563EB" />
                              <Text
                                className="text-blue-700 text-xs ml-1.5 flex-1"
                                numberOfLines={2}
                              >
                                {submission.submissionAdminNotes}
                              </Text>
                            </View>
                          )}

                        {submission.verificationStatus === 'REJECTED' &&
                          submission.rejectionReason && (
                            <View className="flex-row items-center mt-2 bg-red-50 px-2 py-1.5 rounded-lg">
                              <AlertCircle size={12} color="#DC2626" />
                              <Text
                                className="text-red-700 text-xs ml-1.5 flex-1"
                                numberOfLines={2}
                              >
                                {submission.rejectionReason}
                              </Text>
                            </View>
                          )}
                      </View>

                      <View className="justify-center ml-2 mt-4">
                        <ChevronRight size={18} color="#A8A29E" />
                      </View>
                    </View>
                  </Pressable>
                </Animated.View>
              );
            })}

            {/* Bottom padding */}
            <View className="h-8" />
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
    </>
  );
}
