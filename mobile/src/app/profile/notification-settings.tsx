import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Switch,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  MessageSquare,
  Bookmark,
  ShieldAlert,
  Megaphone,
} from 'lucide-react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useUserStore } from '@/lib/user-store';
import { supabase } from '@/lib/supabase';
import * as Haptics from 'expo-haptics';

interface NotificationPrefs {
  user_id: string;
  messages: boolean;
  saved_updates: boolean;
  admin_critical: boolean;
  admin_promotions: boolean;
  updated_at: string;
}

type ToggleKey = 'messages' | 'saved_updates' | 'admin_critical' | 'admin_promotions';

const TOGGLE_ITEMS: Array<{
  key: ToggleKey;
  icon: typeof MessageSquare;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
}> = [
  {
    key: 'messages',
    icon: MessageSquare,
    iconColor: '#4A7C59',
    iconBg: '#EDF4EF',
    title: 'Messages',
    subtitle: 'Get notified when someone messages you.',
  },
  {
    key: 'saved_updates',
    icon: Bookmark,
    iconColor: '#4A7C59',
    iconBg: '#EDF4EF',
    title: 'Saved Farmstand Updates',
    subtitle: 'Updates from farmstands you have saved.',
  },
  {
    key: 'admin_critical',
    icon: ShieldAlert,
    iconColor: '#4A7C59',
    iconBg: '#EDF4EF',
    title: 'Admin Critical',
    subtitle: 'Important account and policy updates.',
  },
  {
    key: 'admin_promotions',
    icon: Megaphone,
    iconColor: '#4A7C59',
    iconBg: '#EDF4EF',
    title: 'Admin Promotions',
    subtitle: 'Optional promotions and announcements.',
  },
];

// Fetch the prefs row for a user — returns null on error or not found
// .requireAuth() forces the session token (not anon key) so RLS lets us read our own row
async function fetchRowFromDB(userId: string): Promise<NotificationPrefs | null> {
  const { data, error } = await supabase
    .from<NotificationPrefs>('notification_preferences')
    .requireAuth()
    .select('*')
    .eq('user_id', userId);

  if (error) {
    console.log('[NotificationSettings] DB fetch error:', error.message);
    return null;
  }

  const row = (data && data.length > 0) ? data[0] : null;
  console.log('[NotificationSettings] DB fetch result for', userId, ':', row);
  return row;
}

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);

  // Re-runs on EVERY screen focus (useFocusEffect calls the callback every time)
  useFocusEffect(
    useCallback(() => {
      const userId = user?.id;
      if (!userId || userId === 'guest') {
        setIsLoading(false);
        return;
      }
      loadPrefs(userId);
    }, [user?.id])
  );

  const loadPrefs = async (userId: string) => {
    setIsLoading(true);
    console.log('[NotificationSettings] Screen focused — loading prefs for user:', userId);

    try {
      let row = await fetchRowFromDB(userId);

      if (!row) {
        // No row found — insert defaults
        const defaultPrefs: NotificationPrefs = {
          user_id: userId,
          messages: true,
          saved_updates: true,
          admin_critical: true,
          admin_promotions: false,
          updated_at: new Date().toISOString(),
        };

        console.log('[NotificationSettings] No row found — inserting defaults:', defaultPrefs);

        const { data: inserted, error: insertError } = await supabase
          .from<NotificationPrefs>('notification_preferences')
          .insert(defaultPrefs as unknown as Record<string, unknown>);

        if (insertError) {
          console.log('[NotificationSettings] Insert default error:', insertError.message);
          // Insert may have failed due to a race (row appeared after our select).
          // Try fetching again.
          row = await fetchRowFromDB(userId);
          if (!row) {
            // Worst case: render with in-memory defaults so screen isn't stuck
            console.log('[NotificationSettings] Using in-memory defaults as fallback');
            setPrefs(defaultPrefs);
            return;
          }
        } else {
          const insertedRow = inserted?.[0] ?? null;
          console.log('[NotificationSettings] Inserted default prefs row:', insertedRow);
          // Re-fetch to get the canonical DB state
          row = await fetchRowFromDB(userId);
          if (!row) {
            row = insertedRow ?? defaultPrefs;
          }
        }
      }

      console.log('[NotificationSettings] Final prefs used to render switches:', row);
      setPrefs(row);
    } catch (err) {
      console.log('[NotificationSettings] Unexpected load error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggle = async (key: ToggleKey) => {
    if (!prefs || !user?.id || user.id === 'guest') return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const userId = user.id as string;
    const previousValue = prefs[key] as boolean;
    const newValue = !previousValue;

    console.log('[NotificationSettings] Toggle', key, ':', previousValue, '->', newValue);

    // Optimistic update for immediate UI response
    setPrefs((prev) => (prev ? { ...prev, [key]: newValue } : prev));

    setIsSaving(true);
    try {
      const { data: updateData, error: updateError } = await supabase
        .from<NotificationPrefs>('notification_preferences')
        .update({ [key]: newValue, updated_at: new Date().toISOString() } as Record<string, unknown>)
        .eq('user_id', userId);

      if (updateError) {
        console.log('[NotificationSettings] Save error:', updateError.message);
        setPrefs((prev) => (prev ? { ...prev, [key]: previousValue } : prev));
        return;
      }

      // Empty array = 0 rows matched the WHERE clause — row doesn't exist yet
      if (!updateData || updateData.length === 0) {
        console.log('[NotificationSettings] Update hit 0 rows — inserting full row...');
        const fullRow: NotificationPrefs = {
          user_id: userId,
          messages: prefs.messages,
          saved_updates: prefs.saved_updates,
          admin_critical: prefs.admin_critical,
          admin_promotions: prefs.admin_promotions,
          updated_at: new Date().toISOString(),
          [key]: newValue,
        };

        const { error: insertError } = await supabase
          .from<NotificationPrefs>('notification_preferences')
          .insert(fullRow as unknown as Record<string, unknown>);

        if (insertError) {
          console.log('[NotificationSettings] Insert fallback error:', insertError.message);
          setPrefs((prev) => (prev ? { ...prev, [key]: previousValue } : prev));
          return;
        }
        console.log('[NotificationSettings] Insert fallback succeeded');
      } else {
        console.log('[NotificationSettings] Save success — rows updated:', updateData.length);
      }

      // Always re-fetch after save to lock in the DB-confirmed state
      const refreshed = await fetchRowFromDB(userId);
      if (refreshed) {
        console.log('[NotificationSettings] Post-save re-fetch:', refreshed);
        setPrefs(refreshed);
      } else {
        console.log('[NotificationSettings] Post-save re-fetch returned null — keeping optimistic state');
      }
    } catch (err) {
      console.log('[NotificationSettings] Unexpected save error:', err);
      setPrefs((prev) => (prev ? { ...prev, [key]: previousValue } : prev));
    } finally {
      setIsSaving(false);
    }
  };

  // — Guest / signed-out state —
  if (!user || !user.id || user.id === 'guest') {
    return (
      <View style={styles.page}>
        <SafeAreaView edges={['top']} style={styles.header}>
          <View style={styles.headerContent}>
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <ArrowLeft size={22} color="#4A7C59" />
            </Pressable>
            <Text style={styles.headerTitle}>Notifications</Text>
          </View>
        </SafeAreaView>

        <View style={styles.centeredState}>
          <Text style={styles.guestText}>
            Please sign in to manage your notification settings.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      {/* Header */}
      <SafeAreaView edges={['top']} style={styles.header}>
        <View style={styles.headerContent}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft size={22} color="#4A7C59" />
          </Pressable>
          <View style={styles.titleRow}>
            <Text style={styles.headerTitle}>Notifications</Text>
            {isSaving && (
              <ActivityIndicator
                size="small"
                color="#4A7C59"
                style={styles.savingIndicator}
              />
            )}
          </View>
        </View>
      </SafeAreaView>

      {isLoading ? (
        <View style={styles.centeredState}>
          <ActivityIndicator size="large" color="#4A7C59" />
          <Text style={styles.loadingText}>Loading settings…</Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Section label */}
          <Text style={styles.sectionLabel}>PUSH NOTIFICATIONS</Text>

          {/* Toggle card — only rendered once prefs is loaded from DB */}
          <View style={styles.card}>
            {TOGGLE_ITEMS.map((item, index) => {
              const Icon = item.icon;
              const isEnabled = prefs ? (prefs[item.key] as boolean) : false;
              const isLast = index === TOGGLE_ITEMS.length - 1;

              return (
                <View key={item.key}>
                  <View style={styles.row}>
                    {/* Icon bubble */}
                    <View style={[styles.iconBubble, { backgroundColor: item.iconBg }]}>
                      <Icon size={19} color={item.iconColor} strokeWidth={1.75} />
                    </View>

                    {/* Labels */}
                    <View style={styles.rowLabels}>
                      <Text style={styles.rowTitle}>{item.title}</Text>
                      <Text style={styles.rowSubtitle}>{item.subtitle}</Text>
                    </View>

                    {/* Switch — only rendered once prefs is non-null */}
                    {prefs !== null && (
                      <Switch
                        value={isEnabled}
                        onValueChange={() => handleToggle(item.key)}
                        trackColor={{ false: '#E2E8E2', true: '#4A7C59' }}
                        thumbColor="#FFFFFF"
                        ios_backgroundColor="#E2E8E2"
                      />
                    )}
                  </View>

                  {/* Divider */}
                  {!isLast && <View style={styles.divider} />}
                </View>
              );
            })}
          </View>

          {/* Footer note */}
          <Text style={styles.footerNote}>You can change these anytime.</Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#FDF8F3',
  },

  // Header — matches refreshed settings screens (light, not dark green)
  header: {
    backgroundColor: '#FDF8F3',
    borderBottomWidth: 1,
    borderBottomColor: '#EDE8E0',
  },
  headerContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 16,
  },
  backButton: {
    alignSelf: 'flex-start',
    padding: 2,
    marginLeft: -2,
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700' as const,
    color: '#2C2420',
    letterSpacing: -0.3,
  },
  savingIndicator: {
    marginLeft: 10,
  },

  // Scroll area
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 56,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A8906E',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginLeft: 2,
  },

  // Card
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    overflow: 'hidden',
  },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 16,
    minHeight: 72,
  },
  iconBubble: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowLabels: {
    flex: 1,
    marginLeft: 14,
    marginRight: 12,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2C2420',
    letterSpacing: -0.1,
  },
  rowSubtitle: {
    fontSize: 13,
    color: '#78716C',
    lineHeight: 18,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#F3EEE8',
    marginLeft: 74, // aligns with text, not icon
  },

  // States
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  loadingText: {
    fontSize: 14,
    color: '#A8906E',
    marginTop: 12,
  },
  guestText: {
    fontSize: 15,
    color: '#78716C',
    textAlign: 'center',
    lineHeight: 22,
  },

  // Footer
  footerNote: {
    fontSize: 13,
    color: '#A8906E',
    textAlign: 'center',
    marginTop: 20,
    letterSpacing: 0.1,
  },
});
