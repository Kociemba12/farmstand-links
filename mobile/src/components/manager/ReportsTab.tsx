import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Modal,
  ActivityIndicator,
  Animated,
  Platform,
  Dimensions,
} from 'react-native';

const SHEET_CLOSED_Y = Dimensions.get('window').height;
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FarmstandLogoPng } from '@/components/FarmstandLogoPng';
import {
  BarChart3,
  DollarSign,
  TrendingDown,
  TrendingUp,
  ShoppingCart,
  Receipt,
  RefreshCw,
  FileText,
  Download,
  Upload,
  X,
  CheckCircle,
  AlertCircle,
  ChevronRight,
  Package,
} from 'lucide-react-native';
import type { DateRange, DateRangePreset, FarmstandReportData } from '@/lib/manager-types';
import { DATE_RANGE_LABELS } from '@/lib/manager-types';
import {
  buildFarmstandReportData,
  fetchInventory,
  formatCurrency,
  formatRelativeDate,
} from '@/lib/manager-service';
import { exportToPdf, exportToCsv, shareReportText, buildPdfHtml } from '@/lib/manager-export';
import type { InventoryItem } from '@/lib/manager-types';
import { ManagerShimmer } from './ManagerShimmer';

interface ReportsTabProps {
  farmstandId: string;
  farmstandName: string;
  dateRange: DateRange;
  onDateRangeChange: (preset: DateRangePreset) => void;
}

const DATE_PRESETS: DateRangePreset[] = ['this_week', 'this_month', 'this_season', 'all_time'];

type ExportState = 'idle' | 'loading' | 'success' | 'error';
type ExportType = 'pdf' | 'csv' | 'share';

// ─────────────────────────────────────────────
// PDF Preview Modal
// ─────────────────────────────────────────────

interface PdfPreviewModalProps {
  visible: boolean;
  onClose: () => void;
  onExport: () => void;
  onShare: () => void;
  html: string;
  exportState: ExportState;
  activeAction: 'export' | 'share' | null;
}

function PdfPreviewModal({ visible, onClose, onExport, onShare, html, exportState, activeAction }: PdfPreviewModalProps) {
  const insets = useSafeAreaInsets();
  const isExporting = exportState === 'loading' && activeAction === 'export';
  const isSharing = exportState === 'loading' && activeAction === 'share';
  const isBusy = exportState === 'loading';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#FAFAF8' }}>
        {/* Header */}
        <View style={{
          paddingTop: insets.top,
          backgroundColor: '#FFFFFF',
          borderBottomWidth: 1,
          borderBottomColor: '#EBEBEB',
        }}>
          {/* Center stack: logo only */}
          <View style={{ alignItems: 'center', paddingTop: 14, paddingBottom: 6 }}>
            <FarmstandLogoPng width={330} tintColor="#1F4D36" tight={true} />
          </View>

          {/* Close — pinned top-left */}
          <Pressable
            onPress={onClose}
            disabled={isBusy}
            style={{
              position: 'absolute',
              top: insets.top + 12,
              left: 16,
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: '#F0EFED',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
            }}
          >
            <X size={17} color="#444" />
          </Pressable>

          {/* Export + Share — pinned top-right; Share is rightmost to sit at edge */}
          <View style={{
            position: 'absolute',
            top: insets.top + 12,
            right: 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            zIndex: 10,
          }}>
            <Pressable
              onPress={onExport}
              disabled={isBusy}
              style={({ pressed }) => ({
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: 20,
                backgroundColor: isExporting ? '#7EA88E' : '#1F4D36',
                opacity: pressed ? 0.8 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
              })}
            >
              {isExporting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Download size={14} color="#FFF" strokeWidth={2.5} />
              )}
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFF' }}>
                {isExporting ? 'Exporting…' : 'Export'}
              </Text>
            </Pressable>

            <Pressable
              onPress={onShare}
              disabled={isBusy}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: isSharing ? '#D0EAD9' : '#EBF5EE',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              {isSharing ? (
                <ActivityIndicator size="small" color="#1F6B42" />
              ) : (
                <Upload size={22} color="#1F6B42" strokeWidth={2} />
              )}
            </Pressable>
          </View>
        </View>

        {/* WebView PDF content */}
        <WebView
          source={{ html }}
          style={{ flex: 1, backgroundColor: '#FAFAF8' }}
          scrollEnabled
          showsVerticalScrollIndicator={false}
          originWhitelist={['*']}
        />
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────
// CSV Preview Modal
// ─────────────────────────────────────────────

interface CsvPreviewModalProps {
  visible: boolean;
  onClose: () => void;
  onExport: () => void;
  onShare: () => void;
  report: FarmstandReportData;
  inventory: InventoryItem[];
  exportState: ExportState;
  activeAction: 'export' | 'share' | null;
}

function CsvPreviewModal({ visible, onClose, onExport, onShare, report, inventory, exportState, activeAction }: CsvPreviewModalProps) {
  const insets = useSafeAreaInsets();
  const isExporting = exportState === 'loading' && activeAction === 'export';
  const isSharing = exportState === 'loading' && activeAction === 'share';
  const isBusy = exportState === 'loading';
  const dateLabel = DATE_RANGE_LABELS[report.dateRange.preset];

  const summaryRows = [
    { label: 'Farmstand', value: report.farmstandName },
    { label: 'Period', value: dateLabel },
    { label: 'Revenue', value: formatCurrency(report.summary.revenue), color: '#2D5A3D' },
    { label: 'Expenses', value: formatCurrency(report.summary.expenses), color: '#DC2626' },
    { label: 'Net Profit', value: formatCurrency(report.summary.netProfit), color: report.summary.netProfit >= 0 ? '#2D5A3D' : '#DC2626' },
    { label: 'Inventory Value', value: formatCurrency(report.summary.inventoryValue), color: '#D97706' },
  ];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#FAFAF8' }}>
        {/* Header — matches PDF Preview header structure */}
        <View style={{
          paddingTop: insets.top,
          backgroundColor: '#FFFFFF',
          borderBottomWidth: 1,
          borderBottomColor: '#EBEBEB',
        }}>
          {/* Center stack: logo only */}
          <View style={{ alignItems: 'center', paddingTop: 14, paddingBottom: 6 }}>
            <FarmstandLogoPng width={330} tintColor="#1F4D36" tight={true} />
          </View>

          {/* Close — pinned top-left */}
          <Pressable
            onPress={onClose}
            disabled={isBusy}
            style={{
              position: 'absolute',
              top: insets.top + 12,
              left: 16,
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: '#F0EFED',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
            }}
          >
            <X size={17} color="#444" />
          </Pressable>

          {/* Export CSV + Share — pinned top-right; Share is rightmost to sit at edge */}
          <View style={{
            position: 'absolute',
            top: insets.top + 12,
            right: 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            zIndex: 10,
          }}>
            <Pressable
              onPress={onExport}
              disabled={isBusy}
              style={({ pressed }) => ({
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: 20,
                backgroundColor: isExporting ? '#7EA88E' : '#1F4D36',
                opacity: pressed ? 0.8 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
              })}
            >
              {isExporting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Download size={14} color="#FFF" strokeWidth={2.5} />
              )}
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFF' }}>
                {isExporting ? 'Exporting…' : 'Export CSV'}
              </Text>
            </Pressable>

            <Pressable
              onPress={onShare}
              disabled={isBusy}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: isSharing ? '#D0EAD9' : '#EBF5EE',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              {isSharing ? (
                <ActivityIndicator size="small" color="#1F6B42" />
              ) : (
                <Upload size={22} color="#1F6B42" strokeWidth={2} />
              )}
            </Pressable>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
          {/* Summary section */}
          <Text style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.5, color: '#A0A0A0', marginBottom: 10 }}>
            Summary
          </Text>
          <View style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 16,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: '#EBEBEB',
          }}>
            {summaryRows.map((row, i) => (
              <View key={row.label} style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingVertical: 13,
                borderBottomWidth: i < summaryRows.length - 1 ? 1 : 0,
                borderBottomColor: '#F3F3F1',
              }}>
                <Text style={{ flex: 1, fontSize: 13, color: '#666', fontWeight: '500' }}>{row.label}</Text>
                <Text style={{ fontSize: 14, fontWeight: '700', color: row.color ?? '#1A1A1A' }}>{row.value}</Text>
              </View>
            ))}
          </View>

          {/* Top sellers */}
          {report.topSellingItems.length > 0 && (
            <>
              <Text style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.5, color: '#A0A0A0', marginTop: 24, marginBottom: 10 }}>
                Top Selling Items
              </Text>
              <View style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 16,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: '#EBEBEB',
              }}>
                {/* Table header */}
                <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#F9F9F7', borderBottomWidth: 1, borderBottomColor: '#EBEBEB' }}>
                  <Text style={{ flex: 1, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: '#999' }}>Item</Text>
                  <Text style={{ width: 64, textAlign: 'center', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: '#999' }}>Qty</Text>
                  <Text style={{ width: 80, textAlign: 'right', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: '#999' }}>Revenue</Text>
                </View>
                {report.topSellingItems.slice(0, 10).map((item, i) => (
                  <View key={item.item_name} style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderBottomWidth: i < Math.min(report.topSellingItems.length, 10) - 1 ? 1 : 0,
                    borderBottomColor: '#F3F3F1',
                  }}>
                    <Text style={{ flex: 1, fontSize: 13, color: '#1A1A1A', fontWeight: '500' }} numberOfLines={1}>{item.item_name}</Text>
                    <Text style={{ width: 64, textAlign: 'center', fontSize: 13, color: '#555' }}>{item.totalQuantity}</Text>
                    <Text style={{ width: 80, textAlign: 'right', fontSize: 13, fontWeight: '700', color: '#2D5A3D' }}>{formatCurrency(item.totalRevenue)}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Transactions */}
          {report.recentActivity.length > 0 && (
            <>
              <Text style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.5, color: '#A0A0A0', marginTop: 24, marginBottom: 10 }}>
                Recent Transactions
              </Text>
              <View style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 16,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: '#EBEBEB',
              }}>
                <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#F9F9F7', borderBottomWidth: 1, borderBottomColor: '#EBEBEB' }}>
                  <Text style={{ width: 60, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: '#999' }}>Type</Text>
                  <Text style={{ flex: 1, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: '#999' }}>Item</Text>
                  <Text style={{ width: 80, textAlign: 'right', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: '#999' }}>Amount</Text>
                </View>
                {report.recentActivity.slice(0, 15).map((a, i) => (
                  <View key={a.id} style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 16,
                    paddingVertical: 11,
                    borderBottomWidth: i < Math.min(report.recentActivity.length, 15) - 1 ? 1 : 0,
                    borderBottomColor: '#F3F3F1',
                  }}>
                    <View style={{
                      width: 60,
                      paddingRight: 8,
                    }}>
                      <View style={{
                        paddingHorizontal: 7,
                        paddingVertical: 3,
                        borderRadius: 8,
                        backgroundColor: a.type === 'sale' ? '#DCFCE7' : '#FEE2E2',
                        alignSelf: 'flex-start',
                      }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: a.type === 'sale' ? '#166534' : '#991B1B' }}>
                          {a.type === 'sale' ? 'Sale' : 'Exp'}
                        </Text>
                      </View>
                    </View>
                    <Text style={{ flex: 1, fontSize: 13, color: '#1A1A1A', fontWeight: '500' }} numberOfLines={1}>{a.label}</Text>
                    <Text style={{ width: 80, textAlign: 'right', fontSize: 13, fontWeight: '700', color: a.type === 'sale' ? '#2D5A3D' : '#DC2626' }}>
                      {a.amount != null ? `${a.type === 'sale' ? '+' : '-'}${formatCurrency(a.amount)}` : '—'}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Inventory */}
          {inventory.length > 0 && (
            <>
              <Text style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.5, color: '#A0A0A0', marginTop: 24, marginBottom: 10 }}>
                Inventory ({inventory.length} items)
              </Text>
              <View style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 16,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: '#EBEBEB',
              }}>
                <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#F9F9F7', borderBottomWidth: 1, borderBottomColor: '#EBEBEB' }}>
                  <Text style={{ flex: 1, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: '#999' }}>Item</Text>
                  <Text style={{ width: 44, textAlign: 'center', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: '#999' }}>Qty</Text>
                  <Text style={{ width: 72, textAlign: 'right', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: '#999' }}>Value</Text>
                </View>
                {inventory.slice(0, 20).map((item, i) => {
                  const val = item.price != null ? item.quantity * item.price : null;
                  return (
                    <View key={item.item_name + i} style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: 16,
                      paddingVertical: 11,
                      borderBottomWidth: i < Math.min(inventory.length, 20) - 1 ? 1 : 0,
                      borderBottomColor: '#F3F3F1',
                    }}>
                      <Text style={{ flex: 1, fontSize: 13, color: '#1A1A1A', fontWeight: '500' }} numberOfLines={1}>{item.item_name}</Text>
                      <Text style={{ width: 44, textAlign: 'center', fontSize: 13, color: '#555' }}>{item.quantity}</Text>
                      <Text style={{ width: 72, textAlign: 'right', fontSize: 13, fontWeight: '700', color: '#D97706' }}>
                        {val != null ? formatCurrency(val) : '—'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          <Text style={{ fontSize: 12, color: '#B0B0B0', textAlign: 'center', marginTop: 24 }}>
            CSV export includes all rows shown above
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────
// Export Action Sheet
// ─────────────────────────────────────────────

interface ExportSheetProps {
  visible: boolean;
  onClose: () => void;
  onExport: (type: ExportType) => void;
  exportState: ExportState;
  exportType: ExportType | null;
  errorMessage: string;
}

function ExportSheet({
  visible,
  onClose,
  onExport,
  exportState,
  exportType,
  errorMessage,
}: ExportSheetProps) {
  const insets = useSafeAreaInsets();

  const actions: {
    type: ExportType;
    icon: React.ElementType;
    label: string;
    subtitle: string;
    color: string;
    bg: string;
  }[] = [
    {
      type: 'pdf',
      icon: FileText,
      label: 'PDF',
      subtitle: 'Preview and download a printable report',
      color: '#1F6B42',
      bg: '#E8F5EE',
    },
    {
      type: 'csv',
      icon: Download,
      label: 'CSV',
      subtitle: 'Preview data and export for spreadsheets',
      color: '#1B4FBF',
      bg: '#EBF2FF',
    },
    {
      type: 'share',
      icon: Upload,
      label: 'Share',
      subtitle: 'Send report via text, email, or apps',
      color: '#6B30C7',
      bg: '#F2EDFD',
    },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      {/* Backdrop */}
      <Pressable
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' }}
        onPress={exportState === 'loading' ? undefined : onClose}
      />
      {/* Sheet */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: '#FDFAF7',
          borderTopLeftRadius: 32,
          borderTopRightRadius: 32,
          paddingBottom: insets.bottom + 16,
          maxHeight: '85%',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -6 },
          shadowOpacity: 0.12,
          shadowRadius: 28,
          elevation: 24,
        }}
      >
          {/* Handle */}
          <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 6 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#DDD5C8' }} />
          </View>

          {/* Header row */}
          <View style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            paddingHorizontal: 24,
            paddingTop: 14,
            paddingBottom: 18,
            borderBottomWidth: 1,
            borderBottomColor: '#EDE7DE',
          }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: '#111111', letterSpacing: -0.4 }}>Export Report</Text>
              <Text style={{ fontSize: 13, color: '#666666', marginTop: 3, lineHeight: 18 }}>Choose a format</Text>
            </View>
            {exportState !== 'loading' && (
              <Pressable
                onPress={onClose}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  backgroundColor: '#EDE7DE',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginLeft: 12,
                  marginTop: 2,
                }}
              >
                <X size={15} color="#5A5450" />
              </Pressable>
            )}
          </View>

          {/* Scrollable body: status + action cards */}
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingTop: 20, paddingHorizontal: 20, paddingBottom: 8, gap: 11 }}
          >
            {/* Status feedback */}
            {exportState === 'success' && (
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                backgroundColor: '#EDFAF2',
                borderRadius: 14,
                padding: 14,
                borderWidth: 1,
                borderColor: '#B6E8CC',
                marginBottom: 4,
              }}>
                <CheckCircle size={18} color="#16a34a" />
                <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: '#15803d', lineHeight: 19 }}>
                  {exportType === 'pdf' ? 'PDF created — share sheet is open!' :
                   exportType === 'csv' ? 'CSV exported — share sheet is open!' :
                   'Report shared successfully!'}
                </Text>
              </View>
            )}

            {exportState === 'error' && (
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                backgroundColor: '#FEF2F2',
                borderRadius: 14,
                padding: 14,
                borderWidth: 1,
                borderColor: '#FECACA',
                marginBottom: 4,
              }}>
                <AlertCircle size={18} color="#DC2626" />
                <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: '#DC2626', lineHeight: 19 }}>
                  {errorMessage || 'Export failed. Please try again.'}
                </Text>
              </View>
            )}

            {/* Action cards — one card per row */}
            {actions.map((action) => {
              const isRowLoading = exportState === 'loading' && exportType === action.type;
              const isDisabled = exportState === 'loading';

              return (
                <Pressable
                  key={action.type}
                  onPress={() => !isDisabled && onExport(action.type)}
                  disabled={isDisabled}
                  style={({ pressed }) => ({
                    opacity: isDisabled && !isRowLoading ? 0.45 : pressed ? 0.75 : 1,
                  })}
                >
                  <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    minHeight: 72,
                    backgroundColor: '#F8F5F1',
                    borderRadius: 16,
                  }}>
                    {/* Icon bubble */}
                    <View style={{
                      width: 46,
                      height: 46,
                      borderRadius: 13,
                      backgroundColor: action.bg,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      {isRowLoading ? (
                        <ActivityIndicator size="small" color={action.color} />
                      ) : (
                        <action.icon size={22} color={action.color} strokeWidth={2} />
                      )}
                    </View>

                    {/* Text block */}
                    <View style={{ flex: 1, marginLeft: 14, marginRight: 8 }}>
                      <Text style={{
                          fontSize: 16,
                          fontWeight: '700',
                          color: '#111111',
                          letterSpacing: -0.3,
                          marginBottom: 3,
                        }}>
                          {action.label}
                        </Text>
                      <Text style={{
                        fontSize: 13,
                        color: '#7A7268',
                        lineHeight: 18,
                      }}>
                        {action.subtitle}
                      </Text>
                    </View>

                    {/* Chevron */}
                    {!isRowLoading && (
                      <ChevronRight size={18} color="#C4BAB0" strokeWidth={2.5} />
                    )}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────
// Main ReportsTab
// ─────────────────────────────────────────────

export function ReportsTab({
  farmstandId,
  farmstandName,
  dateRange,
  onDateRangeChange,
}: ReportsTabProps) {
  const [report, setReport] = useState<FarmstandReportData | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [exportType, setExportType] = useState<ExportType | null>(null);
  const [exportError, setExportError] = useState('');

  // Preview modal state
  const [pdfPreviewVisible, setPdfPreviewVisible] = useState(false);
  const [csvPreviewVisible, setCsvPreviewVisible] = useState(false);
  const [previewExportState, setPreviewExportState] = useState<ExportState>('idle');
  const [previewActiveAction, setPreviewActiveAction] = useState<'export' | 'share' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, inv] = await Promise.all([
        buildFarmstandReportData(farmstandId, farmstandName, dateRange.preset),
        fetchInventory(farmstandId),
      ]);
      setReport(data);
      setInventory(inv);
    } finally {
      setLoading(false);
    }
  }, [farmstandId, farmstandName, dateRange.preset]);

  useEffect(() => {
    load();
  }, [load]);

  const handleOpenSheet = useCallback(() => {
    if (__DEV__) console.log('[FarmstandManager ExportReportSheet] button pressed');
    setExportState('idle');
    setExportError('');
    setExportType(null);
    setSheetVisible(true);
  }, []);

  // Called from the export sheet — open preview for pdf/csv, share immediately
  const handleSheetAction = useCallback((type: ExportType) => {
    if (type === 'pdf') {
      setSheetVisible(false);
      setTimeout(() => {
        setPdfPreviewVisible(true);
        setPreviewExportState('idle');
      }, 260);
    } else if (type === 'csv') {
      setSheetVisible(false);
      setTimeout(() => {
        setCsvPreviewVisible(true);
        setPreviewExportState('idle');
      }, 260);
    } else {
      // Share — run immediately like before
      if (!report) return;
      setExportState('loading');
      setExportType('share');
      setExportError('');
      shareReportText(report)
        .then(() => {
          setExportState('success');
          setTimeout(() => {
            setSheetVisible(false);
            setExportState('idle');
          }, 1800);
        })
        .catch(() => {
          setExportState('error');
          setExportError('Something went wrong. Please try again.');
        });
    }
  }, [report]);

  // Called from inside the PDF preview modal — Export button
  const handlePdfExport = useCallback(async () => {
    if (!report) return;
    setPreviewActiveAction('export');
    setPreviewExportState('loading');
    const result = await exportToPdf(report, inventory);
    if (result.success) {
      setPreviewExportState('success');
      setTimeout(() => {
        setPdfPreviewVisible(false);
        setPreviewExportState('idle');
        setPreviewActiveAction(null);
      }, 1200);
    } else {
      setPreviewExportState('error');
      setPreviewActiveAction(null);
    }
  }, [report, inventory]);

  // Called from inside the PDF preview modal — Share button
  const handlePdfShare = useCallback(async () => {
    if (!report) return;
    setPreviewActiveAction('share');
    setPreviewExportState('loading');
    const result = await exportToPdf(report, inventory);
    if (result.success) {
      setPreviewExportState('idle');
      setPreviewActiveAction(null);
    } else {
      setPreviewExportState('error');
      setPreviewActiveAction(null);
    }
  }, [report, inventory]);

  // Called from inside the CSV preview modal — Export button
  const handleCsvExport = useCallback(async () => {
    if (!report) return;
    setPreviewActiveAction('export');
    setPreviewExportState('loading');
    const result = await exportToCsv(report, inventory);
    if (result.success) {
      setPreviewExportState('success');
      setTimeout(() => {
        setCsvPreviewVisible(false);
        setPreviewExportState('idle');
        setPreviewActiveAction(null);
      }, 1200);
    } else {
      setPreviewExportState('error');
      setPreviewActiveAction(null);
    }
  }, [report, inventory]);

  // Called from inside the CSV preview modal — Share button
  const handleCsvShare = useCallback(async () => {
    if (!report) return;
    setPreviewActiveAction('share');
    setPreviewExportState('loading');
    const result = await exportToCsv(report, inventory);
    if (result.success) {
      setPreviewExportState('idle');
      setPreviewActiveAction(null);
    } else {
      setPreviewExportState('error');
      setPreviewActiveAction(null);
    }
  }, [report, inventory]);

  const pdfHtml = report ? buildPdfHtml(report, inventory) : '';

  const netProfitColor = report
    ? (report.summary.netProfit >= 0 ? '#2D5A3D' : '#DC2626')
    : '#2D5A3D';

  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: '#FAF7F2' }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: '#FAF7F2' }}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {/* Date range selector */}
        <View className="px-4 pt-4 pb-2">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ gap: 8 }}
          >
            {DATE_PRESETS.map((preset) => (
              <Pressable
                key={preset}
                onPress={() => onDateRangeChange(preset)}
                className="rounded-full px-4 py-2"
                style={{
                  backgroundColor: dateRange.preset === preset ? '#2D5A3D' : '#E8DDD4',
                }}
              >
                <Text
                  className="text-sm font-semibold"
                  style={{ color: dateRange.preset === preset ? '#FAF7F2' : '#5A5A5A' }}
                >
                  {DATE_RANGE_LABELS[preset]}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* REPORT CARD — page-like */}
        <View className="mx-4 mt-3">
          <View
            style={{
              backgroundColor: 'white',
              borderRadius: 24,
              overflow: 'hidden',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.10,
              shadowRadius: 20,
              elevation: 8,
            }}
          >
            {/* Report Header — forest green */}
            <View style={{ backgroundColor: '#2D5A3D', paddingHorizontal: 24, paddingTop: 28, paddingBottom: 24 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <View style={{
                  width: 28,
                  height: 28,
                  borderRadius: 7,
                  backgroundColor: 'rgba(255,255,255,0.15)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <BarChart3 size={14} color="white" />
                </View>
                <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)' }}>
                  Business Report
                </Text>
              </View>

              <Text style={{ fontSize: 24, fontWeight: '800', color: 'white', letterSpacing: -0.5, marginBottom: 4 }}>
                {farmstandName}
              </Text>
              <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>
                {loading ? 'Loading...' : DATE_RANGE_LABELS[dateRange.preset]}
                {report && (
                  <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
                    {'  ·  '}
                    {new Date(report.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                )}
              </Text>
            </View>

            {/* Summary Grid */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {[
                { label: 'Revenue', value: report?.summary.revenue ?? 0, color: '#2D5A3D', icon: DollarSign },
                { label: 'Expenses', value: report?.summary.expenses ?? 0, color: '#DC2626', icon: TrendingDown },
                { label: 'Net Profit', value: report?.summary.netProfit ?? 0, color: netProfitColor, icon: TrendingUp },
                { label: 'Inventory', value: report?.summary.inventoryValue ?? 0, color: '#D97706', icon: Package },
              ].map((card, i) => (
                <View
                  key={card.label}
                  style={{
                    width: '50%',
                    padding: 18,
                    borderRightWidth: i % 2 === 0 ? 1 : 0,
                    borderBottomWidth: i < 2 ? 1 : 0,
                    borderColor: '#F0EBE3',
                  }}
                >
                  {loading ? (
                    <>
                      <ManagerShimmer width={60} height={10} borderRadius={5} />
                      <View style={{ marginTop: 8 }}>
                        <ManagerShimmer width={90} height={22} borderRadius={6} />
                      </View>
                    </>
                  ) : (
                    <>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                        <card.icon size={12} color={card.color} />
                        <Text style={{ fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, color: '#A0A0A0' }}>
                          {card.label}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 22, fontWeight: '800', color: card.color, letterSpacing: -0.5 }}>
                        {formatCurrency(card.value)}
                      </Text>
                    </>
                  )}
                </View>
              ))}
            </View>

            {/* Section: Top Sellers */}
            <View style={{ paddingHorizontal: 24, paddingVertical: 20, borderTopWidth: 6, borderTopColor: '#F9F6F1' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.5, color: '#A0A0A0' }}>
                  Top Selling Items
                </Text>
              </View>

              {loading ? (
                <View style={{ gap: 12 }}>
                  {[0, 1, 2].map((i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <ManagerShimmer width={24} height={24} borderRadius={6} />
                      <ManagerShimmer width={120} height={13} borderRadius={5} />
                      <View style={{ flex: 1 }} />
                      <ManagerShimmer width={64} height={14} borderRadius={5} />
                    </View>
                  ))}
                </View>
              ) : !report || report.topSellingItems.length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                  <ShoppingCart size={28} color="#D0C8C0" />
                  <Text style={{ fontSize: 13, color: '#C0B8B0', marginTop: 8, textAlign: 'center' }}>
                    No sales recorded for this period
                  </Text>
                </View>
              ) : (
                <View>
                  {report.topSellingItems.slice(0, 5).map((item, idx) => {
                    const maxRev = report.topSellingItems[0]?.totalRevenue ?? 1;
                    const pct = Math.max(8, (item.totalRevenue / maxRev) * 100);
                    return (
                      <View key={item.item_name}>
                        {idx > 0 && <View style={{ height: 1, backgroundColor: '#F9F6F1', marginVertical: 1 }} />}
                        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 }}>
                          <View style={{
                            width: 26,
                            height: 26,
                            borderRadius: 7,
                            backgroundColor: idx === 0 ? '#FEFCE8' : '#F5F1EC',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}>
                            <Text style={{
                              fontSize: 11,
                              fontWeight: '800',
                              color: idx === 0 ? '#CA8A04' : '#9A9090',
                            }}>
                              {idx + 1}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 14, fontWeight: '600', color: '#1A1A1A' }} numberOfLines={1}>
                              {item.item_name}
                            </Text>
                            <View style={{ marginTop: 4, height: 3, backgroundColor: '#F0EBE3', borderRadius: 2, overflow: 'hidden' }}>
                              <View style={{ width: `${pct}%`, height: '100%', backgroundColor: '#2D5A3D', borderRadius: 2 }} />
                            </View>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text style={{ fontSize: 14, fontWeight: '700', color: '#2D5A3D' }}>
                              {formatCurrency(item.totalRevenue)}
                            </Text>
                            <Text style={{ fontSize: 11, color: '#A0A0A0', marginTop: 1 }}>
                              qty: {item.totalQuantity}
                            </Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {/* Section: Expense Breakdown */}
            <View style={{ paddingHorizontal: 24, paddingVertical: 20, borderTopWidth: 6, borderTopColor: '#F9F6F1' }}>
              <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.5, color: '#A0A0A0', marginBottom: 14 }}>
                Expense Breakdown
              </Text>

              {loading ? (
                <View style={{ gap: 14 }}>
                  {[0, 1, 2].map((i) => (
                    <View key={i} style={{ gap: 6 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <ManagerShimmer width={80} height={12} borderRadius={4} />
                        <ManagerShimmer width={52} height={12} borderRadius={4} />
                      </View>
                      <ManagerShimmer width="100%" height={5} borderRadius={3} />
                    </View>
                  ))}
                </View>
              ) : !report || report.expenseBreakdown.length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                  <Receipt size={28} color="#D0C8C0" />
                  <Text style={{ fontSize: 13, color: '#C0B8B0', marginTop: 8 }}>
                    No expenses for this period
                  </Text>
                </View>
              ) : (
                <View style={{ gap: 14 }}>
                  {report.expenseBreakdown.map((eb) => (
                    <View key={eb.category}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <Text style={{ fontSize: 14, fontWeight: '500', color: '#1A1A1A' }}>{eb.label}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ fontSize: 12, color: '#A0A0A0' }}>{eb.percentage}%</Text>
                          <Text style={{ fontSize: 14, fontWeight: '700', color: '#DC2626' }}>
                            {formatCurrency(eb.total)}
                          </Text>
                        </View>
                      </View>
                      <View style={{ height: 5, backgroundColor: '#F5F1EC', borderRadius: 3, overflow: 'hidden' }}>
                        <View style={{ width: `${eb.percentage}%`, height: '100%', backgroundColor: '#DC2626', borderRadius: 3 }} />
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Section: Recent Transactions */}
            <View style={{ paddingHorizontal: 24, paddingVertical: 20, borderTopWidth: 6, borderTopColor: '#F9F6F1' }}>
              <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.5, color: '#A0A0A0', marginBottom: 14 }}>
                Recent Transactions
              </Text>

              {loading ? (
                <View style={{ gap: 14 }}>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <ManagerShimmer width={34} height={34} borderRadius={17} />
                      <View style={{ flex: 1, gap: 5 }}>
                        <ManagerShimmer width={140} height={12} borderRadius={4} />
                        <ManagerShimmer width={72} height={10} borderRadius={4} />
                      </View>
                      <ManagerShimmer width={58} height={14} borderRadius={5} />
                    </View>
                  ))}
                </View>
              ) : !report || report.recentActivity.length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                  <RefreshCw size={28} color="#D0C8C0" />
                  <Text style={{ fontSize: 13, color: '#C0B8B0', marginTop: 8 }}>
                    No transactions recorded
                  </Text>
                </View>
              ) : (
                <View>
                  {report.recentActivity.slice(0, 10).map((activity, idx) => (
                    <View key={activity.id}>
                      {idx > 0 && <View style={{ height: 1, backgroundColor: '#F9F6F1' }} />}
                      <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 }}>
                        <View style={{
                          width: 34,
                          height: 34,
                          borderRadius: 17,
                          backgroundColor: activity.type === 'sale' ? '#F0FDF4' : '#FEF2F2',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          {activity.type === 'sale' ? (
                            <ShoppingCart size={14} color="#16a34a" />
                          ) : (
                            <Receipt size={14} color="#DC2626" />
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontWeight: '500', color: '#1A1A1A' }} numberOfLines={1}>
                            {activity.label}
                          </Text>
                          <Text style={{ fontSize: 11, color: '#A0A0A0', marginTop: 2 }}>
                            {formatRelativeDate(activity.timestamp)}
                          </Text>
                        </View>
                        {activity.amount != null && (
                          <Text style={{
                            fontSize: 14,
                            fontWeight: '700',
                            color: activity.type === 'sale' ? '#2D5A3D' : '#DC2626',
                          }}>
                            {activity.type === 'sale' ? '+' : '-'}{formatCurrency(activity.amount)}
                          </Text>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={{ height: 20 }} />
          </View>
        </View>

      </ScrollView>

      {/* Fixed bottom Export CTA */}
      <View style={{
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: Math.max(insets.bottom, 12),
        backgroundColor: '#F7F5F2',
        borderTopWidth: 1,
        borderTopColor: '#EDE8E0',
      }}>
        <Pressable
          onPress={handleOpenSheet}
          disabled={loading || !report}
          style={({ pressed }) => ({ opacity: pressed ? 0.82 : 1 })}
        >
          <View style={{
            height: 58,
            borderRadius: 29,
            backgroundColor: loading || !report ? '#7EA88E' : '#1F4D36',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            shadowColor: '#1A3D2B',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: loading || !report ? 0 : 0.28,
            shadowRadius: 12,
            elevation: loading || !report ? 0 : 6,
          }}>
            <Download size={20} color="#FFFFFF" strokeWidth={2.5} />
            <Text style={{
              fontSize: 17,
              fontWeight: '700',
              color: '#FFFFFF',
              letterSpacing: -0.2,
            }}>
              Export Report
            </Text>
          </View>
        </Pressable>
      </View>

      <ExportSheet
        visible={sheetVisible}
        onClose={() => exportState !== 'loading' && setSheetVisible(false)}
        onExport={handleSheetAction}
        exportState={exportState}
        exportType={exportType}
        errorMessage={exportError}
      />

      {/* PDF Preview Modal */}
      {report && (
        <PdfPreviewModal
          visible={pdfPreviewVisible}
          onClose={() => {
            setPdfPreviewVisible(false);
            setPreviewExportState('idle');
            setPreviewActiveAction(null);
          }}
          onExport={handlePdfExport}
          onShare={handlePdfShare}
          html={pdfHtml}
          exportState={previewExportState}
          activeAction={previewActiveAction}
        />
      )}

      {/* CSV Preview Modal */}
      {report && (
        <CsvPreviewModal
          visible={csvPreviewVisible}
          onClose={() => {
            setCsvPreviewVisible(false);
            setPreviewExportState('idle');
            setPreviewActiveAction(null);
          }}
          onExport={handleCsvExport}
          onShare={handleCsvShare}
          report={report}
          inventory={inventory}
          exportState={previewExportState}
          activeAction={previewActiveAction}
        />
      )}
    </View>
  );
}
