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

interface UserNotificationPrefs {
  id?: string;
  user_id: string;
  messages: boolean;
  new_farmstands: boolean;
  seasonal_products: boolean;
  saved_farm_updates: boolean;
  promotions: boolean;
  app_updates: boolean;
  created_at?: string;
  updated_at?: string;
}

type ToggleKey = 'messages' | 'saved_farm_updates' | 'app_updates' | 'promotions';

const DEFAULT_SETTINGS: Omit<UserNotificationPrefs, 'user_id'> = {
  messages: true,
  new_farmstands: true,
  seasonal_products: true,
  saved_farm_updates: true,
  promotions: false,
  app_updates: true,
};

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
    key: 'saved_farm_updates',
    icon: Bookmark,
    iconColor: '#4A7C59',
    iconBg: '#EDF4EF',
    title: 'Saved Farmstand Updates',
    subtitle: 'Updates from farmstands you have saved.',
  },
  {
    key: 'app_updates',
    icon: ShieldAlert,
    iconColor: '#4A7C59',
    iconBg: '#EDF4EF',
    title: 'Admin Critical',
    subtitle: 'Important account and policy updates.',
  },
  {
    key: 'promotions',
    icon: Megaphone,
    iconColor: '#4A7C59',
    iconBg: '#EDF4EF',
    title: 'Admin Promotions',
    subtitle: 'Optional promotions and announcements.',
  },
];

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [settings, setSettings] = useState<UserNotificationPrefs | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (user?.id && user.id !== 'guest') {
        fetchSettings();
      } else {
        setIsLoading(false);
      }
    }, [user?.id])
  );

  const fetchSettings = async () => {
    if (!user?.id || user.id === 'guest') return;
    setIsLoading(true);

    try {
      const { data, error } = await supabase
        .from<UserNotificationPrefs>('user_notification_prefs')
        .select('*')
        .eq('user_id', user.id)
        .execute();

      if (error) {
        setSettings({ user_id: user.id, ...DEFAULT_SETTINGS });
        return;
      }

      if (data && data.length > 0) {
        setSettings(data[0]);
      } else {
        const newSettings: UserNotificationPrefs = { user_id: user.id, ...DEFAULT_SETTINGS };
        const { data: insertedData, error: insertError } = await supabase
          .from<UserNotificationPrefs>('user_notification_prefs')
          .insert(newSettings as unknown as Record<string, unknown>)
          .select('*')
          .execute();

        if (insertError) {
          if (insertError.message?.includes('duplicate') || insertError.message?.includes('23505')) {
            const { data: refetchedData } = await supabase
              .from<UserNotificationPrefs>('user_notification_prefs')
              .select('*')
              .eq('user_id', user.id)
              .execute();
            setSettings(refetchedData?.[0] ?? newSettings);
          } else {
            setSettings(newSettings);
          }
        } else {
          setSettings(insertedData?.[0] ?? newSettings);
        }
      }
    } catch {
      setSettings({ user_id: user.id, ...DEFAULT_SETTINGS });
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggle = async (key: ToggleKey) => {
    if (!settings || !user?.id || user.id === 'guest') return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const newValue = !settings[key];
    setSettings((prev) => prev ? { ...prev, [key]: newValue } : prev);

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from<UserNotificationPrefs>('user_notification_prefs')
        .update({ [key]: newValue })
        .eq('user_id', user.id)
        .execute();

      if (error) {
        setSettings((prev) => prev ? { ...prev, [key]: !newValue } : prev);
      }
    } catch {
      setSettings((prev) => prev ? { ...prev, [key]: !newValue } : prev);
    } finally {
      setIsSaving(false);
    }
  };

  // — Guest state —
  if (!user || user.id === 'guest') {
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
          <Text style={styles.headerTitle}>Notifications</Text>
          {isSaving && (
            <ActivityIndicator
              size="small"
              color="#4A7C59"
              style={styles.savingIndicator}
            />
          )}
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

          {/* Toggle card */}
          <View style={styles.card}>
            {TOGGLE_ITEMS.map((item, index) => {
              const Icon = item.icon;
              const isEnabled = settings?.[item.key] ?? DEFAULT_SETTINGS[item.key];
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

                    {/* Toggle */}
                    <Switch
                      value={isEnabled}
                      onValueChange={() => handleToggle(item.key)}
                      trackColor={{ false: '#E2E8E2', true: '#4A7C59' }}
                      thumbColor="#FFFFFF"
                      ios_backgroundColor="#E2E8E2"
                    />
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
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  backButton: {
    alignSelf: 'flex-start',
    padding: 2,
    marginLeft: -2,
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#2C2420',
    letterSpacing: -0.3,
    marginLeft: 0,
    flex: 1,
  },
  savingIndicator: {
    marginBottom: 2,
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
