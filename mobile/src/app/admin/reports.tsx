import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Flag, CheckCircle, XCircle, AlertTriangle, MessageSquare, Store, ChevronRight, X } from 'lucide-react-native';
import { AdminGuard } from '@/components/AdminGuard';
import { useAdminStore, FlaggedContent, ReportType } from '@/lib/admin-store';
import { useUserStore } from '@/lib/user-store';
import * as Haptics from 'expo-haptics';

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  inappropriate: 'Inappropriate Content',
  spam: 'Spam',
  inaccurate: 'Inaccurate Information',
  offensive: 'Offensive Language',
  other: 'Other',
};

const REPORT_TYPE_COLORS: Record<ReportType, string> = {
  inappropriate: '#DC2626',
  spam: '#F59E0B',
  inaccurate: '#3B82F6',
  offensive: '#7C3AED',
  other: '#6B7280',
};

type TabType = 'pending' | 'resolved' | 'dismissed';

function ReportCard({
  report,
  onResolve,
  onDismiss,
}: {
  report: FlaggedContent;
  onResolve: (report: FlaggedContent) => void;
  onDismiss: (report: FlaggedContent) => void;
}) {
  const router = useRouter();
  const reasonColor = REPORT_TYPE_COLORS[report.reason];

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <View className="bg-white rounded-2xl p-4 mb-3 border border-gray-100">
      {/* Header */}
      <View className="flex-row items-start justify-between mb-3">
        <View className="flex-row items-center flex-1">
          <View
            className="w-10 h-10 rounded-xl items-center justify-center mr-3"
            style={{ backgroundColor: reasonColor + '15' }}
          >
            {report.type === 'review' ? (
              <MessageSquare size={20} color={reasonColor} />
            ) : (
              <Store size={20} color={reasonColor} />
            )}
          </View>
          <View className="flex-1">
            <Text className="text-base font-semibold text-gray-900" numberOfLines={1}>
              {report.type === 'review' ? 'Review Report' : 'Farmstand Report'}
            </Text>
            <Text className="text-sm text-gray-500">{formatDate(report.createdAt)}</Text>
          </View>
        </View>
        <View
          className="px-2 py-1 rounded-full"
          style={{ backgroundColor: reasonColor + '15' }}
        >
          <Text className="text-xs font-medium" style={{ color: reasonColor }}>
            {REPORT_TYPE_LABELS[report.reason]}
          </Text>
        </View>
      </View>

      {/* Farmstand Link */}
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push(`/farm/${report.farmstandId}`);
        }}
        className="flex-row items-center bg-gray-50 rounded-xl p-3 mb-3"
      >
        <Store size={16} color="#6B7280" />
        <Text className="text-sm text-gray-700 ml-2 flex-1" numberOfLines={1}>
          {report.farmstandName}
        </Text>
        <ChevronRight size={16} color="#9CA3AF" />
      </Pressable>

      {/* Content Preview */}
      <View className="bg-gray-50 rounded-xl p-3 mb-3">
        <Text className="text-xs font-medium text-gray-500 mb-1 uppercase">Reported Content</Text>
        <Text className="text-sm text-gray-800" numberOfLines={3}>
          "{report.contentPreview}"
        </Text>
      </View>

      {/* Details */}
      {report.details && (
        <View className="mb-3">
          <Text className="text-xs font-medium text-gray-500 mb-1 uppercase">Reporter's Note</Text>
          <Text className="text-sm text-gray-700">{report.details}</Text>
        </View>
      )}

      {/* Reporter */}
      <Text className="text-xs text-gray-400 mb-3">
        Reported by: {report.reportedByName}
      </Text>

      {/* Admin Note (for resolved/dismissed) */}
      {report.adminNote && report.status !== 'pending' && (
        <View className="bg-blue-50 rounded-xl p-3 mb-3">
          <Text className="text-xs font-medium text-blue-600 mb-1">Admin Note</Text>
          <Text className="text-sm text-blue-800">{report.adminNote}</Text>
        </View>
      )}

      {/* Actions */}
      {report.status === 'pending' && (
        <View className="flex-row gap-3 mt-1">
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onResolve(report);
            }}
            className="flex-1 flex-row items-center justify-center bg-green-600 py-3 rounded-xl"
          >
            <CheckCircle size={18} color="white" />
            <Text className="text-white font-semibold ml-2">Resolve</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onDismiss(report);
            }}
            className="flex-1 flex-row items-center justify-center bg-gray-200 py-3 rounded-xl"
          >
            <XCircle size={18} color="#374151" />
            <Text className="text-gray-700 font-semibold ml-2">Dismiss</Text>
          </Pressable>
        </View>
      )}

      {/* Status Badge for resolved/dismissed */}
      {report.status !== 'pending' && (
        <View className="flex-row items-center justify-between pt-3 border-t border-gray-100 mt-1">
          <View
            className="flex-row items-center px-3 py-1.5 rounded-full"
            style={{
              backgroundColor: report.status === 'resolved' ? '#DCFCE7' : '#F3F4F6',
            }}
          >
            {report.status === 'resolved' ? (
              <CheckCircle size={14} color="#16A34A" />
            ) : (
              <XCircle size={14} color="#6B7280" />
            )}
            <Text
              className="text-xs font-medium ml-1.5 capitalize"
              style={{ color: report.status === 'resolved' ? '#16A34A' : '#6B7280' }}
            >
              {report.status}
            </Text>
          </View>
          {report.resolvedAt && (
            <Text className="text-xs text-gray-400">
              {formatDate(report.resolvedAt)}
            </Text>
          )}
        </View>
      )}
    </View>
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
  report: FlaggedContent | null;
  action: 'resolve' | 'dismiss';
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

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView edges={['top']} className="flex-1 bg-white">
        <View className="flex-row items-center justify-between px-5 py-4 border-b border-gray-100">
          <Pressable onPress={handleClose} className="p-2 -ml-2">
            <X size={24} color="#111827" />
          </Pressable>
          <Text className="text-lg font-semibold text-gray-900">
            {action === 'resolve' ? 'Resolve Report' : 'Dismiss Report'}
          </Text>
          <View className="w-10" />
        </View>

        <ScrollView className="flex-1 p-5">
          {report && (
            <>
              <View className="bg-gray-50 rounded-xl p-4 mb-6">
                <Text className="text-sm font-medium text-gray-500 mb-2">Reported Content</Text>
                <Text className="text-base text-gray-800">"{report.contentPreview}"</Text>
              </View>

              <Text className="text-base font-semibold text-gray-900 mb-2">
                Admin Note (Optional)
              </Text>
              <TextInput
                className="bg-gray-50 rounded-xl p-4 text-base text-gray-800 min-h-[120px]"
                placeholder={
                  action === 'resolve'
                    ? "Describe action taken (e.g., content removed, user warned)..."
                    : "Reason for dismissing (e.g., false report, content is appropriate)..."
                }
                placeholderTextColor="#9CA3AF"
                multiline
                textAlignVertical="top"
                value={note}
                onChangeText={setNote}
              />

              <Text className="text-sm text-gray-500 mt-3">
                {action === 'resolve'
                  ? 'Mark this report as resolved. You may optionally add a note about the action taken.'
                  : 'Dismiss this report if the content does not violate guidelines.'}
              </Text>
            </>
          )}
        </ScrollView>

        <View className="p-5 border-t border-gray-100">
          <Pressable
            onPress={handleConfirm}
            disabled={isLoading}
            className={`py-4 rounded-xl items-center ${
              action === 'resolve' ? 'bg-green-600' : 'bg-gray-700'
            } ${isLoading ? 'opacity-50' : ''}`}
          >
            {isLoading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-semibold text-base">
                {action === 'resolve' ? 'Mark as Resolved' : 'Dismiss Report'}
              </Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function ReportsContent() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('pending');
  const [selectedReport, setSelectedReport] = useState<FlaggedContent | null>(null);
  const [modalAction, setModalAction] = useState<'resolve' | 'dismiss'>('resolve');
  const [showModal, setShowModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const getAllReports = useAdminStore((s) => s.getAllReports);
  const resolveReport = useAdminStore((s) => s.resolveReport);
  const dismissReport = useAdminStore((s) => s.dismissReport);
  const user = useUserStore((s) => s.user);

  useEffect(() => {
    loadAdminData();
  }, []);

  const allReports = getAllReports();
  const pendingReports = allReports.filter((r) => r.status === 'pending');
  const resolvedReports = allReports.filter((r) => r.status === 'resolved');
  const dismissedReports = allReports.filter((r) => r.status === 'dismissed');

  const getReportsForTab = () => {
    switch (activeTab) {
      case 'pending':
        return pendingReports;
      case 'resolved':
        return resolvedReports;
      case 'dismissed':
        return dismissedReports;
      default:
        return [];
    }
  };

  const handleResolve = (report: FlaggedContent) => {
    setSelectedReport(report);
    setModalAction('resolve');
    setShowModal(true);
  };

  const handleDismiss = (report: FlaggedContent) => {
    setSelectedReport(report);
    setModalAction('dismiss');
    setShowModal(true);
  };

  const handleConfirmAction = async (note: string) => {
    if (!selectedReport || !user) return;

    setIsLoading(true);
    try {
      if (modalAction === 'resolve') {
        await resolveReport(selectedReport.id, user.id ?? '', note || undefined);
      } else {
        await dismissReport(selectedReport.id, user.id ?? '', note || undefined);
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
    <View className="flex-1 bg-gray-50">
      <SafeAreaView edges={['top']} className="bg-white">
        <View className="flex-row items-center justify-between px-5 py-4 border-b border-gray-100">
          <Pressable onPress={() => router.back()} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#111827" />
          </Pressable>
          <Text className="text-lg font-semibold text-gray-900">Reports & Flags</Text>
          <View className="w-10" />
        </View>

        {/* Tabs */}
        <View className="flex-row px-5 py-3 bg-white border-b border-gray-100">
          {[
            { key: 'pending', label: 'Pending', count: pendingReports.length },
            { key: 'resolved', label: 'Resolved', count: resolvedReports.length },
            { key: 'dismissed', label: 'Dismissed', count: dismissedReports.length },
          ].map((tab) => (
            <Pressable
              key={tab.key}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setActiveTab(tab.key as TabType);
              }}
              className={`flex-1 py-2 rounded-lg mr-2 last:mr-0 ${
                activeTab === tab.key ? 'bg-green-600' : 'bg-gray-100'
              }`}
            >
              <Text
                className={`text-center font-medium ${
                  activeTab === tab.key ? 'text-white' : 'text-gray-600'
                }`}
              >
                {tab.label} ({tab.count})
              </Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>

      {reports.length === 0 ? (
        <View className="flex-1 items-center justify-center p-8">
          <View className="w-20 h-20 bg-green-100 rounded-full items-center justify-center mb-4">
            {activeTab === 'pending' ? (
              <CheckCircle size={40} color="#16a34a" />
            ) : (
              <Flag size={40} color="#16a34a" />
            )}
          </View>
          <Text className="text-xl font-semibold text-gray-900 text-center">
            {activeTab === 'pending' ? 'All Clear!' : `No ${activeTab} reports`}
          </Text>
          <Text className="text-base text-gray-500 text-center mt-2">
            {activeTab === 'pending'
              ? 'No flagged content or reports to review at this time.'
              : `You don't have any ${activeTab} reports yet.`}
          </Text>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16 }}
          showsVerticalScrollIndicator={false}
        >
          {reports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              onResolve={handleResolve}
              onDismiss={handleDismiss}
            />
          ))}
        </ScrollView>
      )}

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

export default function Reports() {
  return (
    <AdminGuard>
      <ReportsContent />
    </AdminGuard>
  );
}
