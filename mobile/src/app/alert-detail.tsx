import React, { useCallback, useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  ChevronLeft, Trash2,
  CheckCircle, XCircle, Bell, Star, Flag,
  AlertTriangle, EyeOff, Megaphone, Award, Clock,
  TrendingDown, ShieldAlert, ShieldCheck, Info,
  MessageSquare, Store, Wrench,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useAlertsStore } from '@/lib/alerts-store';
import type { Alert, AlertType } from '@/lib/alerts-store';
import { getValidSession, getSupabaseUrl, isSupabaseConfigured } from '@/lib/supabase';

// ─── Constants ────────────────────────────────────────────────────────────────
const FOREST = '#2D5A3D';
const CREAM = '#FDF8F3';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true when the alert is for a denied or deleted farmstand — cases where
 * the farmstand no longer exists and "View Farmstand" would navigate to a dead page.
 */
function isDeniedFarmstandAlert(alert: Alert): boolean {
  const titleLower = (alert.title ?? '').toLowerCase();
  const bodyLower  = (alert.body  ?? '').toLowerCase();
  const meta = (alert as unknown as Record<string, unknown>).metadata as Record<string, unknown> | null | undefined;

  // Explicit metadata flags set by the deny flow
  if (meta?.status === 'denied' || meta?.farmstand_status === 'denied' ||
      meta?.farmstand_status === 'deleted') return true;

  // Title / body copy from the deny alert creation
  if (titleLower.includes('denied') || titleLower.includes('rejected') ||
      titleLower.includes('not approved')) return true;
  if (bodyLower.includes('has been denied') || bodyLower.includes('was denied') ||
      bodyLower.includes('has been rejected')) return true;

  // Alert type used for hidden/removed listings
  if (alert.type === 'listing_hidden') return true;

  return false;
}

function getAccentColor(type: AlertType | null): string {
  switch (type) {
    case 'claim_approved':
    case 'premium_approved':
    case 'report_resolved':   return '#10B981';
    case 'claim_denied':
    case 'listing_flagged':
    case 'listing_hidden':
    case 'premium_expired':   return '#EF4444';
    case 'claim_more_info':
    case 'claim_request':
    case 'listing_attention':
    case 'premium_downgraded':
    case 'report_received':   return '#F59E0B';
    case 'review_new':        return '#8B5CF6';
    case 'review_reply':      return '#D4943A';
    case 'platform_announcement':
    case 'app_notice':
    case 'info':              return '#3B82F6';
    case 'message':           return FOREST;
    case 'farmstand_update':  return '#A8906E';
    case 'action_required':   return '#F59E0B';
    default:                  return '#6B7280';
  }
}

function getTypeLabel(type: AlertType | null): string {
  switch (type) {
    case 'claim_approved':    return 'Claim Approved';
    case 'claim_denied':      return 'Claim Denied';
    case 'claim_more_info':   return 'More Info Needed';
    case 'claim_request':     return 'Claim Request';
    case 'review_new':        return 'New Review';
    case 'review_reply':      return 'Owner Reply';
    case 'listing_flagged':   return 'Listing Flagged';
    case 'listing_attention': return 'Attention Needed';
    case 'listing_hidden':    return 'Listing Hidden';
    case 'platform_announcement': return 'Announcement';
    case 'premium_approved':  return 'Premium Active';
    case 'premium_expired':   return 'Premium Expired';
    case 'premium_downgraded':return 'Premium Changed';
    case 'report_received':   return 'Report';
    case 'report_resolved':   return 'Report Resolved';
    case 'app_notice':        return 'Notice';
    case 'message':           return 'Message';
    case 'farmstand_update':  return 'Stand Update';
    case 'info':              return 'Info';
    case 'action_required':   return 'Action Required';
    default:                  return 'Alert';
  }
}

function AlertIcon({ type, size = 32, color }: { type: AlertType | null; size?: number; color: string }) {
  const props = { size, color };
  switch (type) {
    case 'claim_approved':    return <CheckCircle {...props} />;
    case 'claim_denied':      return <XCircle {...props} />;
    case 'claim_more_info':   return <MessageSquare {...props} />;
    case 'claim_request':     return <Bell {...props} />;
    case 'review_new':        return <Star {...props} />;
    case 'review_reply':      return <MessageSquare {...props} />;
    case 'listing_flagged':   return <Flag {...props} />;
    case 'listing_attention': return <AlertTriangle {...props} />;
    case 'listing_hidden':    return <EyeOff {...props} />;
    case 'platform_announcement': return <Megaphone {...props} />;
    case 'premium_approved':  return <Award {...props} />;
    case 'premium_expired':   return <Clock {...props} />;
    case 'premium_downgraded':return <TrendingDown {...props} />;
    case 'report_received':   return <ShieldAlert {...props} />;
    case 'report_resolved':   return <ShieldCheck {...props} />;
    case 'app_notice':
    case 'info':              return <Info {...props} />;
    case 'message':           return <MessageSquare {...props} />;
    case 'farmstand_update':  return <Store {...props} />;
    case 'action_required':   return <Wrench {...props} />;
    default:                  return <Bell {...props} />;
  }
}

function formatFullDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function AlertDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const alerts = useAlertsStore(s => s.alerts);
  const deleteAlert = useAlertsStore(s => s.deleteAlert);

  // Primary lookup from the Zustand store
  const alertFromStore = alerts.find(a => a.id === id);

  // Fallback: fetch directly from Supabase if the alert isn't in the store yet
  // (handles timing races where the store hasn't loaded when this screen mounts)
  const [fetchedAlert, setFetchedAlert] = useState<Alert | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  useEffect(() => {
    if (alertFromStore || !id || isFetching) return;
    // Alert not in store — attempt a direct Supabase fetch
    const fetch_ = async () => {
      setIsFetching(true);
      try {
        if (!isSupabaseConfigured()) return;
        const session = await getValidSession();
        if (!session?.access_token) return;
        const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
        const url = `${getSupabaseUrl()}/rest/v1/inbox_alerts?id=eq.${encodeURIComponent(id)}&select=*&limit=1`;
        const resp = await fetch(url, {
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        if (resp.ok) {
          const rows = (await resp.json()) as Alert[];
          if (rows.length > 0) setFetchedAlert(rows[0]);
        }
      } catch {
        // Silently ignore — fallback UI will show below
      } finally {
        setIsFetching(false);
      }
    };
    fetch_();
  }, [id, alertFromStore, isFetching]);

  const alert = alertFromStore ?? fetchedAlert;

  const handleDismiss = useCallback(() => {
    if (!id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    deleteAlert(id);
    router.back();
  }, [id, deleteAlert, router]);

  const farmstandId = alert?.related_farmstand_id ?? alert?.farmstand_id ?? null;
  // Claim ID stored in action_params when the deny-claim backend sets it; fallback to null
  const claimIdFromAlert = (alert?.action_params as Record<string, string> | null)?.claim_id ?? null;
  const showViewFarmstand = !!farmstandId && !!alert && !isDeniedFarmstandAlert(alert);
  const showUpdateClaim = !!farmstandId && alert?.type === 'claim_denied';

  const handleViewFarmstand = useCallback(() => {
    if (!farmstandId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/farm/${farmstandId}`);
  }, [farmstandId, router]);

  const handleUpdateClaim = useCallback(() => {
    if (!farmstandId) return;
    const claimParam = claimIdFromAlert ? `&claimId=${claimIdFromAlert}` : '';
    console.log('[AlertDetail] claim_denied — routing to claim resubmit screen for farmstand:', farmstandId, 'claimId:', claimIdFromAlert);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/farm/${farmstandId}?openClaimModal=true&claimMode=resubmit${claimParam}`);
  }, [farmstandId, claimIdFromAlert, router]);

  if (!alert) {
    return (
      <View style={{ flex: 1, backgroundColor: CREAM }}>
        <SafeAreaView edges={['top']}>
          <Pressable onPress={() => router.back()} style={{ padding: 16 }}>
            <ChevronLeft size={24} color="#78716C" />
          </Pressable>
        </SafeAreaView>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          {isFetching ? (
            <ActivityIndicator size="large" color="#2D5A3D" />
          ) : (
            <>
              <Bell size={40} color="#A8A29E" style={{ marginBottom: 16 }} />
              <Text style={{ fontSize: 17, fontWeight: '600', color: '#44403C', textAlign: 'center', marginBottom: 8 }}>
                Alert Unavailable
              </Text>
              <Text style={{ fontSize: 14, color: '#A8A29E', textAlign: 'center', lineHeight: 20, marginBottom: 28 }}>
                This alert could not be loaded. It may have been dismissed or is no longer available.
              </Text>
              <Pressable
                onPress={() => router.back()}
                style={{
                  paddingVertical: 12, paddingHorizontal: 28,
                  backgroundColor: '#2D5A3D', borderRadius: 20,
                }}
              >
                <Text style={{ color: '#FDF8F3', fontWeight: '600', fontSize: 15 }}>Go Back</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  }

  console.log('[AlertDetail] selected alert:', { id: alert.id, type: alert.type, title: alert.title, body: alert.body });

  const accentColor = getAccentColor(alert.type);
  const typeLabel = getTypeLabel(alert.type);
  // Use only the stored body for this alert. Fall back to message only if body is absent.
  // Never combine both fields — doing so caused denial text from a different alert to appear.
  const bodyText = alert.body || alert.message || '';

  return (
    <View style={{ flex: 1, backgroundColor: CREAM }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: CREAM }}>
        {/* Header */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 8, paddingVertical: 4,
        }}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={{ padding: 10, borderRadius: 20 }}
          >
            <ChevronLeft size={24} color="#44403C" />
          </Pressable>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#44403C' }}>Alert</Text>
          <Pressable
            onPress={handleDismiss}
            hitSlop={12}
            style={{ padding: 10, borderRadius: 20 }}
          >
            <Trash2 size={20} color="#C7BDB4" />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero icon block */}
        <Animated.View
          entering={FadeInDown.delay(60).duration(380)}
          style={{ alignItems: 'center', paddingTop: 36, paddingBottom: 28 }}
        >
          {/* Outer glow ring */}
          <View style={{
            width: 92, height: 92, borderRadius: 46,
            backgroundColor: `${accentColor}12`,
            alignItems: 'center', justifyContent: 'center',
            marginBottom: 18,
          }}>
            <View style={{
              width: 72, height: 72, borderRadius: 36,
              backgroundColor: `${accentColor}20`,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <AlertIcon type={alert.type} size={32} color={accentColor} />
            </View>
          </View>

          {/* Type badge */}
          <View style={{
            backgroundColor: `${accentColor}15`,
            borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4,
            marginBottom: 12,
          }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: accentColor, letterSpacing: 0.4 }}>
              {typeLabel.toUpperCase()}
            </Text>
          </View>

          {/* Title */}
          <Text style={{
            fontSize: 22, fontWeight: '700', color: '#1C1917',
            textAlign: 'center', paddingHorizontal: 28, lineHeight: 28,
          }}>
            {alert.title}
          </Text>

          {/* Timestamp */}
          <Text style={{ fontSize: 13, color: '#A8A29E', marginTop: 8 }}>
            {formatFullDate(alert.created_at)}
          </Text>
        </Animated.View>

        {/* Divider */}
        <View style={{ height: 1, backgroundColor: '#EDE8E0', marginHorizontal: 24 }} />

        {/* Body */}
        <Animated.View
          entering={FadeInDown.delay(120).duration(380)}
          style={{
            marginHorizontal: 20, marginTop: 24,
            backgroundColor: '#FFFFFF',
            borderRadius: 16, padding: 20,
            borderWidth: 1, borderColor: '#EDE8E0',
            shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
          }}
        >
          {!!bodyText && (
            <Text style={{ fontSize: 15, color: '#44403C', lineHeight: 24 }}>
              {bodyText}
            </Text>
          )}
        </Animated.View>

        {/* ── Action row ─────────────────────────────────────────────── */}
        <View style={[styles.actionRow, (!showViewFarmstand && !showUpdateClaim) && styles.actionRowCentered]}>
          {showUpdateClaim && (
            <Pressable style={styles.updateClaimTab} onPress={handleUpdateClaim}>
              <Text style={styles.updateClaimText}>Update Claim</Text>
            </Pressable>
          )}

          {!showUpdateClaim && showViewFarmstand && (
            <Pressable style={styles.updateClaimTab} onPress={handleViewFarmstand}>
              <Text style={styles.updateClaimText}>View Farmstand</Text>
            </Pressable>
          )}

          <Pressable
            style={(showViewFarmstand || showUpdateClaim) ? styles.dismissAlertTab : styles.dismissAlertTabSolo}
            onPress={handleDismiss}
          >
            <Text style={styles.dismissAlertText}>Dismiss Alert</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: 24,
    marginTop: 20,
    gap: 12,
  },
  actionRowCentered: {
    justifyContent: 'center',
  },
  updateClaimTab: {
    flex: 1,
    height: 52,
    borderRadius: 999,
    backgroundColor: '#2F5D3A',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  updateClaimText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  dismissAlertTab: {
    flex: 1,
    height: 52,
    borderRadius: 999,
    backgroundColor: '#F5F0E8',
    borderWidth: 1.5,
    borderColor: '#C9B99A',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  dismissAlertTabSolo: {
    height: 48,
    borderRadius: 999,
    backgroundColor: '#F5F0E8',
    borderWidth: 1.5,
    borderColor: '#C9B99A',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    paddingHorizontal: 40,
    minWidth: 180,
  },
  dismissAlertText: {
    color: '#5C5348',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});
