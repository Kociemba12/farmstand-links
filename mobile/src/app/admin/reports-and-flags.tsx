import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Star,
  MessageSquare,
  AlertTriangle,
  Flag,
  X,
  ChevronRight,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { AdminGuard } from '@/components/AdminGuard';
import {
  useAdminStore,
  ReportAndFlag,
  ReportStatus,
  SupportTicket,
  TicketStatus,
} from '@/lib/admin-store';
import { useUserStore } from '@/lib/user-store';
import * as Haptics from 'expo-haptics';

// Background color constant
const BG_COLOR = '#FAF7F2';

type TabType = 'pending' | 'resolved';

function getTicketStatusColor(status: TicketStatus): string {
  switch (status) {
    case 'open':
      return '#3B82F6';
    case 'waiting_on_farmer':
      return '#F59E0B';
    case 'waiting_on_admin':
      return '#EF4444';
    case 'resolved':
      return '#16A34A';
    case 'reopened':
      return '#8B5CF6';
    default:
      return '#6B7280';
  }
}

function getTicketStatusLabel(status: TicketStatus): string {
  switch (status) {
    case 'open':
      return 'Open';
    case 'waiting_on_farmer':
      return 'Waiting';
    case 'waiting_on_admin':
      return 'Needs Reply';
    case 'resolved':
      return 'Resolved';
    case 'reopened':
      return 'Reopened';
    default:
      return status;
  }
}

function ReportCard({
  report,
  ticket,
  onMarkReviewed,
  onResolve,
  onDismiss,
  onOpenConversation,
  delay = 0,
}: {
  report: ReportAndFlag;
  ticket: SupportTicket | undefined;
  onMarkReviewed: (report: ReportAndFlag) => void;
  onResolve: (report: ReportAndFlag) => void;
  onDismiss: (report: ReportAndFlag) => void;
  onOpenConversation: (report: ReportAndFlag) => void;
  delay?: number;
}) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isReport = report.submissionType !== 'review';
  const typeColor = isReport ? '#EF4444' : '#16A34A';
  const typeBg = isReport ? '#FEE2E2' : '#DCFCE7';

  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(400)}>
      <View
        className="bg-white rounded-[20px] p-5 mb-4"
        style={{
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.06,
          shadowRadius: 12,
          elevation: 3,
        }}
      >
        {/* Header */}
        <View className="flex-row items-start justify-between mb-4">
          <View className="flex-row items-center flex-1">
            <View
              className="w-12 h-12 rounded-full items-center justify-center mr-4"
              style={{ backgroundColor: typeBg }}
            >
              {isReport ? (
                <Flag size={22} color={typeColor} />
              ) : (
                <Star size={22} color={typeColor} />
              )}
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-stone-900">
                {report.submissionType === 'review' ? 'Review' : 'Report'}
              </Text>
              <Text className="text-xs text-stone-500">{formatDate(report.createdAt)}</Text>
            </View>
          </View>
          <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: typeBg }}>
            <Text className="text-xs font-semibold uppercase" style={{ color: typeColor }}>
              {report.submissionType}
            </Text>
          </View>
        </View>

        {/* Item Info */}
        <View className="bg-stone-50 rounded-2xl p-4 mb-4">
          <View className="flex-row justify-between mb-2">
            <Text className="text-xs font-medium text-stone-400 uppercase">Item Type</Text>
            <Text className="text-xs font-semibold text-stone-700 capitalize">
              {report.reportedItemType}
            </Text>
          </View>
          <View className="flex-row justify-between mb-2">
            <Text className="text-xs font-medium text-stone-400 uppercase">Item Name</Text>
            <Text className="text-xs font-semibold text-stone-700" numberOfLines={1}>
              {report.reportedItemName}
            </Text>
          </View>
          {report.rating && (
            <View className="flex-row justify-between mb-2">
              <Text className="text-xs font-medium text-stone-400 uppercase">Rating</Text>
              <View className="flex-row items-center">
                {[...Array(5)].map((_, i) => (
                  <Star
                    key={i}
                    size={12}
                    color="#D4943A"
                    fill={i < report.rating! ? '#D4943A' : 'transparent'}
                  />
                ))}
              </View>
            </View>
          )}
          <View className="flex-row justify-between">
            <Text className="text-xs font-medium text-stone-400 uppercase">Source</Text>
            <Text className="text-xs font-semibold text-stone-700">{report.sourceScreen}</Text>
          </View>
        </View>

        {/* Reason */}
        <View className="mb-4">
          <Text className="text-xs font-semibold text-stone-400 uppercase mb-2">Reason</Text>
          <View className="bg-amber-50 rounded-2xl p-4">
            <View className="flex-row items-start">
              <AlertTriangle size={16} color="#F59E0B" style={{ marginTop: 2 }} />
              <Text className="text-sm text-amber-800 ml-3 flex-1 font-medium">
                {report.reason}
              </Text>
            </View>
          </View>
        </View>

        {/* Comments */}
        <View className="mb-4">
          <Text className="text-xs font-semibold text-stone-400 uppercase mb-2">Comments</Text>
          <View className="bg-blue-50 rounded-2xl p-4">
            <Text className="text-sm text-blue-800 leading-5">"{report.comments}"</Text>
          </View>
        </View>

        {/* Submitter Info */}
        <View className="bg-purple-50 rounded-2xl p-4 mb-4">
          <Text className="text-xs font-semibold text-purple-400 uppercase mb-1">Submitted By</Text>
          <Text className="text-sm text-purple-800 font-medium">{report.submittedByUserEmail}</Text>
          <Text className="text-xs text-purple-600 mt-0.5">User ID: {report.submittedByUserId}</Text>
        </View>

        {/* Admin Note (if reviewed/resolved/dismissed) */}
        {report.adminNote && report.status !== 'pending' && (
          <View className="bg-stone-100 rounded-2xl p-4 mb-4">
            <Text className="text-xs font-semibold text-stone-400 uppercase mb-1">Admin Note</Text>
            <Text className="text-sm text-stone-800">{report.adminNote}</Text>
            {report.reviewedAt && (
              <Text className="text-xs text-stone-500 mt-2">{formatDate(report.reviewedAt)}</Text>
            )}
          </View>
        )}

        {/* Conversation Button */}
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onOpenConversation(report);
          }}
          className="flex-row items-center justify-between bg-green-50 rounded-2xl p-4 mb-4 active:bg-green-100"
        >
          <View className="flex-row items-center">
            <View className="w-9 h-9 rounded-full bg-green-100 items-center justify-center mr-3">
              <MessageSquare size={18} color="#16A34A" />
            </View>
            <Text className="text-green-700 font-semibold">Open Conversation</Text>
          </View>
          {ticket ? (
            <View
              className="px-2.5 py-1 rounded-full"
              style={{ backgroundColor: getTicketStatusColor(ticket.status) + '20' }}
            >
              <Text
                className="text-xs font-semibold"
                style={{ color: getTicketStatusColor(ticket.status) }}
              >
                {getTicketStatusLabel(ticket.status)}
              </Text>
            </View>
          ) : (
            <ChevronRight size={18} color="#16A34A" />
          )}
        </Pressable>

        {/* Actions (for pending only) */}
        {report.status === 'pending' && (
          <View className="flex-row" style={{ gap: 8 }}>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onMarkReviewed(report);
              }}
              className="flex-1 flex-row items-center justify-center bg-blue-600 py-3.5 rounded-2xl active:bg-blue-700"
            >
              <CheckCircle size={16} color="white" />
              <Text className="text-white font-semibold ml-1.5 text-sm">Review</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onResolve(report);
              }}
              className="flex-1 flex-row items-center justify-center bg-green-600 py-3.5 rounded-2xl active:bg-green-700"
            >
              <CheckCircle size={16} color="white" />
              <Text className="text-white font-semibold ml-1.5 text-sm">Resolve</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onDismiss(report);
              }}
              className="flex-1 flex-row items-center justify-center bg-stone-200 py-3.5 rounded-2xl active:bg-stone-300"
            >
              <XCircle size={16} color="#57534E" />
              <Text className="text-stone-700 font-semibold ml-1.5 text-sm">Dismiss</Text>
            </Pressable>
          </View>
        )}

        {/* Status Badge (for non-pending) */}
        {report.status !== 'pending' && (
          <View className="flex-row items-center justify-between pt-4 border-t border-stone-100">
            <View
              className="flex-row items-center px-3 py-1.5 rounded-full"
              style={{
                backgroundColor:
                  report.status === 'resolved'
                    ? '#DCFCE7'
                    : report.status === 'reviewed'
                    ? '#DBEAFE'
                    : '#F3F4F6',
              }}
            >
              {report.status === 'resolved' ? (
                <CheckCircle size={14} color="#16A34A" />
              ) : report.status === 'reviewed' ? (
                <CheckCircle size={14} color="#2563EB" />
              ) : (
                <XCircle size={14} color="#6B7280" />
              )}
              <Text
                className="text-xs font-semibold capitalize ml-1.5"
                style={{
                  color:
                    report.status === 'resolved'
                      ? '#16A34A'
                      : report.status === 'reviewed'
                      ? '#2563EB'
                      : '#6B7280',
                }}
              >
                {report.status}
              </Text>
            </View>
            {report.reviewedAt && (
              <Text className="text-xs text-stone-400">{formatDate(report.reviewedAt)}</Text>
            )}
          </View>
        )}
      </View>
    </Animated.View>
  );
}

function ActionModal({
  visible,
  report,
  action,
  onClose,
  onConfirm,
  isLoading,
}: {
  visible: boolean;
  report: ReportAndFlag | null;
  action: 'reviewed' | 'resolve' | 'dismiss';
  onClose: () => void;
  onConfirm: (note: string) => void;
  isLoading: boolean;
}) {
  const [note, setNote] = useState('');

  const handleConfirm = () => {
    onConfirm(note);
    setNote('');
  };

  const handleClose = () => {
    setNote('');
    onClose();
  };

  const getActionTitle = () => {
    switch (action) {
      case 'reviewed':
        return 'Mark as Reviewed';
      case 'resolve':
        return 'Resolve Report';
      case 'dismiss':
        return 'Dismiss Report';
    }
  };

  const getActionButtonText = () => {
    switch (action) {
      case 'reviewed':
        return 'Mark as Reviewed';
      case 'resolve':
        return 'Mark as Resolved';
      case 'dismiss':
        return 'Dismiss Report';
    }
  };

  const getActionColor = () => {
    switch (action) {
      case 'reviewed':
        return '#3B82F6';
      case 'resolve':
        return '#16A34A';
      case 'dismiss':
        return '#57534E';
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={0}
      >
        <SafeAreaView edges={['top']} className="flex-1" style={{ backgroundColor: BG_COLOR }}>
          <View className="flex-row items-center justify-between px-5 py-4 border-b border-stone-200 bg-white">
            <Pressable onPress={handleClose} className="w-10 h-10 bg-stone-100 rounded-full items-center justify-center">
              <X size={20} color="#57534E" />
            </Pressable>
            <Text className="text-lg font-bold text-stone-900">{getActionTitle()}</Text>
            <View className="w-10" />
          </View>

          <ScrollView className="flex-1 p-5" keyboardShouldPersistTaps="handled">
            {report && (
              <>
                <View className="bg-white rounded-2xl p-5 mb-6" style={{
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.04,
                  shadowRadius: 8,
                  elevation: 2,
                }}>
                  <Text className="text-xs font-semibold text-stone-400 uppercase mb-3">Report Details</Text>
                  <Text className="text-base font-semibold text-stone-900 mb-1">
                    {report.reportedItemName}
                  </Text>
                  <Text className="text-sm text-stone-600 mb-3">{report.reason}</Text>
                  <View className="bg-blue-50 rounded-xl p-3">
                    <Text className="text-sm text-blue-800">"{report.comments}"</Text>
                  </View>
                </View>

                <Text className="text-base font-semibold text-stone-900 mb-3">
                  Admin Note (Optional)
                </Text>
                <TextInput
                  className="bg-white rounded-2xl p-4 text-base text-stone-800 min-h-[120px]"
                  placeholder={
                    action === 'resolve'
                      ? 'Describe action taken (e.g., content removed, user warned)...'
                      : action === 'reviewed'
                      ? 'Add review notes...'
                      : 'Reason for dismissing (e.g., false report, content is appropriate)...'
                  }
                  placeholderTextColor="#A8A29E"
                  multiline
                  textAlignVertical="top"
                  value={note}
                  onChangeText={setNote}
                  style={{
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.04,
                    shadowRadius: 8,
                    elevation: 2,
                  }}
                />

                <Text className="text-sm text-stone-500 mt-4 leading-5">
                  {action === 'resolve'
                    ? 'Mark this report as resolved. You may optionally add a note about the action taken.'
                    : action === 'reviewed'
                    ? 'Mark this report as reviewed without resolving or dismissing it.'
                    : 'Dismiss this report if the content does not violate guidelines.'}
                </Text>
              </>
            )}
          </ScrollView>

          <View className="p-5 bg-white border-t border-stone-200">
            <Pressable
              onPress={handleConfirm}
              disabled={isLoading}
              className="py-4 rounded-2xl items-center"
              style={{ backgroundColor: isLoading ? '#D4D4D4' : getActionColor() }}
            >
              {isLoading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-white font-semibold text-base">{getActionButtonText()}</Text>
              )}
            </Pressable>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ReportsAndFlagsContent() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabType>('pending');
  const [selectedReport, setSelectedReport] = useState<ReportAndFlag | null>(null);
  const [modalAction, setModalAction] = useState<'reviewed' | 'resolve' | 'dismiss'>('reviewed');
  const [showModal, setShowModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const getAllReportsAndFlags = useAdminStore((s) => s.getAllReportsAndFlags);
  const getReportsAndFlagsByStatus = useAdminStore((s) => s.getReportsAndFlagsByStatus);
  const markReportAsReviewed = useAdminStore((s) => s.markReportAsReviewed);
  const resolveReportAndFlag = useAdminStore((s) => s.resolveReportAndFlag);
  const dismissReportAndFlag = useAdminStore((s) => s.dismissReportAndFlag);
  const getTicketByReportId = useAdminStore((s) => s.getTicketByReportId);
  const user = useUserStore((s) => s.user);

  useEffect(() => {
    loadAdminData();
  }, []);

  const pendingReports = getReportsAndFlagsByStatus('pending');
  const resolvedReports = [
    ...getReportsAndFlagsByStatus('reviewed'),
    ...getReportsAndFlagsByStatus('resolved'),
    ...getReportsAndFlagsByStatus('dismissed'),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const getReportsForTab = () => {
    switch (activeTab) {
      case 'pending':
        return pendingReports;
      case 'resolved':
        return resolvedReports;
      default:
        return [];
    }
  };

  const handleMarkReviewed = (report: ReportAndFlag) => {
    setSelectedReport(report);
    setModalAction('reviewed');
    setShowModal(true);
  };

  const handleResolve = (report: ReportAndFlag) => {
    setSelectedReport(report);
    setModalAction('resolve');
    setShowModal(true);
  };

  const handleDismiss = (report: ReportAndFlag) => {
    setSelectedReport(report);
    setModalAction('dismiss');
    setShowModal(true);
  };

  const handleOpenConversation = (report: ReportAndFlag) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/admin/ticket-thread?reportId=${report.id}`);
  };

  const handleConfirmAction = async (note: string) => {
    if (!selectedReport || !user) return;

    setIsLoading(true);
    try {
      if (modalAction === 'reviewed') {
        await markReportAsReviewed(selectedReport.id, user.id ?? '', note || undefined);
      } else if (modalAction === 'resolve') {
        await resolveReportAndFlag(selectedReport.id, user.id ?? '', note || undefined);
      } else {
        await dismissReportAndFlag(selectedReport.id, user.id ?? '', note || undefined);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Error handling report:', error);
    } finally {
      setIsLoading(false);
      setShowModal(false);
      setSelectedReport(null);
    }
  };

  const reports = getReportsForTab();

  return (
    <View className="flex-1" style={{ backgroundColor: BG_COLOR }}>
      {/* Light status bar for red gradient header */}
      <StatusBar style="light" />

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Hero Header - Full bleed to top of screen */}
        <Animated.View entering={FadeIn.duration(500)}>
          <LinearGradient
            colors={['#DC2626', '#EF4444', '#F87171']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              paddingTop: insets.top,
              paddingBottom: 60,
              borderBottomLeftRadius: 32,
              borderBottomRightRadius: 32,
            }}
          >
            <View className="px-5 pt-4">
              {/* Back Button */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.back();
                }}
                className="w-10 h-10 bg-white/20 rounded-full items-center justify-center mb-4"
              >
                <ArrowLeft size={22} color="white" />
              </Pressable>

              {/* Page Info */}
              <View className="items-center pb-4">
                <View
                  className="w-16 h-16 rounded-full items-center justify-center mb-3"
                  style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
                >
                  <Flag size={32} color="white" />
                </View>
                <Text className="text-white text-2xl font-bold">Reports & Flags</Text>
                <Text className="text-red-200 text-sm mt-1">
                  Review user reports and reviews
                </Text>
              </View>
            </View>
          </LinearGradient>
        </Animated.View>

        {/* Stats Card - overlapping hero */}
        <View className="px-5 -mt-10">
          <Animated.View
            entering={FadeInDown.delay(100).duration(400)}
            className="bg-white rounded-2xl p-4 flex-row"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.08,
              shadowRadius: 16,
              elevation: 5,
              gap: 12,
            }}
          >
            <Pressable
              onPress={() => setActiveTab('pending')}
              className={`flex-1 py-3 rounded-xl items-center ${
                activeTab === 'pending' ? 'bg-red-500' : 'bg-stone-100'
              }`}
            >
              <Text
                className={`text-2xl font-bold ${
                  activeTab === 'pending' ? 'text-white' : 'text-red-500'
                }`}
              >
                {pendingReports.length}
              </Text>
              <Text
                className={`text-xs font-medium mt-1 ${
                  activeTab === 'pending' ? 'text-red-100' : 'text-stone-500'
                }`}
              >
                Pending
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveTab('resolved')}
              className={`flex-1 py-3 rounded-xl items-center ${
                activeTab === 'resolved' ? 'bg-green-500' : 'bg-stone-100'
              }`}
            >
              <Text
                className={`text-2xl font-bold ${
                  activeTab === 'resolved' ? 'text-white' : 'text-green-600'
                }`}
              >
                {resolvedReports.length}
              </Text>
              <Text
                className={`text-xs font-medium mt-1 ${
                  activeTab === 'resolved' ? 'text-green-100' : 'text-stone-500'
                }`}
              >
                Resolved
              </Text>
            </Pressable>
          </Animated.View>
        </View>

        {/* Reports List */}
        <View className="px-5 pt-6">
          {reports.length === 0 ? (
            <Animated.View
              entering={FadeInDown.delay(200).duration(400)}
              className="bg-white rounded-[20px] p-8 items-center"
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 3 },
                shadowOpacity: 0.06,
                shadowRadius: 12,
                elevation: 3,
              }}
            >
              <View className="w-16 h-16 rounded-full bg-green-100 items-center justify-center mb-4">
                {activeTab === 'pending' ? (
                  <CheckCircle size={32} color="#16A34A" />
                ) : (
                  <Flag size={32} color="#16A34A" />
                )}
              </View>
              <Text className="text-lg font-semibold text-stone-900 mb-1">
                {activeTab === 'pending' ? 'All Clear!' : 'No resolved reports'}
              </Text>
              <Text className="text-sm text-stone-500 text-center">
                {activeTab === 'pending'
                  ? 'No reports or reviews to review at this time.'
                  : "You don't have any resolved reports yet."}
              </Text>
            </Animated.View>
          ) : (
            reports.map((report, index) => (
              <ReportCard
                key={report.id}
                report={report}
                ticket={getTicketByReportId(report.id)}
                onMarkReviewed={handleMarkReviewed}
                onResolve={handleResolve}
                onDismiss={handleDismiss}
                onOpenConversation={handleOpenConversation}
                delay={200 + index * 50}
              />
            ))
          )}
        </View>
      </ScrollView>

      <ActionModal
        visible={showModal}
        report={selectedReport}
        action={modalAction}
        onClose={() => {
          setShowModal(false);
          setSelectedReport(null);
        }}
        onConfirm={handleConfirmAction}
        isLoading={isLoading}
      />
    </View>
  );
}

export default function ReportsAndFlags() {
  return (
    <AdminGuard>
      <ReportsAndFlagsContent />
    </AdminGuard>
  );
}
