import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  Image,
  TextInput,
  Modal,
  Alert,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, Star, X, ChevronRight, CheckCircle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useReviewsStore, Review } from '@/lib/reviews-store';
import { useUserStore } from '@/lib/user-store';
import { useAdminStore } from '@/lib/admin-store';
import { logReviewCreate } from '@/lib/analytics-events';
import { SignInPromptModal } from '@/components/SignInPromptModal';

export default function FarmstandReviewsScreen() {
  const { farmstandId } = useLocalSearchParams<{ farmstandId: string }>();
  const router = useRouter();

  // Stores — select reviewsByFarm slice directly so component re-renders on change
  const loadReviewsForFarm = useReviewsStore((s) => s.loadReviewsForFarm);
  const addReview = useReviewsStore((s) => s.addReview);
  const reviews = useReviewsStore((s) => s.reviewsByFarm[farmstandId ?? ''] ?? []);

  const user = useUserStore((s) => s.user);
  const isGuest = useUserStore((s) => s.isGuest);

  const adminFarmstands = useAdminStore((s) => s.allFarmstands);

  // Review modal state
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Existing review by the current user (if any)
  const existingReview = useMemo(
    () => reviews.find((r) => r.userId === user?.id) ?? null,
    [reviews, user?.id]
  );

  // Success toast state
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;

  // Guest prompt modal state
  const [showGuestPrompt, setShowGuestPrompt] = useState(false);

  // Refresh function — re-fetches from Supabase
  const refreshReviews = useCallback(() => {
    if (farmstandId) {
      loadReviewsForFarm(farmstandId);
    }
  }, [farmstandId, loadReviewsForFarm]);

  // Load on mount
  useEffect(() => {
    refreshReviews();
  }, [refreshReviews]);

  // Re-fetch whenever the screen comes into focus (e.g. returning from review detail)
  useFocusEffect(
    useCallback(() => {
      refreshReviews();
    }, [refreshReviews])
  );

  // Get farmstand data
  const farmstand = useMemo(() => {
    return adminFarmstands.find((f) => f.id === farmstandId);
  }, [adminFarmstands, farmstandId]);

  // Calculate average rating — derived from the reactive `reviews` selector above
  const ratingStats = useMemo(() => {
    if (reviews.length === 0) {
      return { avgRating: 0, reviewCount: 0 };
    }
    const total = reviews.reduce((sum, r) => sum + r.rating, 0);
    return {
      avgRating: Math.round((total / reviews.length) * 10) / 10,
      reviewCount: reviews.length,
    };
  }, [reviews]);

  const handleWriteReview = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (isGuest()) {
      setShowGuestPrompt(true);
      return;
    }

    // Pre-fill with existing review data if editing
    if (existingReview) {
      setReviewRating(existingReview.rating);
      setReviewText(existingReview.text);
    } else {
      setReviewRating(5);
      setReviewText('');
    }

    setShowReviewModal(true);
  };

  const showToast = useCallback(() => {
    setShowSuccessToast(true);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(2000),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setShowSuccessToast(false));
  }, [toastOpacity]);

  const handleSubmitReview = async () => {
    if (!farmstandId || !reviewText.trim() || !user) return;

    setIsSubmitting(true);

    // addReview inserts to Supabase then refreshes cache — returns { success, error? }
    const result = await addReview(
      farmstandId,
      user.id ?? '',
      user.name,
      reviewRating,
      reviewText.trim()
    );

    setIsSubmitting(false);

    if (!result.success) {
      Alert.alert(
        'Unable to Submit Review',
        result.error ?? 'There was a problem saving your review. Please check your connection and try again.'
      );
      return;
    }

    // Save to unified database
    const submitReportOrReview = useAdminStore.getState().submitReportOrReview;

    await submitReportOrReview({
      submissionType: 'review',
      reportedItemType: 'farmstand',
      reportedItemId: farmstandId,
      reportedItemName: farmstand?.name || 'Unknown Farmstand',
      rating: reviewRating,
      reason: 'Customer Review',
      comments: reviewText.trim(),
      submittedByUserId: user.id ?? null,
      submittedByUserEmail: user.email,
      sourceScreen: 'farmstand-reviews',
    });

    // Log review created event
    logReviewCreate(farmstandId, reviewRating, user.id ?? null);

    // Only fire haptics and show toast after confirmed Supabase write
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowReviewModal(false);
    setReviewText('');
    setReviewRating(5);
    showToast();
  };

  const handleReviewPress = (reviewId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/review/${reviewId}?farmstandId=${farmstandId}`);
  };

  const renderReviewItem = useCallback(
    ({ item: review }: { item: Review }) => (
      <Pressable
        style={styles.reviewCard}
        onPress={() => handleReviewPress(review.id)}
      >
        <View style={styles.reviewHeader}>
          {review.userAvatar ? (
            <Image source={{ uri: review.userAvatar }} style={styles.reviewAvatar} />
          ) : (
            <View style={[styles.reviewAvatar, styles.reviewAvatarFallback]}>
              <Text style={styles.reviewAvatarInitial}>
                {review.userName?.charAt(0)?.toUpperCase() ?? '?'}
              </Text>
            </View>
          )}
          <View style={styles.reviewerInfo}>
            <Text style={styles.reviewerName}>{review.userName}</Text>
            <Text style={styles.reviewDate}>{review.date}</Text>
          </View>
          <View style={styles.reviewStars}>
            {[...Array(5)].map((_, i) => (
              <Star
                key={i}
                size={12}
                color="#D4943A"
                fill={i < review.rating ? '#D4943A' : 'transparent'}
              />
            ))}
          </View>
          <ChevronRight size={16} color="#C4B5A4" style={{ marginLeft: 8 }} />
        </View>
        <Text style={styles.reviewText} numberOfLines={4}>
          {review.text}
        </Text>

        {review.response && (
          <View style={styles.ownerResponse}>
            <Text style={styles.ownerResponseLabel}>Response from owner</Text>
            <Text style={styles.ownerResponseText} numberOfLines={2}>
              {review.response.text}
            </Text>
          </View>
        )}
      </Pressable>
    ),
    [farmstandId, router]
  );

  const ListHeaderComponent = useMemo(
    () => (
      <View style={styles.headerContent}>
        {/* Rating Summary */}
        <View style={styles.ratingSummary}>
          <View style={styles.ratingBox}>
            <Text style={styles.ratingNumber}>{ratingStats.avgRating.toFixed(1)}</Text>
            <View style={styles.ratingStarsRow}>
              {[...Array(5)].map((_, i) => (
                <Star
                  key={i}
                  size={16}
                  color="#D4943A"
                  fill={i < Math.round(ratingStats.avgRating) ? '#D4943A' : 'transparent'}
                />
              ))}
            </View>
            <Text style={styles.reviewCountText}>
              {ratingStats.reviewCount} review{ratingStats.reviewCount !== 1 ? 's' : ''}
            </Text>
          </View>
        </View>
      </View>
    ),
    [ratingStats]
  );

  const ListEmptyComponent = useMemo(
    () => (
      <View style={styles.emptyState}>
        <Star size={48} color="#E8DDD4" />
        <Text style={styles.emptyTitle}>No reviews yet</Text>
        <Text style={styles.emptySubtitle}>
          Be the first to share your experience at this farmstand.
        </Text>
      </View>
    ),
    []
  );

  if (!farmstandId) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Farmstand not found</Text>
        <Pressable onPress={() => router.back()} style={styles.errorButton}>
          <Text style={styles.errorButtonText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft size={24} color="#FDF8F3" />
          </Pressable>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle}>Reviews</Text>
            {farmstand && (
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {farmstand.name}
              </Text>
            )}
          </View>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>

      {/* Reviews List */}
      <FlatList
        data={reviews}
        keyExtractor={(item) => item.id}
        renderItem={renderReviewItem}
        ListHeaderComponent={ListHeaderComponent}
        ListEmptyComponent={ListEmptyComponent}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {/* Fixed Write Review Button */}
      <SafeAreaView edges={['bottom']} style={styles.footerSafeArea}>
        <View style={styles.footer}>
          <Pressable onPress={handleWriteReview} style={styles.writeReviewButton}>
            <Text style={styles.writeReviewText}>
              {existingReview ? 'Edit Your Review' : 'Write a Review'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Review Modal */}
      <Modal
        visible={showReviewModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowReviewModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#FAFAF8' }}>
          {/* Header with top safe area */}
          <SafeAreaView edges={['top']} style={{ backgroundColor: '#FAFAF8' }}>
            <View style={styles.modalHeader}>
              <Pressable onPress={() => setShowReviewModal(false)}>
                <X size={24} color="#3D3D3D" />
              </Pressable>
              <Text style={styles.modalTitle}>
                {existingReview ? 'Edit Your Review' : 'Write a Review'}
              </Text>
              <View style={{ width: 24 }} />
            </View>
          </SafeAreaView>

          {/* Scrollable content — auto-scrolls to keep focused input visible */}
          <KeyboardAwareScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bottomOffset={80}
          >
            <Text style={styles.modalFarmName}>{farmstand?.name}</Text>

            <Text style={styles.modalLabel}>Your Rating</Text>
            <View style={styles.ratingSelection}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Pressable
                  key={star}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setReviewRating(star);
                  }}
                  style={styles.ratingStar}
                >
                  <Star
                    size={36}
                    color="#D4943A"
                    fill={star <= reviewRating ? '#D4943A' : 'transparent'}
                  />
                </Pressable>
              ))}
            </View>

            <Text style={styles.modalLabel}>Your Review</Text>
            <TextInput
              style={styles.reviewInput}
              placeholder="Share your experience at this farmstand..."
              placeholderTextColor="#8B6F4E"
              multiline
              textAlignVertical="top"
              value={reviewText}
              onChangeText={setReviewText}
            />
            <Text style={styles.reviewHint}>
              Your review will be visible to others and the farmstand owner can respond.
            </Text>
          </KeyboardAwareScrollView>

          {/* Submit button sticks above the keyboard */}
          <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
            <SafeAreaView edges={['bottom']} style={{ backgroundColor: '#FAFAF8', borderTopWidth: 1, borderTopColor: '#F0EDE8' }}>
              <View style={styles.modalFooter}>
                <Pressable
                  onPress={handleSubmitReview}
                  disabled={!reviewText.trim() || isSubmitting}
                  style={[
                    styles.submitButton,
                    (!reviewText.trim() || isSubmitting) && styles.submitButtonDisabled,
                  ]}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="#FDF8F3" />
                  ) : (
                    <Text
                      style={[
                        styles.submitButtonText,
                        (!reviewText.trim() || isSubmitting) && styles.submitButtonTextDisabled,
                      ]}
                    >
                      {existingReview ? 'Update Review' : 'Submit Review'}
                    </Text>
                  )}
                </Pressable>
              </View>
            </SafeAreaView>
          </KeyboardStickyView>
        </View>
      </Modal>

      {/* Guest Sign In Prompt Modal */}
      <SignInPromptModal
        visible={showGuestPrompt}
        onClose={() => setShowGuestPrompt(false)}
        action="review"
      />

      {/* Success Toast */}
      {showSuccessToast && (
        <Animated.View
          style={[styles.toast, { opacity: toastOpacity }]}
          pointerEvents="none"
        >
          <CheckCircle size={18} color="#FDF8F3" />
          <Text style={styles.toastText}>Review submitted</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAF8',
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#FAFAF8',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  errorText: {
    color: '#3D3D3D',
    fontSize: 18,
    textAlign: 'center',
  },
  errorButton: {
    marginTop: 16,
    backgroundColor: '#2D5A3D',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  errorButtonText: {
    color: '#FDF8F3',
    fontWeight: '600',
  },

  // Header
  headerSafeArea: {
    backgroundColor: '#2D5A3D',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  backButton: {
    padding: 4,
  },
  headerTitleContainer: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FDF8F3',
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(253, 248, 243, 0.75)',
    marginTop: 2,
  },

  // List
  listContent: {
    paddingBottom: 20,
  },
  headerContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
  },

  // Rating Summary
  ratingSummary: {
    alignItems: 'center',
    marginBottom: 8,
  },
  ratingBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: 'rgba(0, 0, 0, 1)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    width: '100%',
  },
  ratingNumber: {
    fontSize: 48,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 8,
  },
  ratingStarsRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 8,
  },
  reviewCountText: {
    fontSize: 14,
    color: '#6B6B6B',
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#3D3D3D',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#8B6F4E',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },

  // Review Card
  reviewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    marginHorizontal: 20,
    marginBottom: 12,
    shadowColor: 'rgba(0, 0, 0, 1)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  reviewAvatarFallback: {
    backgroundColor: '#E8DDD4',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  reviewAvatarInitial: {
    color: '#5C4033',
    fontWeight: '700' as const,
    fontSize: 18,
  },
  reviewAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  reviewerInfo: {
    flex: 1,
    marginLeft: 12,
  },
  reviewerName: {
    color: '#1A1A1A',
    fontWeight: '600',
    fontSize: 15,
  },
  reviewDate: {
    color: '#8B6F4E',
    fontSize: 12,
    marginTop: 2,
  },
  reviewStars: {
    flexDirection: 'row',
    gap: 2,
  },
  reviewText: {
    color: '#4A4A4A',
    fontSize: 14,
    lineHeight: 22,
  },
  ownerResponse: {
    marginTop: 14,
    padding: 14,
    backgroundColor: '#F0F7F2',
    borderRadius: 12,
  },
  ownerResponseLabel: {
    color: '#2D5A3D',
    fontWeight: '600',
    fontSize: 13,
    marginBottom: 6,
  },
  ownerResponseText: {
    color: '#4A4A4A',
    fontSize: 14,
    lineHeight: 20,
  },

  // Footer
  footerSafeArea: {
    backgroundColor: '#FAFAF8',
    borderTopWidth: 1,
    borderTopColor: '#F0EDE8',
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  writeReviewButton: {
    backgroundColor: '#C45C3E',
    paddingVertical: 16,
    borderRadius: 14,
    shadowColor: '#C45C3E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  writeReviewText: {
    color: '#FDF8F3',
    fontWeight: '600',
    fontSize: 16,
    textAlign: 'center',
  },

  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: '#FAFAF8',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EDE8',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  modalContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
  },
  modalFarmName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 28,
  },
  modalLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 12,
  },
  ratingSelection: {
    flexDirection: 'row',
    marginBottom: 28,
  },
  ratingStar: {
    marginRight: 8,
  },
  reviewInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E4DF',
    borderRadius: 14,
    padding: 16,
    color: '#1A1A1A',
    fontSize: 15,
    minHeight: 150,
  },
  reviewHint: {
    color: '#8B6F4E',
    fontSize: 13,
    marginTop: 10,
  },
  modalFooter: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  submitButton: {
    backgroundColor: '#2D5A3D',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#E8E4DF',
  },
  submitButtonText: {
    color: '#FDF8F3',
    fontWeight: '600',
    fontSize: 16,
  },
  submitButtonTextDisabled: {
    color: '#8B6F4E',
  },
  toast: {
    position: 'absolute',
    bottom: 110,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#2D5A3D',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  toastText: {
    color: '#FDF8F3',
    fontWeight: '600',
    fontSize: 14,
  },
});
