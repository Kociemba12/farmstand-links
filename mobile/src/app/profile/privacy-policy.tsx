import React from 'react';
import { View, Text, ScrollView, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, ExternalLink } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { settingsStyles, settingsColors } from '@/lib/settings-styles';

const PRIVACY_POLICY_URL = 'https://farmstand.app/privacy';

export default function PrivacyPolicyScreen() {
  const router = useRouter();

  const handleOpenExternal = () => {
    Linking.openURL(PRIVACY_POLICY_URL);
  };

  return (
    <View style={settingsStyles.pageContainer}>
      {/* Header */}
      <SafeAreaView edges={['top']} style={settingsStyles.header}>
        <View style={settingsStyles.headerContent}>
          <Pressable onPress={() => router.back()} style={settingsStyles.headerBackButton}>
            <ArrowLeft size={22} color={settingsColors.headerText} />
          </Pressable>
          <Text style={settingsStyles.headerTitle}>Privacy Policy</Text>
          <Pressable onPress={handleOpenExternal} style={settingsStyles.headerRightButton}>
            <ExternalLink size={20} color={settingsColors.headerText} />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={settingsStyles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Content Card */}
        <View style={settingsStyles.card}>
          <Text style={settingsStyles.readingMeta}>Last updated: January 2025</Text>

          <Text style={settingsStyles.readingTitle}>Farmstand Privacy Policy</Text>

          <Text style={settingsStyles.readingHeading}>1. Information We Collect</Text>
          <Text style={settingsStyles.readingBody}>
            We collect information you provide directly, including your name, email address,
            location data, and farm stand preferences. We also collect usage data to improve your
            experience.
          </Text>

          <Text style={settingsStyles.readingHeading}>2. How We Use Your Information</Text>
          <Text style={settingsStyles.readingBody}>
            We use your information to provide personalized farm stand recommendations, process your
            reviews and favorites, send relevant notifications, and improve our services.
          </Text>

          <Text style={settingsStyles.readingHeading}>3. Location Data</Text>
          <Text style={settingsStyles.readingBody}>
            With your permission, we collect location data to show nearby farm stands and provide
            distance information. You can disable location access in your device settings.
          </Text>

          <Text style={settingsStyles.readingHeading}>4. Data Sharing</Text>
          <Text style={settingsStyles.readingBody}>
            We do not sell your personal information. We may share data with service providers who
            help us operate the app, and when required by law.
          </Text>

          <Text style={settingsStyles.readingHeading}>5. Data Security</Text>
          <Text style={settingsStyles.readingBody}>
            We implement industry-standard security measures to protect your information. However,
            no method of transmission over the internet is 100% secure.
          </Text>

          <Text style={settingsStyles.readingHeading}>6. Your Rights</Text>
          <Text style={settingsStyles.readingBody}>
            You have the right to access, correct, or delete your personal information. You can
            manage your data through the Settings page or contact us directly.
          </Text>

          <Text style={settingsStyles.readingHeading}>7. Contact Us</Text>
          <Text style={settingsStyles.readingBody}>
            If you have questions about this Privacy Policy, please contact us at
            privacy@farmstand.app.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
