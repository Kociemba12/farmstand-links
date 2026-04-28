import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Modal,
  StyleSheet,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, ExternalLink } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

const TERMS_URL = 'https://farmstand.app/terms';
const PRIVACY_URL = 'https://farmstand.app/privacy';

// Colors matching settings-styles
const colors = {
  pageBackground: '#F7F6F3',
  cardBackground: '#FFFFFF',
  headerBackground: '#2F6F4E',
  headerText: '#FFFFFF',
  textPrimary: '#1C1C1C',
  textMuted: 'rgba(0,0,0,0.45)',
};

type LegalType = 'terms' | 'privacy';

interface LegalModalProps {
  visible: boolean;
  type: LegalType;
  onClose: () => void;
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletSymbol}>{'\u2022'}</Text>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

// Terms of Service content — keep in sync with mobile/src/app/profile/terms.tsx
function TermsContent() {
  return (
    <>
      <Text style={styles.meta}>Last updated: January 2025</Text>
      <Text style={styles.title}>Farmstand Terms of Service</Text>

      <Text style={styles.heading}>1. Acceptance of Terms</Text>
      <Text style={styles.body}>
        By using Farmstand, you agree to these Terms of Service. If you do not agree, please do
        not use the app.
      </Text>

      <Text style={styles.heading}>2. Use of Service</Text>
      <Text style={styles.body}>
        Farmstand provides a platform to discover local farm stands. You may use the service for
        personal, non-commercial purposes. You agree not to misuse the service or help anyone
        else do so.
      </Text>

      <Text style={styles.heading}>3. User Content</Text>
      <Text style={styles.body}>
        You may post reviews, photos, and other content. You retain ownership of your content
        but grant us a license to use it within the app. You are responsible for ensuring your
        content is accurate and does not violate others' rights.
      </Text>

      <Text style={styles.heading}>4. Farm Stand Listings</Text>
      <Text style={styles.body}>
        Farm stand information is provided by farmers and users. We do not guarantee the
        accuracy of listings, hours, products, or prices. Always verify information directly
        with the farm stand.
      </Text>

      <Text style={styles.heading}>5. Farmstand Claims & Ownership</Text>
      <Text style={styles.body}>
        Users may submit and claim farmstand listings. By submitting a claim:
      </Text>
      <Bullet text="You represent that you are the rightful owner or authorized representative of the farmstand." />
      <Bullet text="All submitted information must be accurate and truthful." />
      <Bullet text="Farmstand reserves the right to approve or deny any claim at its sole discretion." />
      <Text style={styles.body}>
        Approval of a claim grants access to management features but does not transfer ownership
        of the platform or listing data.
      </Text>

      <Text style={styles.heading}>6. Community Guidelines</Text>
      <Text style={styles.body}>
        Be respectful in reviews and interactions. Do not post false, misleading, or harmful
        content. Violations may result in account suspension.
      </Text>

      <Text style={styles.heading}>7. Limitation of Liability</Text>
      <Text style={styles.body}>
        Farmstand is provided "as is" without warranties. We are not liable for any damages
        arising from your use of the service.
      </Text>
      <Text style={styles.body}>
        To the fullest extent permitted by law, Farmstand shall not be liable for:
      </Text>
      <Bullet text="Loss of business, revenue, or profits" />
      <Bullet text="Product quality or safety issues" />
      <Bullet text="User disputes or transactions" />
      <Bullet text="Platform interruptions or data loss" />

      <Text style={styles.heading}>8. Changes to Terms</Text>
      <Text style={styles.body}>
        We may update these terms from time to time. Continued use after changes constitutes
        acceptance of the new terms.
      </Text>

      <Text style={styles.heading}>9. Premium Subscription</Text>
      <Text style={styles.body}>
        Farmstand offers optional premium subscriptions for approved farmstand owners. Premium
        may include enhanced features such as analytics, messaging, expanded listings, and
        promotional tools. A free trial period of 3 months is offered to approved farmstand owners. After the trial
        period, the subscription will automatically renew unless canceled.
      </Text>
      <Text style={styles.body}>
        Billing:
      </Text>
      <Bullet text="All subscriptions are processed through Apple's App Store." />
      <Bullet text="Payment will be charged to your Apple ID account." />
      <Bullet text="Subscriptions automatically renew unless canceled at least 24 hours before the end of the billing period." />
      <Text style={styles.body}>
        Cancellation:
      </Text>
      <Bullet text="You may manage or cancel your subscription in your Apple account settings." />
      <Bullet text="No refunds are provided except as required by Apple or applicable law." />

      <Text style={styles.heading}>10. Promotions & Boosts</Text>
      <Text style={styles.body}>
        Farmstand may offer paid promotional features ("Boosts") to increase visibility.
      </Text>
      <Text style={styles.body}>
        By purchasing a Boost:
      </Text>
      <Bullet text="Placement is not guaranteed to be exclusive or top-ranked at all times." />
      <Bullet text="Boosts may rotate among other promoted listings." />
      <Bullet text="Boost duration is time-based (e.g., 30 days)." />
      <Bullet text="No guarantee of views, traffic, or sales is provided." />
      <Text style={styles.body}>
        Boost purchases are final and non-refundable unless required by law.
      </Text>

      <Text style={styles.heading}>11. Messaging & User Interactions</Text>
      <Text style={styles.body}>
        Farmstand may provide messaging or communication tools between users and farmstand owners.
      </Text>
      <Bullet text="Farmstand does not guarantee responses or outcomes from communications." />
      <Bullet text="Users are responsible for their own interactions." />
      <Bullet text="Farmstand is not liable for disputes, transactions, or agreements between users." />

      <Text style={styles.heading}>12. Push Notifications</Text>
      <Text style={styles.body}>
        By using Farmstand, you may receive notifications related to:
      </Text>
      <Bullet text="Messages" />
      <Bullet text="Product updates" />
      <Bullet text="Claim status updates" />
      <Bullet text="Platform announcements" />
      <Text style={styles.body}>
        You may manage notification preferences in your device settings.
      </Text>

      <Text style={styles.heading}>13. Marketplace and Food Sales Disclaimer</Text>
      <Text style={styles.body}>
        Farmstand is an online platform that connects consumers with local farms, farmstands,
        and independent producers. Farmstand does not produce, store, handle, inspect,
        distribute, or sell any food or agricultural products listed on the platform.
      </Text>
      <Text style={styles.body}>
        All products listed on Farmstand are offered directly by independent sellers. Each
        seller is solely responsible for the accuracy of their listings and for ensuring that
        their products comply with all applicable local, state, and federal laws, regulations,
        and food safety requirements.
      </Text>
      <Text style={styles.body}>
        By listing products on Farmstand, sellers represent and warrant that they have the
        legal right to sell the products listed and that such products comply with all applicable
        food safety, labeling, inspection, and licensing requirements in their jurisdiction.
      </Text>
      <Text style={styles.body}>
        Consumers acknowledge that Farmstand does not verify or guarantee the safety, quality,
        legality, or condition of any products listed by sellers. Consumers purchase and consume
        products listed on the platform at their own discretion and risk.
      </Text>
      <Text style={styles.body}>
        Farmstand makes no warranties or representations regarding any products offered by
        sellers and disclaims any liability arising from the sale, consumption, or use of
        products listed on the platform.
      </Text>
      <Text style={styles.body}>
        Any transaction conducted through Farmstand is solely between the buyer and the seller.
        Farmstand is not a party to such transactions and assumes no responsibility for disputes,
        product safety, or regulatory compliance related to any listing or sale.
      </Text>
      <Text style={styles.body}>
        Farmstand acts solely as a technology platform and is not a party to any transaction
        between buyers and sellers. Farmstand does not:
      </Text>
      <Bullet text="Handle payments between users" />
      <Bullet text="Store or distribute products" />
      <Bullet text="Inspect or verify food safety, licensing, or compliance" />
      <Text style={styles.body}>
        Users acknowledge that all purchases and interactions are conducted at their own risk.
      </Text>

      <Text style={styles.heading}>14. Contact</Text>
      <Text style={styles.body}>
        Questions about these terms? Contact us at contact@farmstand.online.
      </Text>
    </>
  );
}

// Privacy Policy content — keep in sync with mobile/src/app/profile/privacy-policy.tsx
function PrivacyContent() {
  return (
    <>
      <Text style={styles.meta}>Last updated: January 2025</Text>
      <Text style={styles.title}>Farmstand Privacy Policy</Text>

      <Text style={styles.heading}>1. Information We Collect</Text>
      <Text style={styles.body}>
        We collect information you provide directly to us, including:
      </Text>
      <Bullet text="Account information (name, email)" />
      <Bullet text="Location data (if enabled)" />
      <Bullet text="User-generated content (listings, photos, messages)" />
      <Bullet text="Usage data (app interactions, analytics)" />
      <Bullet text="Subscription and purchase status (via Apple)" />
      <Text style={styles.body}>
        Farmstand does NOT collect or store payment information. All payment processing is
        handled directly by Apple's App Store.
      </Text>

      <Text style={styles.heading}>2. How We Use Your Information</Text>
      <Text style={styles.body}>
        We use your information to provide personalized farm stand recommendations, process your
        reviews and favorites, and improve our services. Specifically, we use your data:
      </Text>
      <Bullet text="To operate premium features and subscriptions" />
      <Bullet text="To enable messaging between users" />
      <Bullet text="To send alerts and push notifications" />
      <Bullet text="To improve platform performance and analytics" />
      <Bullet text="To verify farmstand ownership claims" />
      <Bullet text="To comply with legal obligations" />

      <Text style={styles.heading}>3. Location Data</Text>
      <Text style={styles.body}>
        With your permission, we collect location data to show nearby farm stands and provide
        distance information. You can disable location access in your device settings.
      </Text>

      <Text style={styles.heading}>4. Data Sharing</Text>
      <Text style={styles.body}>
        We do not sell personal data.
      </Text>
      <Text style={styles.body}>
        We may share limited data with:
      </Text>
      <Bullet text="Service providers (hosting, analytics, infrastructure)" />
      <Bullet text="Legal authorities if required by law" />
      <Bullet text="Other users only through public profile or listing information" />

      <Text style={styles.heading}>5. Data Security</Text>
      <Text style={styles.body}>
        We implement industry-standard security measures to protect your information. However,
        no method of transmission over the internet is 100% secure.
      </Text>

      <Text style={styles.heading}>6. Your Rights</Text>
      <Text style={styles.body}>
        You have the right to access, correct, or delete your personal information. You can
        manage your data through the Settings page or contact us directly. Specifically, you may:
      </Text>
      <Bullet text="Update or delete account information" />
      <Bullet text="Request account deletion" />
      <Bullet text="Opt out of notifications" />

      <Text style={styles.heading}>7. Push Notifications & Alerts</Text>
      <Text style={styles.body}>
        Farmstand may send push notifications for:
      </Text>
      <Bullet text="Messages" />
      <Bullet text="Inventory or product updates" />
      <Bullet text="Claim approvals or denials" />
      <Bullet text="Platform announcements" />
      <Text style={styles.body}>
        Notifications are optional and can be disabled in your device settings.
      </Text>

      <Text style={styles.heading}>8. Data Retention</Text>
      <Text style={styles.body}>
        We retain data only as long as necessary to:
      </Text>
      <Bullet text="Provide our services" />
      <Bullet text="Maintain platform functionality" />
      <Bullet text="Comply with legal obligations" />
      <Text style={styles.body}>
        When you delete your account, we will remove your personal information from active
        systems within a reasonable timeframe, subject to any legal retention requirements.
      </Text>

      <Text style={styles.heading}>9. Account & Data Control</Text>
      <Text style={styles.body}>
        You are in control of your data. You may:
      </Text>
      <View style={styles.bulletRow}>
        <Text style={styles.bulletSymbol}>{'\u2022'}</Text>
        <Text style={styles.bulletText}>Update or correct your account information at any time in Settings</Text>
      </View>
      <View style={styles.bulletRow}>
        <Text style={styles.bulletSymbol}>{'\u2022'}</Text>
        <Text style={styles.bulletText}>Request deletion of your account and associated data</Text>
      </View>
      <View style={styles.bulletRow}>
        <Text style={styles.bulletSymbol}>{'\u2022'}</Text>
        <Text style={styles.bulletText}>Opt out of marketing or promotional notifications</Text>
      </View>
      <View style={styles.bulletRow}>
        <Text style={styles.bulletSymbol}>{'\u2022'}</Text>
        <Text style={styles.bulletText}>Disable location access through your device settings</Text>
      </View>
      <Text style={styles.body}>
        To request account deletion or a copy of your data, contact us at privacy@farmstand.app.
      </Text>

      <Text style={styles.heading}>10. Children's Privacy</Text>
      <Text style={styles.body}>
        Farmstand is not intended for users under the age of 13. We do not knowingly collect
        personal information from children under 13. If we become aware that a child under 13
        has provided us with personal information, we will delete it promptly.
      </Text>

      <Text style={styles.heading}>11. Contact Us</Text>
      <Text style={styles.body}>
        If you have questions about this Privacy Policy, please contact us at
        privacy@farmstand.app.
      </Text>
    </>
  );
}

export function LegalModal({ visible, type, onClose }: LegalModalProps) {
  const isTerms = type === 'terms';
  const title = isTerms ? 'Terms of Service' : 'Privacy Policy';
  const externalUrl = isTerms ? TERMS_URL : PRIVACY_URL;

  const handleOpenExternal = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Linking.openURL(externalUrl);
  };

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView style={styles.container} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={handleClose} style={styles.closeButton} hitSlop={8}>
            <X size={24} color={colors.headerText} />
          </Pressable>
          <Text style={styles.headerTitle}>{title}</Text>
          <Pressable onPress={handleOpenExternal} style={styles.externalButton} hitSlop={8}>
            <ExternalLink size={22} color={colors.headerText} />
          </Pressable>
        </View>

        {/* Content */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            {isTerms ? <TermsContent /> : <PrivacyContent />}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.pageBackground,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.headerBackground,
  },
  closeButton: {
    padding: 8,
    marginLeft: -8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.headerText,
  },
  externalButton: {
    padding: 8,
    marginRight: -8,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: 18,
    padding: 16,
    shadowColor: 'rgba(0,0,0,0.05)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 2,
  },
  meta: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 16,
  },
  heading: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 16,
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    lineHeight: 24,
    color: 'rgba(0,0,0,0.78)',
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
    marginBottom: 8,
  },
  bulletSymbol: {
    width: 16,
    fontSize: 15,
    lineHeight: 24,
    color: 'rgba(0,0,0,0.78)',
    marginRight: 6,
  },
  bulletText: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    fontSize: 15,
    lineHeight: 24,
    color: 'rgba(0,0,0,0.78)',
  },
});
