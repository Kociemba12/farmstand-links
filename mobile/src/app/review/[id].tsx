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
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Star, Send, MessageSquare, ChevronRight, Pencil, Trash2 } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useReviewsStore, Review } from '@/lib/reviews-store';
import { useAdminStore } from '@/lib/admin-store';
import { useUserStore } from '@/lib/user-store';
import * as Haptics from 'expo-haptics';

const CREAM = '#FDF8F3';
const FOREST = '#2D5A3D';
const BORDER = '#EDE8E0';

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
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ReviewDetailScreen() {
  const router = useRouter();
  const { id: reviewId, farmstandId } = useLocalSearchParams<{
    id: string;
    farmstandId: string;
  }>();

  const loadReviewsForFarm = useReviewsStore((s) => s.loadReviewsForFarm);
  const reviewsByFarm = useReviewsStore((s) => s.reviewsByFarm);
  const addOwnerResponse = useReviewsStore((s) => s.addOwnerResponse);
  const updateOwnerResponse = useReviewsStore((s) => s.updateOwnerResponse);
  const deleteOwnerResponse = useReviewsStore((s) => s.deleteOwnerResponse);
  const adminFarmstands = useAdminStore((s) => s.allFarmstands);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const user = useUserStore((s) => s.user);

  const [review, setReview] = useState<Review | null>(null);
  const [farmstandName, setFarmstandName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');

  const isOwner = React.useMemo(() => {
    if (!user || !farmstandId) return false;
    const farmstand = adminFarmstands.find((f) => f.id === farmstandId);
    return farmstand?.ownerUserId === user.id && farmstand?.claimStatus === 'claimed';
  }, [user, farmstandId, adminFarmstands]);

  useEffect(() => {
    const init = async () => {
      await Promise.all([
        farmstandId ? loadReviewsForFarm(farmstandId) : Promise.resolve(),
        loadAdminData(),
      ]);
      // Resolve review directly from the now-populated store so setReview + setIsLoading(false)
      // collapse into one React render batch — prevents the "Review Not Found" flash.
      if (reviewId) {
        const fresh = useReviewsStore.getState().reviewsByFarm;
        const rows: Review[] = fresh[farmstandId ?? ''] ?? Object.values(fresh).flat();
        const found = rows.find((r: Review) => r.id === reviewId) ?? null;
        setReview(found);
        if (found?.farmId) {
          const fs = adminFarmstands.find((f) => f.id === found.farmId);
          setFarmstandName(fs?.name ?? '');
        }
      }
      setIsLoading(false);
    };
    init();
  }, [loadReviewsForFarm, loadAdminData, farmstandId]);

  // Keep review in sync when the cache is updated (e.g. after posting a reply).
  // Run unconditionally — not gated on isLoading — so review is populated from cache
  // as soon as it's available, avoiding a null flash when loading finishes.
  useEffect(() => {
    if (!reviewId) return;
    const farmReviews: Review[] =
      reviewsByFarm[farmstandId ?? ''] ?? Object.values(reviewsByFarm).flat();
    const found = farmReviews.find((r: Review) => r.id === reviewId);
    console.log('[ReviewDetail] useEffect sync — owner_response before render:', found?.response?.text ?? null);
    // Only update when found — never clear an already-resolved review back to null
    // during an in-progress background refresh.
    if (found) {
      setReview(found);
      const fs = adminFarmstands.find((f) => f.id === found.farmId);
      setFarmstandName(fs?.name ?? '');
    }
  }, [reviewId, reviewsByFarm, farmstandId, adminFarmstands]);

  const handleBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  const handleSendReply = async () => {
    if (!replyText.trim() || !reviewId) return;
    setIsSending(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    console.log('[ReviewDetail] handleSendReply — userId:', user?.id);
    console.log('[ReviewDetail] handleSendReply — reviewId:', reviewId);
    console.log('[ReviewDetail] handleSendReply — farmstandId:', farmstandId);
    console.log('[ReviewDetail] handleSendReply — payload:', JSON.stringify({ review_id: reviewId, owner_response: replyText.trim() }));
    try {
      await addOwnerResponse(reviewId, replyText.trim(), user?.id ?? '');
      setReplyText('');
      console.log('[ReviewDetail] handleSendReply — success, cache updated from DB row');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Reply Sent', 'Your reply has been posted successfully.');
    } catch (error) {
      console.error('[ReviewDetail] Failed to send reply — full error:', JSON.stringify(error));
      console.error('[ReviewDetail] Failed to send reply — message:', error instanceof Error ? error.message : String(error));
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
    console.log('[ReviewDetail] handleSaveEdit — userId:', user?.id);
    console.log('[ReviewDetail] handleSaveEdit — reviewId:', reviewId);
    console.log('[ReviewDetail] handleSaveEdit — payload:', JSON.stringify({ review_id: reviewId, owner_response: editText.trim() }));
    try {
      await updateOwnerResponse(reviewId, editText.trim());
      setIsEditing(false);
      setEditText('');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('[ReviewDetail] Failed to update reply — full error:', JSON.stringify(error));
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
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await deleteOwnerResponse(reviewId);
      const updatedReview = Object.values(useReviewsStore.getState().reviewsByFarm)
        .flat()
        .find((r: Review) => r.id === reviewId);
      setReview(updatedReview ?? null);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Failed to delete reply:', error);
    }
  };

  const headerJSX = (
    <SafeAreaView
      edges={['top']}
      style={{ backgroundColor: CREAM, borderBottomWidth: 1, borderBottomColor: BORDER }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 8,
          paddingVertical: 4,
        }}
      >
        <Pressable onPress={handleBack} hitSlop={12} style={{ padding: 10, borderRadius: 20 }}>
          <ChevronLeft size={24} color="#44403C" />
        </Pressable>
        <Text style={{ fontSize: 16, fontWeight: '600', color: '#44403C' }}>
          Review Details
        </Text>
        <View style={{ width: 44 }} />
      </View>
    </SafeAreaView>
  );

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: CREAM, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={FOREST} />
      </View>
    );
  }

  if (!review) {
    return (
      <View style={{ flex: 1, backgroundColor: CREAM }}>
        {headerJSX}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <MessageSquare size={48} color="#C4B5A4" />
          <Text style={{ color: '#1C1917', fontWeight: '700', fontSize: 18, marginTop: 16, marginBottom: 8 }}>
            Review Not Found
          </Text>
          <Text style={{ color: '#A8906E', textAlign: 'center', marginBottom: 24, fontSize: 14, lineHeight: 20 }}>
            This review may have been removed or doesn't exist.
          </Text>
          <Pressable
            onPress={handleBack}
            style={{ backgroundColor: FOREST, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 }}
          >
            <Text style={{ color: CREAM, fontWeight: '600', fontSize: 14 }}>Go Back</Text>
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
    <View style={{ flex: 1, backgroundColor: CREAM }}>
      {headerJSX}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Farmstand link — inline, tight */}
          {farmstandName && (
            <Pressable
              onPress={() => router.push(`/farm/${review.farmId}`)}
              style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 2 }}
            >
              <Text style={{ fontSize: 13, color: '#A8906E' }}>Review for </Text>
              <Text style={{ fontSize: 13, fontWeight: '600', color: FOREST }}>{farmstandName}</Text>
              <ChevronRight size={12} color={FOREST} strokeWidth={2.5} />
            </Pressable>
          )}

          {/* ── Incoming: Customer review ────────────────────────────────── */}
          <Animated.View entering={FadeInDown.delay(0).duration(280)} style={{ marginBottom: 20 }}>
            {/* Sender row — avatar + name */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginBottom: 8,
                paddingHorizontal: 2,
              }}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: '#EDE8E0',
                  overflow: 'hidden',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 7,
                }}
              >
                {review.userAvatar ? (
                  <Image
                    source={{ uri: review.userAvatar }}
                    style={{ width: 22, height: 22 }}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={{ fontSize: 9, fontWeight: '700', color: '#A8906E' }}>
                    {initials}
                  </Text>
                )}
              </View>
              <Text
                style={{ fontSize: 12, fontWeight: '600', color: '#A8906E', letterSpacing: 0.3 }}
              >
                {(review.userName || 'ANONYMOUS').toUpperCase()}
              </Text>
            </View>

            {/* Card — white incoming */}
            <View
              style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 16,
                padding: 18,
                borderWidth: 1,
                borderColor: BORDER,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.04,
                shadowRadius: 4,
                elevation: 1,
              }}
            >
              {/* Stars + date — small and subtle */}
              <View
                style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}
              >
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star
                    key={s}
                    size={14}
                    color="#D4943A"
                    fill={s <= review.rating ? '#D4943A' : 'transparent'}
                  />
                ))}
                <Text style={{ fontSize: 12, color: '#C0B8AE', marginLeft: 7 }}>
                  {formatDate(review.date)}
                </Text>
              </View>
              <Text style={{ fontSize: 15, color: '#44403C', lineHeight: 24 }}>
                {review.text}
              </Text>
            </View>

            {/* Inline timestamp + status */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: 5,
                paddingHorizontal: 2,
                gap: 5,
              }}
            >
              <Text style={{ fontSize: 11, color: '#C0B8AE', letterSpacing: 0.1 }}>
                {getRelativeTime(review.date)}
              </Text>
              {review.response ? (
                <Text style={{ fontSize: 11, color: '#4A7C59', fontWeight: '600' }}>
                  · Replied
                </Text>
              ) : (
                <Text style={{ fontSize: 11, color: '#B08A50', fontWeight: '500' }}>
                  · No reply yet
                </Text>
              )}
            </View>
          </Animated.View>

          {/* ── Outgoing: Owner response (view mode) ─────────────────────── */}
          {review.response && !isEditing && (
            <Animated.View entering={FadeInDown.delay(60).duration(280)} style={{ marginBottom: 20 }}>
              {/* Sender row — no avatar for own messages */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginBottom: 8,
                  paddingHorizontal: 2,
                }}
              >
                <Text
                  style={{ fontSize: 12, fontWeight: '600', color: '#4A7C59', letterSpacing: 0.3 }}
                >
                  YOU
                </Text>
              </View>

              {/* Card — green outgoing */}
              <View
                style={{
                  backgroundColor: '#F3F9F5',
                  borderRadius: 16,
                  padding: 18,
                  borderWidth: 1,
                  borderColor: '#D0E8D8',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: 0.04,
                  shadowRadius: 4,
                  elevation: 1,
                }}
              >
                <Text style={{ fontSize: 15, color: '#44403C', lineHeight: 24 }}>
                  {review.response.text}
                </Text>
              </View>

              {/* Timestamp */}
              <Text
                style={{
                  fontSize: 11,
                  color: '#C0B8AE',
                  marginTop: 5,
                  paddingHorizontal: 2,
                  letterSpacing: 0.1,
                }}
              >
                {review.response.date ? getRelativeTime(review.response.date) : ''}
              </Text>

              {/* Edit / Delete pill buttons */}
              {isOwner && (
                <View style={{ flexDirection: 'row', marginTop: 10, gap: 8 }}>
                  <Pressable
                    onPress={handleStartEdit}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: '#EDE8E2',
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 99,
                      gap: 5,
                    }}
                  >
                    <Pencil size={13} color="#44403C" />
                    <Text style={{ fontSize: 13, fontWeight: '500', color: '#44403C' }}>
                      Edit
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleDeleteReply}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: '#FDECEA',
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 99,
                      gap: 5,
                    }}
                  >
                    <Trash2 size={13} color="#C45C3E" />
                    <Text style={{ fontSize: 13, fontWeight: '500', color: '#C45C3E' }}>
                      Delete
                    </Text>
                  </Pressable>
                </View>
              )}
            </Animated.View>
          )}

          {/* ── Edit reply form ───────────────────────────────────────────── */}
          {isOwner && isEditing && (
            <Animated.View entering={FadeInDown.delay(60).duration(280)} style={{ marginBottom: 20 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginBottom: 8,
                  paddingHorizontal: 2,
                }}
              >
                <Text
                  style={{ fontSize: 12, fontWeight: '600', color: '#4A7C59', letterSpacing: 0.3 }}
                >
                  YOU
                </Text>
              </View>
              <View
                style={{
                  backgroundColor: '#F3F9F5',
                  borderRadius: 16,
                  padding: 14,
                  borderWidth: 1,
                  borderColor: '#D0E8D8',
                }}
              >
                <TextInput
                  style={{
                    backgroundColor: '#FFFFFF',
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingTop: 11,
                    paddingBottom: 11,
                    fontSize: 15,
                    color: '#1C1917',
                    borderWidth: 1,
                    borderColor: BORDER,
                    minHeight: 80,
                    textAlignVertical: 'top',
                  }}
                  value={editText}
                  onChangeText={setEditText}
                  placeholder="Update your response..."
                  placeholderTextColor="#C0B8AE"
                  multiline
                  textAlignVertical="top"
                />
                <View style={{ flexDirection: 'row', marginTop: 10, gap: 8 }}>
                  <Pressable
                    onPress={() => {
                      setIsEditing(false);
                      setEditText('');
                    }}
                    style={{
                      flex: 1,
                      paddingVertical: 11,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: BORDER,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '600', color: '#78716C' }}>
                      Cancel
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleSaveEdit}
                    disabled={isSending || !editText.trim()}
                    style={{
                      flex: 1,
                      paddingVertical: 11,
                      borderRadius: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: isSending || !editText.trim() ? '#C8DDD0' : FOREST,
                    }}
                  >
                    {isSending ? (
                      <ActivityIndicator color={CREAM} size="small" />
                    ) : (
                      <Text style={{ fontSize: 14, fontWeight: '600', color: CREAM }}>Save</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            </Animated.View>
          )}

          {/* ── Reply compose ─────────────────────────────────────────────── */}
          {isOwner && !review.response && !isEditing && (
            <Animated.View entering={FadeInDown.delay(60).duration(280)} style={{ marginBottom: 16 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginBottom: 8,
                  paddingHorizontal: 2,
                }}
              >
                <Text
                  style={{ fontSize: 12, fontWeight: '600', color: '#4A7C59', letterSpacing: 0.3 }}
                >
                  YOU
                </Text>
              </View>
              <View
                style={{
                  backgroundColor: '#F3F9F5',
                  borderRadius: 16,
                  padding: 14,
                  borderWidth: 1,
                  borderColor: '#D0E8D8',
                }}
              >
                <TextInput
                  style={{
                    backgroundColor: '#FFFFFF',
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingTop: 11,
                    paddingBottom: 11,
                    fontSize: 15,
                    color: '#1C1917',
                    borderWidth: 1,
                    borderColor: BORDER,
                    minHeight: 80,
                    textAlignVertical: 'top',
                  }}
                  value={replyText}
                  onChangeText={setReplyText}
                  placeholder="Thank the customer for their feedback..."
                  placeholderTextColor="#C0B8AE"
                  multiline
                  textAlignVertical="top"
                />
                <Pressable
                  onPress={handleSendReply}
                  disabled={isSending || !replyText.trim()}
                  style={{
                    marginTop: 10,
                    paddingVertical: 13,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'row',
                    gap: 7,
                    backgroundColor: isSending || !replyText.trim() ? '#C8DDD0' : FOREST,
                  }}
                >
                  {isSending ? (
                    <ActivityIndicator color={CREAM} size="small" />
                  ) : (
                    <>
                      <Send size={15} color={CREAM} />
                      <Text style={{ fontSize: 14, fontWeight: '600', color: CREAM }}>
                        Post Reply
                      </Text>
                    </>
                  )}
                </Pressable>
              </View>
            </Animated.View>
          )}

          {/* Tips — minimal, muted */}
          {isOwner && !review.response && !isEditing && (
            <Text
              style={{
                fontSize: 12,
                color: '#C0B8AE',
                lineHeight: 18,
                paddingHorizontal: 2,
                marginTop: 4,
              }}
            >
              Tip: Thank the customer, address any concerns, and invite them back.
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
