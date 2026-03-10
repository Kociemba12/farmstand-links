import React from 'react';
import { View, Text, ScrollView, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, ExternalLink } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { settingsStyles, settingsColors } from '@/lib/settings-styles';

const TERMS_URL = 'https://farmstand.app/terms';

export default function TermsScreen() {
  const router = useRouter();

  const handleOpenExternal = () => {
    Linking.openURL(TERMS_URL);
  };

  return (
    <View style={settingsStyles.pageContainer}>
      {/* Header */}
      <SafeAreaView edges={['top']} style={settingsStyles.header}>
        <View style={settingsStyles.headerContent}>
          <Pressable onPress={() => router.back()} style={settingsStyles.headerBackButton}>
            <ArrowLeft size={22} color={settingsColors.headerText} />
          </Pressable>
          <Text style={settingsStyles.headerTitle}>Terms of Service</Text>
          <Pressable onPress={handleOpenExternal} style={settingsStyles.headerRightButton}>
            <ExternalLink size={20} color={settingsColors.headerText} />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[settingsStyles.scrollContent, { paddingBottom: 60 }]}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
      >
        {/* Content Card */}
        <View style={[settingsStyles.card, { paddingBottom: 28, overflow: 'visible' }]}>
          <Text style={settingsStyles.readingMeta}>Last updated: January 2025</Text>

          <Text style={settingsStyles.readingTitle}>Farmstand Terms of Service</Text>

          <Text style={settingsStyles.readingHeading}>1. Acceptance of Terms</Text>
          <Text style={settingsStyles.readingBody}>
            By using Farmstand, you agree to these Terms of Service. If you do not agree, please do
            not use the app.
          </Text>

          <Text style={settingsStyles.readingHeading}>2. Use of Service</Text>
          <Text style={settingsStyles.readingBody}>
            Farmstand provides a platform to discover local farm stands. You may use the service for
            personal, non-commercial purposes. You agree not to misuse the service or help anyone
            else do so.
          </Text>

          <Text style={settingsStyles.readingHeading}>3. User Content</Text>
          <Text style={settingsStyles.readingBody}>
            You may post reviews, photos, and other content. You retain ownership of your content
            but grant us a license to use it within the app. You are responsible for ensuring your
            content is accurate and does not violate others' rights.
          </Text>

          <Text style={settingsStyles.readingHeading}>4. Farm Stand Listings</Text>
          <Text style={settingsStyles.readingBody}>
            Farm stand information is provided by farmers and users. We do not guarantee the
            accuracy of listings, hours, products, or prices. Always verify information directly
            with the farm stand.
          </Text>

          <Text style={settingsStyles.readingHeading}>5. Community Guidelines</Text>
          <Text style={settingsStyles.readingBody}>
            Be respectful in reviews and interactions. Do not post false, misleading, or harmful
            content. Violations may result in account suspension.
          </Text>

          <Text style={settingsStyles.readingHeading}>6. Limitation of Liability</Text>
          <Text style={settingsStyles.readingBody}>
            Farmstand is provided "as is" without warranties. We are not liable for any damages
            arising from your use of the service.
          </Text>

          <Text style={settingsStyles.readingHeading}>7. Changes to Terms</Text>
          <Text style={settingsStyles.readingBody}>
            We may update these terms from time to time. Continued use after changes constitutes
            acceptance of the new terms.
          </Text>

          <Text style={settingsStyles.readingHeading}>8. Marketplace and Food Sales Disclaimer</Text>
          <Text style={settingsStyles.readingBody}>
            Farmstand is an online platform that connects consumers with local farms, farmstands, and independent producers. Farmstand does not produce, store, handle, inspect, distribute, or sell any food or agricultural products listed on the platform.
          </Text>
          <Text style={settingsStyles.readingBody}>
            All products listed on Farmstand are offered directly by independent sellers. Each seller is solely responsible for the accuracy of their listings and for ensuring that their products comply with all applicable local, state, and federal laws, regulations, and food safety requirements.
          </Text>
          <Text style={settingsStyles.readingBody}>
            By listing products on Farmstand, sellers represent and warrant that they have the legal right to sell the products listed and that such products comply with all applicable food safety, labeling, inspection, and licensing requirements in their jurisdiction.
          </Text>
          <Text style={settingsStyles.readingBody}>
            Consumers acknowledge that Farmstand does not verify or guarantee the safety, quality, legality, or condition of any products listed by sellers. Consumers purchase and consume products listed on the platform at their own discretion and risk.
          </Text>
          <Text style={settingsStyles.readingBody}>
            Farmstand makes no warranties or representations regarding any products offered by sellers and disclaims any liability arising from the sale, consumption, or use of products listed on the platform.
          </Text>
          <Text style={settingsStyles.readingBody}>
            Any transaction conducted through Farmstand is solely between the buyer and the seller. Farmstand is not a party to such transactions and assumes no responsibility for disputes, product safety, or regulatory compliance related to any listing or sale.
          </Text>

          <Text style={settingsStyles.readingHeading}>9. Contact</Text>
          <Text style={settingsStyles.readingBody}>
            Questions about these terms? Contact us at{' '}
            <Text
              style={{ color: settingsColors.primary, textDecorationLine: 'underline' }}
              onPress={() => Linking.openURL('mailto:contact@farmstand.online')}
            >
              contact@farmstand.online
            </Text>
            .
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
