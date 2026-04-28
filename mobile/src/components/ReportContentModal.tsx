import React, { useState } from 'react';
import { View, Text, Pressable, Modal, TextInput, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, Flag, AlertTriangle, Ban, HelpCircle, MessageSquareOff } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useAdminStore, ReportType } from '@/lib/admin-store';
import { useUserStore } from '@/lib/user-store';
import { logReportCreate } from '@/lib/analytics-events';

interface ReportContentModalProps {
  visible: boolean;
  onClose: () => void;
  contentType: 'review' | 'farmstand';
  contentId: string;
  contentPreview: string;
  farmstandId: string;
  farmstandName: string;
}

const REPORT_REASONS: { type: ReportType; label: string; icon: React.ReactNode; description: string }[] = [
  {
    type: 'inappropriate',
    label: 'Inappropriate Content',
    icon: <Ban size={20} color="#DC2626" />,
    description: 'Content that is not suitable for this platform',
  },
  {
    type: 'spam',
    label: 'Spam',
    icon: <MessageSquareOff size={20} color="#F59E0B" />,
    description: 'Promotional content, fake reviews, or repetitive posts',
  },
  {
    type: 'inaccurate',
    label: 'Inaccurate Information',
    icon: <AlertTriangle size={20} color="#3B82F6" />,
    description: 'False or misleading information about the farmstand',
  },
  {
    type: 'offensive',
    label: 'Offensive Language',
    icon: <Flag size={20} color="#7C3AED" />,
    description: 'Hate speech, harassment, or abusive language',
  },
  {
    type: 'other',
    label: 'Other',
    icon: <HelpCircle size={20} color="#6B7280" />,
    description: 'Another issue not listed above',
  },
];

export function ReportContentModal({
  visible,
  onClose,
  contentType,
  contentId,
  contentPreview,
  farmstandId,
  farmstandName,
}: ReportContentModalProps) {
  const [selectedReason, setSelectedReason] = useState<ReportType | null>(null);
  const [details, setDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitReport = useAdminStore((s) => s.submitReport);
  const user = useUserStore((s) => s.user);

  const handleClose = () => {
    setSelectedReason(null);
    setDetails('');
    setSubmitted(false);
    setError(null);
    onClose();
  };

  const handleSubmit = async () => {
    if (!selectedReason || !user) return;

    setIsSubmitting(true);
    setError(null);

    try {
      // Submit to LEGACY system (for backward compatibility)
      const legacyResult = await submitReport({
        type: contentType,
        contentId,
        contentPreview: contentPreview.slice(0, 200),
        farmstandId,
        farmstandName,
        reason: selectedReason,
        details: details.trim() || null,
        reportedBy: user.id ?? null,
        reportedByName: user.name,
      });

      // Submit to NEW unified database (REQUIRED)
      const submitReportOrReview = useAdminStore.getState().submitReportOrReview;
      const newResult = await submitReportOrReview({
        submissionType: 'report',
        reportedItemType: contentType === 'review' ? 'farmstand' : 'farmstand',
        reportedItemId: contentType === 'review' ? contentId : farmstandId,
        reportedItemName: farmstandName,
        rating: null,
        reason: selectedReason,
        comments: details.trim() || `Reported for: ${selectedReason}`,
        submittedByUserId: user.id ?? null,
        submittedByUserEmail: user.email,
        sourceScreen: contentType === 'review' ? 'review-report' : 'farmstand-report',
      });

      if (newResult.success && legacyResult.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // Log report creation to analytics
        logReportCreate(contentType, contentId, selectedReason, user.id);
        setSubmitted(true);
      } else {
        setError(newResult.error || legacyResult.error || 'Failed to submit report');
      }
    } catch (err) {
      console.error('Error submitting report:', err);
      setError('An error occurred while submitting the report');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView edges={['top']} className="flex-1 bg-white">
        {/* Header */}
        <View className="flex-row items-center justify-between px-5 py-4 border-b border-gray-100">
          <Pressable onPress={handleClose} className="p-2 -ml-2">
            <X size={24} color="#111827" />
          </Pressable>
          <Text className="text-lg font-semibold text-gray-900">
            Report {contentType === 'review' ? 'Review' : 'Farmstand'}
          </Text>
          <View className="w-10" />
        </View>

        {submitted ? (
          // Success State
          <View className="flex-1 items-center justify-center p-8">
            <View className="w-20 h-20 bg-green-100 rounded-full items-center justify-center mb-4">
              <Flag size={40} color="#16a34a" />
            </View>
            <Text className="text-xl font-semibold text-gray-900 text-center mb-2">
              Report Submitted
            </Text>
            <Text className="text-base text-gray-500 text-center mb-8">
              Thank you for helping keep our community safe. Our team will review this report shortly.
            </Text>
            <Pressable
              onPress={handleClose}
              className="bg-green-600 px-8 py-4 rounded-xl"
            >
              <Text className="text-white font-semibold text-base">Done</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
              {/* Content Preview */}
              <View className="px-5 py-4">
                <Text className="text-sm font-medium text-gray-500 mb-2 uppercase">
                  Content being reported
                </Text>
                <View className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <Text className="text-base text-gray-800" numberOfLines={3}>
                    "{contentPreview}"
                  </Text>
                </View>
              </View>

              {/* Reason Selection */}
              <View className="px-5 pb-4">
                <Text className="text-sm font-medium text-gray-500 mb-3 uppercase">
                  Why are you reporting this?
                </Text>
                {REPORT_REASONS.map((reason) => (
                  <Pressable
                    key={reason.type}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSelectedReason(reason.type);
                    }}
                    className={`flex-row items-center p-4 mb-2 rounded-xl border ${
                      selectedReason === reason.type
                        ? 'border-green-600 bg-green-50'
                        : 'border-gray-100 bg-white'
                    }`}
                  >
                    <View className="w-10 h-10 rounded-xl bg-gray-50 items-center justify-center mr-3">
                      {reason.icon}
                    </View>
                    <View className="flex-1">
                      <Text
                        className={`text-base font-semibold ${
                          selectedReason === reason.type ? 'text-green-700' : 'text-gray-900'
                        }`}
                      >
                        {reason.label}
                      </Text>
                      <Text className="text-sm text-gray-500 mt-0.5">{reason.description}</Text>
                    </View>
                    <View
                      className={`w-6 h-6 rounded-full border-2 items-center justify-center ${
                        selectedReason === reason.type
                          ? 'border-green-600 bg-green-600'
                          : 'border-gray-300'
                      }`}
                    >
                      {selectedReason === reason.type && (
                        <View className="w-2 h-2 rounded-full bg-white" />
                      )}
                    </View>
                  </Pressable>
                ))}
              </View>

              {/* Additional Details */}
              {selectedReason && (
                <View className="px-5 pb-6">
                  <Text className="text-sm font-medium text-gray-500 mb-2 uppercase">
                    Additional details (optional)
                  </Text>
                  <TextInput
                    className="bg-gray-50 rounded-xl p-4 text-base text-gray-800 min-h-[100px] border border-gray-100"
                    placeholder="Provide any additional context that might help us review this report..."
                    placeholderTextColor="#9CA3AF"
                    multiline
                    textAlignVertical="top"
                    value={details}
                    onChangeText={setDetails}
                  />
                </View>
              )}

              {/* Error Message */}
              {error && (
                <View className="mx-5 mb-4 bg-red-50 p-4 rounded-xl border border-red-100">
                  <Text className="text-red-700 text-sm">{error}</Text>
                </View>
              )}
            </ScrollView>

            {/* Footer */}
            <View className="px-5 py-4 border-t border-gray-100">
              <Pressable
                onPress={handleSubmit}
                disabled={!selectedReason || isSubmitting}
                className={`py-4 rounded-xl items-center ${
                  selectedReason && !isSubmitting ? 'bg-red-600' : 'bg-gray-200'
                }`}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text
                    className={`font-semibold text-base ${
                      selectedReason ? 'text-white' : 'text-gray-400'
                    }`}
                  >
                    Submit Report
                  </Text>
                )}
              </Pressable>
              <Text className="text-xs text-gray-400 text-center mt-3">
                False reports may result in restrictions on your account.
              </Text>
            </View>
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}
