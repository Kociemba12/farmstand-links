import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Linking, Alert, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { settingsStyles, settingsColors } from '@/lib/settings-styles';

const emailLinkStyle = { color: settingsColors.primary, textDecorationLine: 'underline' as const };
const CONTACT_EMAIL = 'contact@farmstand.online';

async function openMailto(email: string) {
  const url = `mailto:${email}`;
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
    } else {
      Alert.alert('Email not available', `Email is not available on this device. Please email ${email}.`);
    }
  } catch {
    Alert.alert('Email not available', `Email is not available on this device. Please email ${email}.`);
  }
}

export default function PrivacyPolicyScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const cardWidth = width - 40;
  const innerWidth = cardWidth - 32;

  // Wait one animation frame so the layout engine has resolved card/inner widths
  // before text is painted. This prevents first-render clipping.
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setIsReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <View style={settingsStyles.pageContainer}>
      {/* Header */}
      <SafeAreaView edges={['top']} style={settingsStyles.header}>
        <View style={settingsStyles.headerContent}>
          <Pressable onPress={() => router.back()} style={settingsStyles.headerBackButton}>
            <ArrowLeft size={22} color={settingsColors.headerText} />
          </Pressable>
          <Text style={settingsStyles.headerTitle}>Privacy Policy</Text>
          <View style={settingsStyles.headerRightButton} />
        </View>
      </SafeAreaView>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[settingsStyles.card, { paddingBottom: 48, flexDirection: 'column', width: cardWidth }]}>
          <View style={{ width: innerWidth, flexDirection: 'column' }}>
          {isReady ? (<>
          <Text style={settingsStyles.readingMeta}>Last updated: January 2026</Text>

          <Text style={settingsStyles.readingTitle}>Farmstand Privacy Policy</Text>

          <Text style={settingsStyles.readingBody}>
            Farmstand is built to connect people with local farmstands. This Privacy Policy explains what information is collected, how it is used, and the choices available when using the Farmstand app.
          </Text>

          {/* Section 1 */}
          <Text style={settingsStyles.readingHeading}>1. Information We Collect</Text>
          <Text style={settingsStyles.readingBody}>
            We collect information you provide directly when using Farmstand, including:
          </Text>
          <Text style={settingsStyles.readingBody}>
            {'• Account information (such as your name and email address)\n'}
            {'• Profile details and farmstand listings you create\n'}
            {'• Photos, descriptions, and other content you upload\n'}
            {'• Messages sent through the app\n'}
            {'• Reviews, ratings, and interactions'}
          </Text>
          <Text style={settingsStyles.readingBody}>
            We may also collect limited technical data automatically, including:
          </Text>
          <Text style={settingsStyles.readingBody}>
            {'• Location data (only if you enable location access)\n'}
            {'• Usage data (such as features used and interactions)\n'}
            {'• Device information (such as device type and operating system)'}
          </Text>
          <Text style={settingsStyles.readingBody}>
            Farmstand does NOT collect or store payment information. All payments and subscriptions are processed securely through Apple's App Store.
          </Text>

          {/* Section 2 */}
          <Text style={settingsStyles.readingHeading}>2. How We Use Your Information</Text>
          <Text style={settingsStyles.readingBody}>
            We use your information to operate and improve Farmstand, including:
          </Text>
          <Text style={settingsStyles.readingBody}>
            {'• Connecting users with local farmstands\n'}
            {'• Displaying listings and map-based results\n'}
            {'• Enabling messaging between users and farmstand owners\n'}
            {'• Processing reviews, favorites, and interactions\n'}
            {'• Managing farmstand ownership claims\n'}
            {'• Sending notifications, alerts, and updates\n'}
            {'• Improving app performance and user experience\n'}
            {'• Complying with legal obligations'}
          </Text>

          {/* Section 3 */}
          <Text style={settingsStyles.readingHeading}>3. Location Data</Text>
          <Text style={settingsStyles.readingBody}>
            If you choose to enable location services, we use your location to:
          </Text>
          <Text style={settingsStyles.readingBody}>
            {'• Show nearby farmstands\n'}
            {'• Provide distance-based results\n'}
            {'• Improve map functionality'}
          </Text>
          <Text style={settingsStyles.readingBody}>
            You can turn off location access at any time in your device settings.
          </Text>

          {/* Section 4 */}
          <Text style={settingsStyles.readingHeading}>4. Data Sharing</Text>
          <Text style={settingsStyles.readingBody}>
            We do not sell your personal information.
          </Text>
          <Text style={settingsStyles.readingBody}>
            We may share limited information in the following cases:
          </Text>
          <Text style={settingsStyles.readingBody}>
            {'• With service providers that help operate the app (such as hosting, analytics, and infrastructure)\n'}
            {'• With other users, only for information you choose to make public (such as listings and profile details)\n'}
            {'• If required by law or to protect the safety and integrity of the platform'}
          </Text>

          {/* Section 5 */}
          <Text style={settingsStyles.readingHeading}>5. Data Security</Text>
          <Text style={settingsStyles.readingBody}>
            We use industry-standard security measures to protect your information.
          </Text>
          <Text style={settingsStyles.readingBody}>
            However, no method of transmission over the internet or electronic storage is completely secure, and we cannot guarantee absolute security.
          </Text>

          {/* Section 6 */}
          <Text style={settingsStyles.readingHeading}>6. Your Choices & Rights</Text>
          <Text style={settingsStyles.readingBody}>
            You have control over your information.
          </Text>
          <Text style={[settingsStyles.readingBody, { marginTop: 10 }]}>
            You may:
          </Text>
          <Text style={[settingsStyles.readingBody, { marginTop: 6 }]}>
            {'• Update or correct your account information at any time\n'}
            {'• Request deletion of your account and associated data\n'}
            {'• Opt out of notifications\n'}
            {'• Disable location access through your device settings'}
          </Text>
          <Text style={settingsStyles.readingBody}>
            To request account deletion or access to your data, contact us at:
          </Text>
          <Pressable onPress={() => openMailto(CONTACT_EMAIL)}>
            <Text style={[settingsStyles.readingBody, emailLinkStyle]}>contact@farmstand.online</Text>
          </Pressable>

          {/* Section 7 */}
          <Text style={settingsStyles.readingHeading}>7. Push Notifications & Alerts</Text>
          <Text style={settingsStyles.readingBody}>
            Farmstand may send optional notifications, including:
          </Text>
          <Text style={settingsStyles.readingBody}>
            {'• Messages from other users\n'}
            {'• Product or inventory updates\n'}
            {'• Claim approvals or denials\n'}
            {'• Platform announcements'}
          </Text>
          <Text style={settingsStyles.readingBody}>
            You can disable notifications at any time in your device settings.
          </Text>

          {/* Section 8 */}
          <Text style={settingsStyles.readingHeading}>8. Data Retention</Text>
          <Text style={settingsStyles.readingBody}>
            We retain your information only as long as necessary to:
          </Text>
          <Text style={settingsStyles.readingBody}>
            {'• Provide and maintain our services\n'}
            {'• Support platform functionality\n'}
            {'• Comply with legal obligations'}
          </Text>
          <Text style={settingsStyles.readingBody}>
            When you delete your account, we remove your personal information from active systems within a reasonable timeframe.
          </Text>
          <Text style={settingsStyles.readingBody}>
            In some cases, we may retain limited information where required for legal, regulatory, tax, accounting, fraud prevention, or dispute-resolution purposes.
          </Text>

          {/* Section 9 */}
          <Text style={settingsStyles.readingHeading}>9. Children's Privacy</Text>
          <Text style={settingsStyles.readingBody}>
            Farmstand is intended for use by adults and individuals managing or supporting local farmstands.
          </Text>
          <Text style={settingsStyles.readingBody}>
            We do not knowingly collect personal information from children. If we become aware that information has been provided by a child, we will delete it.
          </Text>
          <Text style={settingsStyles.readingBody}>
            If you have any concerns, please contact us at:
          </Text>
          <Pressable onPress={() => openMailto(CONTACT_EMAIL)}>
            <Text style={[settingsStyles.readingBody, emailLinkStyle]}>contact@farmstand.online</Text>
          </Pressable>

          {/* Section 10 */}
          <Text style={settingsStyles.readingHeading}>10. Changes to This Policy</Text>
          <Text style={settingsStyles.readingBody}>
            We may update this Privacy Policy from time to time. When we do, we will update the "Last updated" date within the app.
          </Text>

          {/* Section 11 */}
          <Text style={settingsStyles.readingHeading}>11. Contact Us</Text>
          <Text style={settingsStyles.readingBody}>
            If you have any questions about this Privacy Policy, you can contact us at:
          </Text>
          <Pressable onPress={() => openMailto(CONTACT_EMAIL)}>
            <Text style={[settingsStyles.readingBody, emailLinkStyle]}>contact@farmstand.online</Text>
          </Pressable>
          </>) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
