import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Star, MessageSquare, Send, Pencil, Trash2 } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useReviewsStore, Review } from '@/lib/reviews-store';
import { useAdminStore } from '@/lib/admin-store';
import { useUserStore } from '@/lib/user-store';
import * as Haptics from 'expo-haptics';

function getRelativeTime(dateString: string): string {
  if (dateString === 'Just now') return dateString;

  const now = Date.now();
  const date = new Date(dateString).getTime();

  if (isNaN(date)) return dateString;

  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return '1 week ago';
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 60) return '1 month ago';
  return `${Math.floor(diffDays / 30)} months ago`;
}

function formatDate(dateString: string): string {
  if (dateString === 'Just now') return dateString;

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function ReviewDetailScreen() {
  const router = useRouter();
  const { id: reviewId, farmstandId } = useLocalSearchParams<{
    id: string;
    farmstandId: string;
  }>();

  // Stores
  const loadReviews = useReviewsStore((s) => s.loadReviews);
  const reviews = useReviewsStore((s) => s.reviews);
  const addOwnerResponse = useReviewsStore((s) => s.addOwnerResponse);
  const updateOwnerResponse = useReviewsStore((s) => s.updateOwnerResponse);
  const deleteOwnerResponse = useReviewsStore((s) => s.deleteOwnerResponse);

  const adminFarmstands = useAdminStore((s) => s.allFarmstands);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);

  const user = useUserStore((s) => s.user);
  const isLoggedIn = useUserStore((s) => s.isLoggedIn);

  // Local state
  const [review, setReview] = useState<Review | null>(null);
  const [farmstandName, setFarmstandName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');

  // Determine if current user is the owner of the farmstand
  const isOwner = React.useMemo(() => {
    if (!user || !farmstandId) return false;
    const farmstand = adminFarmstands.find((f) => f.id === farmstandId);
    return farmstand?.ownerUserId === user.id && farmstand?.claimStatus === 'claimed';
  }, [user, farmstandId, adminFarmstands]);

  // Load data
  useEffect(() => {
    const init = async () => {
      await Promise.all([loadReviews(), loadAdminData()]);
      setIsLoading(false);
    };
    init();
  }, [loadReviews, loadAdminData]);

  // Find review once data is loaded
  useEffect(() => {
    if (!isLoading && reviewId) {
      const found = reviews.find((r) => r.id === reviewId);
      setReview(found ?? null);

      // Also get farmstand name for display
      if (found?.farmId) {
        const farmstand = adminFarmstands.find((f) => f.id === found.farmId);
        setFarmstandName(farmstand?.name ?? '');
      }
    }
  }, [isLoading, reviewId, reviews, adminFarmstands]);

  const handleBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  const handleSendReply = async () => {
    if (!replyText.trim() || !reviewId) return;

    setIsSending(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await addOwnerResponse(reviewId, replyText.trim(), user?.id ?? '');
      setReplyText('');

      // Refresh review data
      const updatedReview = useReviewsStore.getState().reviews.find((r) => r.id === reviewId);
      setReview(updatedReview ?? null);

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Failed to send reply:', error);
    } finally {
      setIsSending(false);
    }
  };

  const handleStartEdit = () => {
    if (review?.response?.text) {
      setEditText(review.response.text);
      setIsEditing(true);
    }
  };

  const handleSaveEdit = async () => {
    if (!editText.trim() || !reviewId) return;

    setIsSending(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await updateOwnerResponse(reviewId, editText.trim());
      setIsEditing(false);
      setEditText('');

      // Refresh review data
      const updatedReview = useReviewsStore.getState().reviews.find((r) => r.id === reviewId);
      setReview(updatedReview ?? null);

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Failed to update reply:', error);
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteReply = async () => {
    if (!reviewId) return;

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await deleteOwnerResponse(reviewId);

      // Refresh review data
      const updatedReview = useReviewsStore.getState().reviews.find((r) => r.id === reviewId);
      setReview(updatedReview ?? null);

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Failed to delete reply:', error);
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#2D5A3D" />
      </View>
    );
  }

  if (!review) {
    return (
      <View className="flex-1 bg-cream">
        <SafeAreaView edges={['top']} className="bg-forest">
          <View className="flex-row items-center px-4 py-4">
            <Pressable onPress={handleBack} className="p-2 -ml-2">
              <ArrowLeft size={24} color="#FDF8F3" />
            </Pressable>
            <Text className="text-cream text-xl font-bold ml-2">Review Details</Text>
          </View>
        </SafeAreaView>

        <View className="flex-1 items-center justify-center px-6">
          <MessageSquare size={48} color="#C4B5A4" />
          <Text className="text-charcoal font-bold text-lg mt-4 mb-2">Review Not Found</Text>
          <Text className="text-wood text-center mb-6">
            This review may have been removed or doesn't exist.
          </Text>
          <Pressable onPress={handleBack} className="bg-forest px-6 py-3 rounded-xl">
            <Text className="text-cream font-semibold">Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Get reviewer initials
  const initials = review.userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <View className="flex-1 bg-cream">
      <SafeAreaView edges={['top']} className="bg-forest">
        <View className="flex-row items-center px-4 py-4">
          <Pressable onPress={handleBack} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#FDF8F3" />
          </Pressable>
          <Text className="text-cream text-xl font-bold ml-2">Review Details</Text>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          <View className="px-5 py-6">
            {/* Farmstand Name */}
            {farmstandName && (
              <Pressable
                onPress={() => router.push(`/farm/${review.farmId}`)}
                className="mb-4"
              >
                <Text className="text-wood text-sm">Review for</Text>
                <Text className="text-forest font-semibold text-lg">{farmstandName}</Text>
              </Pressable>
            )}

            {/* Review Card */}
            <View className="bg-white rounded-2xl p-5 border border-sand mb-6">
              {/* Reviewer Info */}
              <View className="flex-row items-center mb-4">
                <View className="w-14 h-14 rounded-full bg-forest items-center justify-center">
                  <Text className="text-cream font-bold text-xl">{initials}</Text>
                </View>
                <View className="ml-4 flex-1">
                  <Text className="text-charcoal font-bold text-lg">
                    {review.userName || 'Anonymous'}
                  </Text>
                  <View className="flex-row items-center mt-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        size={18}
                        color="#D4943A"
                        fill={star <= review.rating ? '#D4943A' : 'transparent'}
                      />
                    ))}
                  </View>
                </View>
              </View>

              {/* Date */}
              <Text className="text-wood text-sm mb-3">{formatDate(review.date)}</Text>

              {/* Review Text */}
              <Text className="text-charcoal text-base leading-6">{review.text}</Text>

              {/* Status Badge */}
              <View className="flex-row mt-4">
                {review.response ? (
                  <View className="bg-mint/20 px-3 py-1.5 rounded-full">
                    <Text className="text-forest text-xs font-medium">Replied</Text>
                  </View>
                ) : (
                  <View className="bg-harvest/20 px-3 py-1.5 rounded-full">
                    <Text className="text-harvest text-xs font-medium">No reply yet</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Owner Response Section */}
            {review.response && !isEditing ? (
              <View className="bg-mint/10 rounded-2xl p-5 border border-mint/30 mb-6">
                <View className="flex-row items-center justify-between mb-3">
                  <View className="flex-row items-center">
                    <MessageSquare size={18} color="#2D5A3D" />
                    <Text className="text-forest font-semibold ml-2">Owner Response</Text>
                  </View>
                  <Text className="text-wood text-xs">
                    {review.response.date ? getRelativeTime(review.response.date) : ''}
                  </Text>
                </View>
                <Text className="text-charcoal">{review.response.text}</Text>

                {/* Edit/Delete buttons - only for owner */}
                {isOwner && (
                  <View className="flex-row mt-4 gap-3">
                    <Pressable
                      onPress={handleStartEdit}
                      className="flex-row items-center bg-white px-4 py-2 rounded-lg border border-sand"
                    >
                      <Pencil size={14} color="#5C4033" />
                      <Text className="text-bark text-sm ml-2">Edit</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleDeleteReply}
                      className="flex-row items-center bg-white px-4 py-2 rounded-lg border border-terracotta/30"
                    >
                      <Trash2 size={14} color="#C45C3E" />
                      <Text className="text-terracotta text-sm ml-2">Delete</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ) : null}

            {/* Edit Reply Form - only for owner */}
            {isOwner && isEditing && (
              <View className="bg-white rounded-2xl p-5 border border-sand mb-6">
                <Text className="text-charcoal font-semibold mb-3">Edit Your Reply</Text>
                <TextInput
                  className="bg-cream rounded-xl px-4 py-3 text-charcoal border border-sand min-h-[100px]"
                  value={editText}
                  onChangeText={setEditText}
                  placeholder="Update your response..."
                  placeholderTextColor="#8B6F4E"
                  multiline
                  textAlignVertical="top"
                />
                <View className="flex-row mt-4 gap-3">
                  <Pressable
                    onPress={() => {
                      setIsEditing(false);
                      setEditText('');
                    }}
                    className="flex-1 py-3 rounded-xl border border-sand items-center"
                  >
                    <Text className="text-bark font-semibold">Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleSaveEdit}
                    disabled={isSending || !editText.trim()}
                    className={`flex-1 py-3 rounded-xl flex-row items-center justify-center ${
                      isSending || !editText.trim() ? 'bg-sand' : 'bg-forest'
                    }`}
                  >
                    {isSending ? (
                      <ActivityIndicator color="#FDF8F3" />
                    ) : (
                      <Text className="text-cream font-semibold">Save Changes</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            )}

            {/* Reply Form - only for owner when no response exists */}
            {isOwner && !review.response && !isEditing && (
              <View className="bg-white rounded-2xl p-5 border border-sand mb-6">
                <Text className="text-charcoal font-semibold mb-3">Write a Reply</Text>
                <TextInput
                  className="bg-cream rounded-xl px-4 py-3 text-charcoal border border-sand min-h-[100px]"
                  value={replyText}
                  onChangeText={setReplyText}
                  placeholder="Thank the customer for their feedback..."
                  placeholderTextColor="#8B6F4E"
                  multiline
                  textAlignVertical="top"
                />
                <Pressable
                  onPress={handleSendReply}
                  disabled={isSending || !replyText.trim()}
                  className={`mt-4 py-3 rounded-xl flex-row items-center justify-center ${
                    isSending || !replyText.trim() ? 'bg-sand' : 'bg-forest'
                  }`}
                >
                  {isSending ? (
                    <ActivityIndicator color="#FDF8F3" />
                  ) : (
                    <>
                      <Send size={18} color="#FDF8F3" />
                      <Text className="text-cream font-semibold ml-2">Post Reply</Text>
                    </>
                  )}
                </Pressable>
              </View>
            )}

            {/* Tips for owners */}
            {isOwner && !review.response && !isEditing && (
              <View className="bg-harvest/10 rounded-2xl p-4 border border-harvest/30">
                <Text className="text-charcoal font-semibold mb-2">Tips for Responding</Text>
                <Text className="text-bark text-sm">
                  • Thank the customer for their feedback{'\n'}
                  • Address any concerns they mentioned{'\n'}
                  • Keep it professional and friendly{'\n'}
                  • Invite them to visit again
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
