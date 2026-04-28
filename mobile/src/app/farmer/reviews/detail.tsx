import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Star, MessageSquare, Send, Pencil, Trash2 } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useReviewsStore, Review } from '@/lib/reviews-store';
import { useUserStore } from '@/lib/user-store';
import * as Haptics from 'expo-haptics';

function getRelativeTime(dateString: string): string {
  if (!dateString || dateString === 'Just now') return dateString || '';
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
  if (!dateString) return '';
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
  const { farmstandId, reviewId } = useLocalSearchParams<{
    farmstandId: string;
    reviewId: string;
  }>();

  const loadReviewsForFarm = useReviewsStore((s) => s.loadReviewsForFarm);
  const reviewsByFarm = useReviewsStore((s) => s.reviewsByFarm);
  const addOwnerResponse = useReviewsStore((s) => s.addOwnerResponse);
  const updateOwnerResponse = useReviewsStore((s) => s.updateOwnerResponse);
  const deleteOwnerResponse = useReviewsStore((s) => s.deleteOwnerResponse);
  const user = useUserStore((s) => s.user);

  const [review, setReview] = useState<Review | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');

  // Load reviews from Supabase on mount
  useEffect(() => {
    const init = async () => {
      if (farmstandId) {
        await loadReviewsForFarm(farmstandId);
      }
      setIsLoading(false);
    };
    init();
  }, [farmstandId, loadReviewsForFarm]);

  // Sync review state whenever reviewsByFarm cache updates
  useEffect(() => {
    if (!reviewId) return;
    const farmReviews = reviewsByFarm[farmstandId ?? ''] ?? [];
    const found = farmReviews.find((r) => r.id === reviewId);
    console.log('[ReviewDetail:farmer] useEffect sync — owner_response before render:', found?.response?.text ?? null);
    setReview(found ?? null);
  }, [reviewsByFarm, reviewId, farmstandId]);

  const handleBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  const handleSendReply = async () => {
    if (!replyText.trim()) {
      Alert.alert('Empty Reply', 'Please write a reply before sending.');
      return;
    }
    if (!reviewId) return;

    setIsSending(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    console.log('[ReviewDetail:farmer] handleSendReply — userId:', user?.id);
    console.log('[ReviewDetail:farmer] handleSendReply — reviewId:', reviewId);
    console.log('[ReviewDetail:farmer] handleSendReply — farmstandId:', farmstandId);
    console.log('[ReviewDetail:farmer] handleSendReply — payload:', JSON.stringify({ review_id: reviewId, owner_response: replyText.trim() }));

    try {
      await addOwnerResponse(reviewId, replyText.trim(), user?.id ?? '');
      setReplyText('');
      console.log('[ReviewDetail:farmer] handleSendReply — success, cache synced from DB row');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Reply Sent', 'Your reply has been posted successfully.');
    } catch (error) {
      console.error('[ReviewDetail:farmer] handleSendReply — full error:', JSON.stringify(error));
      console.error('[ReviewDetail:farmer] handleSendReply — message:', error instanceof Error ? error.message : String(error));
      const msg = error instanceof Error ? error.message : String(error);
      const isPermission = msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('own') || msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('forbidden');
      if (isPermission) {
        Alert.alert('Permission Denied', "You don't have permission to reply to this review.");
      } else {
        Alert.alert('Failed to Send Reply', 'Reply failed to save. Please try again.');
      }
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
    console.log('[ReviewDetail:farmer] handleSaveEdit — userId:', user?.id);
    console.log('[ReviewDetail:farmer] handleSaveEdit — reviewId:', reviewId);
    console.log('[ReviewDetail:farmer] handleSaveEdit — payload:', JSON.stringify({ review_id: reviewId, owner_response: editText.trim() }));
    try {
      await updateOwnerResponse(reviewId, editText.trim());
      setIsEditing(false);
      setEditText('');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('[ReviewDetail:farmer] handleSaveEdit — full error:', JSON.stringify(error));
      const msg = error instanceof Error ? error.message : String(error);
      const isPermission = msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('own') || msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('forbidden');
      if (isPermission) {
        Alert.alert('Permission Denied', "You don't have permission to reply to this review.");
      } else {
        Alert.alert('Failed to Update Reply', 'Reply failed to save. Please try again.');
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteReply = async () => {
    if (!reviewId) return;
    Alert.alert(
      'Delete Reply',
      'Are you sure you want to delete your reply?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            try {
              await deleteOwnerResponse(reviewId);
              if (farmstandId) await loadReviewsForFarm(farmstandId);
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (error) {
              Alert.alert('Error', 'Failed to delete reply. Please try again.');
            }
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
          <Text className="text-charcoal font-bold text-lg mb-2 mt-4">Review Not Found</Text>
          <Text className="text-wood text-center mb-4">
            This review may have been removed.
          </Text>
          <Pressable onPress={handleBack} className="bg-forest px-6 py-3 rounded-xl">
            <Text className="text-cream font-semibold">Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const initials = review.userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <View className="flex-1 bg-cream">
      <SafeAreaView edges={['top']} className="bg-forest">
        <View className="flex-row items-center justify-between px-4 py-4">
          <Pressable onPress={handleBack} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#FDF8F3" />
          </Pressable>
          <Text className="text-cream text-xl font-bold">Review Details</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          <View className="px-5 py-6">

            {/* Review Card */}
            <View className="bg-white rounded-2xl p-5 border border-sand mb-6">
              <View className="flex-row items-center mb-4">
                <View className="w-14 h-14 rounded-full bg-forest items-center justify-center">
                  <Text className="text-cream font-bold text-xl">{initials}</Text>
                </View>
                <View className="ml-4 flex-1">
                  <Text className="text-charcoal font-bold text-lg">{review.userName}</Text>
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
              <Text className="text-charcoal text-base leading-6">{review.text}</Text>
            </View>

            {/* Owner Response — view mode */}
            {review.response && !isEditing && (
              <View className="bg-mint/10 rounded-2xl p-5 border border-mint/30 mb-6">
                <View className="flex-row items-center mb-3">
                  <MessageSquare size={18} color="#2D5A3D" />
                  <Text className="text-forest font-semibold ml-2">Your Reply</Text>
                  <Text className="text-wood text-xs ml-auto">
                    {review.response.date ? getRelativeTime(review.response.date) : ''}
                  </Text>
                </View>
                <Text className="text-charcoal">{review.response.text}</Text>

                {/* Edit / Delete */}
                <View className="flex-row mt-4 gap-2">
                  <Pressable
                    onPress={handleStartEdit}
                    className="flex-row items-center bg-sand px-4 py-2 rounded-full"
                    style={{ gap: 5 }}
                  >
                    <Pencil size={13} color="#44403C" />
                    <Text style={{ fontSize: 13, fontWeight: '500', color: '#44403C' }}>Edit</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleDeleteReply}
                    className="flex-row items-center px-4 py-2 rounded-full"
                    style={{ gap: 5, backgroundColor: '#FDECEA' }}
                  >
                    <Trash2 size={13} color="#C45C3E" />
                    <Text style={{ fontSize: 13, fontWeight: '500', color: '#C45C3E' }}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* Edit reply form */}
            {isEditing && (
              <View className="bg-mint/10 rounded-2xl p-4 border border-mint/30 mb-6">
                <Text className="text-forest font-semibold mb-3">Edit Your Reply</Text>
                <TextInput
                  className="bg-cream rounded-xl px-4 py-3 text-charcoal border border-sand min-h-[100px]"
                  value={editText}
                  onChangeText={setEditText}
                  placeholder="Update your reply..."
                  placeholderTextColor="#8B6F4E"
                  multiline
                  textAlignVertical="top"
                />
                <View className="flex-row mt-3 gap-2">
                  <Pressable
                    onPress={() => { setIsEditing(false); setEditText(''); }}
                    className="flex-1 py-3 rounded-xl border border-sand items-center"
                  >
                    <Text className="text-wood font-semibold">Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleSaveEdit}
                    disabled={isSending || !editText.trim()}
                    className={`flex-1 py-3 rounded-xl items-center justify-center ${isSending || !editText.trim() ? 'bg-sand' : 'bg-forest'}`}
                  >
                    {isSending ? (
                      <ActivityIndicator color="#FDF8F3" size="small" />
                    ) : (
                      <Text className="text-cream font-semibold">Save</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            )}

            {/* Write a Reply (only if no response yet) */}
            {!review.response && !isEditing && (
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
                  style={{ gap: 7 }}
                >
                  {isSending ? (
                    <ActivityIndicator color="#FDF8F3" />
                  ) : (
                    <>
                      <Send size={18} color="#FDF8F3" />
                      <Text className="text-cream font-semibold">Send Reply</Text>
                    </>
                  )}
                </Pressable>
              </View>
            )}

            {/* Tips */}
            {!review.response && !isEditing && (
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
      </KeyboardAvoidingView>
    </View>
  );
}
