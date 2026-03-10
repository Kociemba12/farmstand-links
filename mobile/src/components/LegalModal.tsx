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

      <Text style={styles.heading}>5. Community Guidelines</Text>
      <Text style={styles.body}>
        Be respectful in reviews and interactions. Do not post false, misleading, or harmful
        content. Violations may result in account suspension.
      </Text>

      <Text style={styles.heading}>6. Limitation of Liability</Text>
      <Text style={styles.body}>
        Farmstand is provided "as is" without warranties. We are not liable for any damages
        arising from your use of the service.
      </Text>

      <Text style={styles.heading}>7. Changes to Terms</Text>
      <Text style={styles.body}>
        We may update these terms from time to time. Continued use after changes constitutes
        acceptance of the new terms.
      </Text>

      <Text style={styles.heading}>8. Marketplace and Food Sales Disclaimer</Text>
      <Text style={styles.body}>
        Farmstand is an online platform that connects consumers with local farms, farmstands, and independent producers. Farmstand does not produce, store, handle, inspect, distribute, or sell any food or agricultural products listed on the platform.
      </Text>
      <Text style={styles.body}>
        All products listed on Farmstand are offered directly by independent sellers. Each seller is solely responsible for the accuracy of their listings and for ensuring that their products comply with all applicable local, state, and federal laws, regulations, and food safety requirements.
      </Text>
      <Text style={styles.body}>
        By listing products on Farmstand, sellers represent and warrant that they have the legal right to sell the products listed and that such products comply with all applicable food safety, labeling, inspection, and licensing requirements in their jurisdiction.
      </Text>
      <Text style={styles.body}>
        Consumers acknowledge that Farmstand does not verify or guarantee the safety, quality, legality, or condition of any products listed by sellers. Consumers purchase and consume products listed on the platform at their own discretion and risk.
      </Text>
      <Text style={styles.body}>
        Farmstand makes no warranties or representations regarding any products offered by sellers and disclaims any liability arising from the sale, consumption, or use of products listed on the platform.
      </Text>
      <Text style={styles.body}>
        Any transaction conducted through Farmstand is solely between the buyer and the seller. Farmstand is not a party to such transactions and assumes no responsibility for disputes, product safety, or regulatory compliance related to any listing or sale.
      </Text>

      <Text style={styles.heading}>9. Contact</Text>
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
        We collect information you provide directly, including your name, email address,
        location data, and farm stand preferences. We also collect usage data to improve your
        experience.
      </Text>

      <Text style={styles.heading}>2. How We Use Your Information</Text>
      <Text style={styles.body}>
        We use your information to provide personalized farm stand recommendations, process your
        reviews and favorites, send relevant notifications, and improve our services.
      </Text>

      <Text style={styles.heading}>3. Location Data</Text>
      <Text style={styles.body}>
        With your permission, we collect location data to show nearby farm stands and provide
        distance information. You can disable location access in your device settings.
      </Text>

      <Text style={styles.heading}>4. Data Sharing</Text>
      <Text style={styles.body}>
        We do not sell your personal information. We may share data with service providers who
        help us operate the app, and when required by law.
      </Text>

      <Text style={styles.heading}>5. Data Security</Text>
      <Text style={styles.body}>
        We implement industry-standard security measures to protect your information. However,
        no method of transmission over the internet is 100% secure.
      </Text>

      <Text style={styles.heading}>6. Your Rights</Text>
      <Text style={styles.body}>
        You have the right to access, correct, or delete your personal information. You can
        manage your data through the Settings page or contact us directly.
      </Text>

      <Text style={styles.heading}>7. Contact Us</Text>
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
});
