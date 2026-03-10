import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Star, Flag, MessageSquare, Send } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFarmerStore, FarmerReview } from '@/lib/farmer-store';
import * as Haptics from 'expo-haptics';

function getRelativeTime(dateString: string): string {
  const now = Date.now();
  const date = new Date(dateString).getTime();
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
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function ReviewDetailScreen() {
  const router = useRouter();
  const { farmstandId, reviewId } = useLocalSearchParams<{
    farmstandId: string;
    reviewId: string;
  }>();

  const getReviewsByFarmstand = useFarmerStore((s) => s.getReviewsByFarmstand);
  const replyToReview = useFarmerStore((s) => s.replyToReview);
  const flagReview = useFarmerStore((s) => s.flagReview);

  const [review, setReview] = useState<FarmerReview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (farmstandId && reviewId) {
      const reviews = getReviewsByFarmstand(farmstandId);
      const found = reviews.find((r) => r.id === reviewId);
      setReview(found || null);
      setIsLoading(false);
    }
  }, [farmstandId, reviewId, getReviewsByFarmstand]);

  const handleBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  const handleSendReply = async () => {
    if (!replyText.trim()) {
      Alert.alert('Empty Reply', 'Please write a reply before sending.');
      return;
    }

    setIsSending(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await replyToReview(reviewId!, replyText.trim());

      // Refresh the review
      const reviews = getReviewsByFarmstand(farmstandId!);
      const updated = reviews.find((r) => r.id === reviewId);
      setReview(updated || null);
      setReplyText('');

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Reply Sent', 'Your reply has been posted.');
    } catch (error) {
      Alert.alert('Error', 'Failed to send reply. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  const handleFlag = async () => {
    Alert.alert(
      'Flag Review',
      'Are you sure you want to flag this review as inappropriate? Flagged reviews are hidden from your public listing.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Flag',
          style: 'destructive',
          onPress: async () => {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            await flagReview(reviewId!);

            // Refresh the review
            const reviews = getReviewsByFarmstand(farmstandId!);
            const updated = reviews.find((r) => r.id === reviewId);
            setReview(updated || null);

            Alert.alert('Review Flagged', 'This review has been flagged and hidden.');
          },
        },
      ]
    );
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
      <View className="flex-1 bg-cream items-center justify-center px-6">
        <Text className="text-charcoal font-bold text-lg mb-2">Review Not Found</Text>
        <Text className="text-wood text-center mb-4">
          This review may have been removed.
        </Text>
        <Pressable onPress={handleBack} className="bg-forest px-6 py-3 rounded-xl">
          <Text className="text-cream font-semibold">Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-cream">
      <SafeAreaView edges={['top']} className="bg-forest">
        <View className="flex-row items-center justify-between px-4 py-4">
          <Pressable onPress={handleBack} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#FDF8F3" />
          </Pressable>
          <Text className="text-cream text-xl font-bold">Review Details</Text>
          {!review.flagged && (
            <Pressable onPress={handleFlag} className="p-2 -mr-2">
              <Flag size={24} color="#FDF8F3" />
            </Pressable>
          )}
          {review.flagged && <View className="w-10" />}
        </View>
      </SafeAreaView>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="px-5 py-6">
          {/* Flagged warning */}
          {review.flagged && (
            <View className="bg-terracotta/10 rounded-2xl p-4 border border-terracotta/30 mb-6">
              <View className="flex-row items-center">
                <Flag size={20} color="#C4653A" />
                <Text className="text-terracotta font-semibold ml-2">
                  This review has been flagged
                </Text>
              </View>
              <Text className="text-bark text-sm mt-2">
                Flagged reviews are hidden from your public listing.
              </Text>
            </View>
          )}

          {/* Review Card */}
          <View className="bg-white rounded-2xl p-5 border border-sand mb-6">
            <View className="flex-row items-center mb-4">
              <View className="w-14 h-14 rounded-full bg-forest items-center justify-center">
                <Text className="text-cream font-bold text-xl">{review.reviewerInitials}</Text>
              </View>
              <View className="ml-4 flex-1">
                <Text className="text-charcoal font-bold text-lg">{review.reviewerName}</Text>
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

            <Text className="text-wood text-sm mb-3">{formatDate(review.createdAt)}</Text>

            <Text className="text-charcoal text-base leading-6">{review.comment}</Text>
          </View>

          {/* Reply Section */}
          {review.replyText ? (
            <View className="bg-mint/10 rounded-2xl p-5 border border-mint/30 mb-6">
              <View className="flex-row items-center mb-3">
                <MessageSquare size={18} color="#2D5A3D" />
                <Text className="text-forest font-semibold ml-2">Your Reply</Text>
                <Text className="text-wood text-xs ml-auto">
                  {review.repliedAt ? getRelativeTime(review.repliedAt) : ''}
                </Text>
              </View>
              <Text className="text-charcoal">{review.replyText}</Text>
            </View>
          ) : (
            !review.flagged && (
              <View className="bg-white rounded-2xl p-5 border border-sand">
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
                  disabled={isSending}
                  className={`mt-4 py-3 rounded-xl flex-row items-center justify-center ${
                    isSending ? 'bg-sand' : 'bg-forest'
                  }`}
                >
                  {isSending ? (
                    <ActivityIndicator color="#FDF8F3" />
                  ) : (
                    <>
                      <Send size={18} color="#FDF8F3" />
                      <Text className="text-cream font-semibold ml-2">Send Reply</Text>
                    </>
                  )}
                </Pressable>
              </View>
            )
          )}

          {/* Tips */}
          {!review.replyText && !review.flagged && (
            <View className="bg-harvest/10 rounded-2xl p-4 border border-harvest/30 mt-6">
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
    </View>
  );
}
