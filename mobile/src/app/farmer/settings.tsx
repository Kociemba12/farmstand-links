import React from 'react';
import { View, Text, ScrollView, Pressable, Switch, Alert, Linking } from 'react-native';

const PRIVACY_POLICY_URL = 'https://farmstand.online/privacy-policy';
const TERMS_OF_SERVICE_URL = 'https://farmstand.online/terms-of-service';

function openLegalUrl(url: string) {
  Linking.openURL(url).catch((e) => console.warn('[FarmerSettings] openURL failed', e));
}
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Bell,
  Shield,
  HelpCircle,
  LogOut,
  ChevronRight,
  Store,
  CreditCard,
  FileText,
  LucideIcon,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useUserStore } from '@/lib/user-store';
import * as Haptics from 'expo-haptics';

interface ToggleSettingItem {
  icon: LucideIcon;
  label: string;
  description: string;
  type: 'toggle';
  value: boolean;
  onToggle: (v: boolean) => void;
}

interface LinkSettingItem {
  icon: LucideIcon;
  label: string;
  description: string;
  type: 'link';
  onPress: () => void;
}

type SettingItem = ToggleSettingItem | LinkSettingItem;

interface SettingsSection {
  title: string;
  items: SettingItem[];
}

export default function FarmerSettingsScreen() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const setFarmerStatus = useUserStore((s) => s.setFarmerStatus);

  const [notificationsEnabled, setNotificationsEnabled] = React.useState(true);
  const [emailAlerts, setEmailAlerts] = React.useState(true);

  const handleBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  const handleToggle = async (
    setter: React.Dispatch<React.SetStateAction<boolean>>,
    value: boolean
  ) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setter(value);
  };

  const handleDeactivateListing = () => {
    Alert.alert(
      'Deactivate Listing',
      'Are you sure you want to deactivate your farm stand listing? It will no longer be visible to customers.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate',
          style: 'destructive',
          onPress: async () => {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            // Deactivate logic would go here
            Alert.alert('Listing Deactivated', 'Your listing has been hidden from customers.');
          },
        },
      ]
    );
  };

  const handleStopBeingFarmer = () => {
    Alert.alert(
      'Stop Being a Farmer',
      'Are you sure you want to remove your farmer status? You can always re-register later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            await setFarmerStatus(false, undefined);
            router.replace('/(tabs)/profile');
          },
        },
      ]
    );
  };

  const SETTINGS_SECTIONS: SettingsSection[] = [
    {
      title: 'Notifications',
      items: [
        {
          icon: Bell,
          label: 'Push Notifications',
          description: 'Get alerts for new reviews and messages',
          type: 'toggle' as const,
          value: notificationsEnabled,
          onToggle: (v: boolean) => handleToggle(setNotificationsEnabled, v),
        },
        {
          icon: Bell,
          label: 'Email Alerts',
          description: 'Receive email notifications',
          type: 'toggle' as const,
          value: emailAlerts,
          onToggle: (v: boolean) => handleToggle(setEmailAlerts, v),
        },
      ],
    },
    {
      title: 'Account',
      items: [
        {
          icon: Store,
          label: 'Business Profile',
          description: 'Edit your business information',
          type: 'link' as const,
          onPress: () => router.push('/profile/edit-profile'),
        },
        {
          icon: CreditCard,
          label: 'Payment Settings',
          description: 'Manage payment methods',
          type: 'link' as const,
          onPress: () => Alert.alert('Coming Soon', 'Payment settings will be available soon.'),
        },
      ],
    },
    {
      title: 'Support',
      items: [
        {
          icon: HelpCircle,
          label: 'Help & FAQ',
          description: 'Get help with your account',
          type: 'link' as const,
          onPress: () => router.push('/profile/help'),
        },
        {
          icon: FileText,
          label: 'Terms of Service',
          description: 'View terms and conditions',
          type: 'link' as const,
          onPress: () => openLegalUrl(TERMS_OF_SERVICE_URL),
        },
        {
          icon: Shield,
          label: 'Privacy Policy',
          description: 'View privacy policy',
          type: 'link' as const,
          onPress: () => openLegalUrl(PRIVACY_POLICY_URL),
        },
      ],
    },
  ];

  return (
    <View className="flex-1 bg-cream">
      <SafeAreaView edges={['top']} className="bg-forest">
        <View className="flex-row items-center px-4 py-4">
          <Pressable onPress={handleBack} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#FDF8F3" />
          </Pressable>
          <Text className="text-cream text-xl font-bold ml-2">Farmer Settings</Text>
        </View>
      </SafeAreaView>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="px-5 py-6">
          {/* User Info */}
          <View className="bg-white rounded-2xl p-4 border border-sand mb-6">
            <View className="flex-row items-center">
              <View className="w-14 h-14 rounded-full bg-forest items-center justify-center">
                <Text className="text-cream font-bold text-xl">{user?.initials || 'F'}</Text>
              </View>
              <View className="ml-4 flex-1">
                <Text className="text-charcoal font-bold text-lg">{user?.name || 'Farmer'}</Text>
                <Text className="text-wood">{user?.email || 'farmer@example.com'}</Text>
                <View className="flex-row items-center mt-1">
                  <View className="bg-forest/10 px-2 py-0.5 rounded-full">
                    <Text className="text-forest text-xs font-medium">Verified Farmer</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>

          {/* Settings Sections */}
          {SETTINGS_SECTIONS.map((section) => (
            <View key={section.title} className="mb-6">
              <Text className="text-charcoal font-bold text-lg mb-3">{section.title}</Text>
              <View className="bg-white rounded-2xl overflow-hidden border border-sand">
                {section.items.map((item, index) => (
                  <Pressable
                    key={item.label}
                    onPress={item.type === 'link' ? item.onPress : undefined}
                    className={`flex-row items-center px-4 py-4 ${
                      index !== section.items.length - 1 ? 'border-b border-sand' : ''
                    } ${item.type === 'link' ? 'active:bg-sand/30' : ''}`}
                  >
                    <View className="w-10 h-10 rounded-full bg-cream items-center justify-center">
                      <item.icon size={20} color="#2D5A3D" />
                    </View>
                    <View className="ml-3 flex-1">
                      <Text className="text-charcoal font-medium">{item.label}</Text>
                      <Text className="text-wood text-sm">{item.description}</Text>
                    </View>
                    {item.type === 'toggle' && (
                      <Switch
                        value={item.value}
                        onValueChange={item.onToggle}
                        trackColor={{ false: '#C4B5A4', true: '#7FB069' }}
                        thumbColor="#FDF8F3"
                      />
                    )}
                    {item.type === 'link' && <ChevronRight size={20} color="#8B6F4E" />}
                  </Pressable>
                ))}
              </View>
            </View>
          ))}

          {/* Danger Zone */}
          <Text className="text-charcoal font-bold text-lg mb-3">Danger Zone</Text>
          <View className="bg-white rounded-2xl overflow-hidden border border-terracotta/30">
            <Pressable
              onPress={handleDeactivateListing}
              className="flex-row items-center px-4 py-4 border-b border-sand active:bg-terracotta/10"
            >
              <View className="w-10 h-10 rounded-full bg-terracotta/10 items-center justify-center">
                <Store size={20} color="#C4653A" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-terracotta font-medium">Deactivate Listing</Text>
                <Text className="text-wood text-sm">Temporarily hide your farm stand</Text>
              </View>
            </Pressable>
            <Pressable
              onPress={handleStopBeingFarmer}
              className="flex-row items-center px-4 py-4 active:bg-terracotta/10"
            >
              <View className="w-10 h-10 rounded-full bg-terracotta/10 items-center justify-center">
                <LogOut size={20} color="#C4653A" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-terracotta font-medium">Stop Being a Farmer</Text>
                <Text className="text-wood text-sm">Remove your farmer status</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
