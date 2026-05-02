import React from 'react';
import { View, Text, ScrollView, Linking, Alert } from 'react-native';
import { Stack } from 'expo-router';
import { settingsStyles, settingsColors } from '@/lib/settings-styles';

const TERMS_URL = 'https://farmstand.app/terms';

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

export default function TermsScreen() {
  return (
    <View style={settingsStyles.pageContainer}>
      <Stack.Screen
        options={{
          title: 'Terms of Service',
          headerShown: true,
          headerTitleAlign: 'center',
          headerTitleStyle: { fontSize: 20, fontWeight: '600' },
          headerStyle: { backgroundColor: settingsColors.headerBackground },
          headerBackTitle: '',
          headerBackButtonDisplayMode: 'minimal',
          headerTintColor: '#2f6b46',
          headerBackVisible: true,
        }}
      />

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

          <Text style={settingsStyles.readingHeading}>5. Farmstand Claims & Ownership</Text>
          <Text style={settingsStyles.readingBody}>
            Users may submit and claim farmstand listings. By submitting a claim:
          </Text>
          <Text style={settingsStyles.readingBody}>
            {'• '}You represent that you are the rightful owner or authorized representative of the farmstand.{'\n'}
            {'• '}All submitted information must be accurate and truthful.{'\n'}
            {'• '}Farmstand reserves the right to approve or deny any claim at its sole discretion.
          </Text>
          <Text style={settingsStyles.readingBody}>
            Approval of a claim grants access to management features but does not transfer ownership
            of the platform or listing data.
          </Text>

          <Text style={settingsStyles.readingHeading}>6. Community Guidelines</Text>
          <Text style={settingsStyles.readingBody}>
            Be respectful in reviews and interactions. Do not post false, misleading, or harmful
            content. Violations may result in account suspension.
          </Text>

          <Text style={settingsStyles.readingHeading}>7. Limitation of Liability</Text>
          <Text style={settingsStyles.readingBody}>
            Farmstand is provided "as is" without warranties. We are not liable for any damages
            arising from your use of the service.
          </Text>
          <Text style={settingsStyles.readingBody}>
            To the fullest extent permitted by law, Farmstand shall not be liable for:
          </Text>
          <Text style={settingsStyles.readingBody}>
            {'• '}Loss of business, revenue, or profits{'\n'}
            {'• '}Product quality or safety issues{'\n'}
            {'• '}User disputes or transactions{'\n'}
            {'• '}Platform interruptions or data loss
          </Text>

          <Text style={settingsStyles.readingHeading}>8. Changes to Terms</Text>
          <Text style={settingsStyles.readingBody}>
            We may update these terms from time to time. Continued use after changes constitutes
            acceptance of the new terms.
          </Text>

          <Text style={settingsStyles.readingHeading}>9. Premium Subscription</Text>
          <Text style={settingsStyles.readingBody}>
            Farmstand offers optional premium subscriptions for approved farmstand owners. Premium
            may include enhanced features such as analytics, messaging, expanded listings, and
            promotional tools. A free trial period of 3 months is offered to approved farmstand owners. After the trial
            period, the subscription will automatically renew unless canceled.
          </Text>
          <Text style={settingsStyles.readingBody}>
            Billing:
          </Text>
          <Text style={settingsStyles.readingBody}>
            {'• '}All subscriptions are processed through Apple's App Store.{'\n'}
            {'• '}Payment will be charged to your Apple ID account.{'\n'}
            {'• '}Subscriptions automatically renew unless canceled at least 24 hours before the end
            of the billing period.
          </Text>
          <Text style={settingsStyles.readingBody}>
            Cancellation:
          </Text>
          <Text style={settingsStyles.readingBody}>
            {'• '}You may manage or cancel your subscription in your Apple account settings.{'\n'}
            {'• '}No refunds are provided except as required by Apple or applicable law.
          </Text>

          <Text style={settingsStyles.readingHeading}>10. Promotions & Boosts</Text>
          <Text style={settingsStyles.readingBody}>
            Farmstand may offer paid promotional features ("Boosts") to increase visibility.
          </Text>
          <Text style={settingsStyles.readingBody}>
            By purchasing a Boost:
          </Text>
          <Text style={settingsStyles.readingBody}>
            {'• '}Placement is not guaranteed to be exclusive or top-ranked at all times.{'\n'}
            {'• '}Boosts may rotate among other promoted listings.{'\n'}
            {'• '}Boost duration is time-based (e.g., 30 days).{'\n'}
            {'• '}No guarantee of views, traffic, or sales is provided.
          </Text>
          <Text style={settingsStyles.readingBody}>
            Boost purchases are final and non-refundable unless required by law.
          </Text>

          <Text style={settingsStyles.readingHeading}>11. Messaging & User Interactions</Text>
          <Text style={settingsStyles.readingBody}>
            Farmstand may provide messaging or communication tools between users and farmstand owners.
          </Text>
          <Text style={settingsStyles.readingBody}>
            {'• '}Farmstand does not guarantee responses or outcomes from communications.{'\n'}
            {'• '}Users are responsible for their own interactions.{'\n'}
            {'• '}Farmstand is not liable for disputes, transactions, or agreements between users.
          </Text>

          <Text style={settingsStyles.readingHeading}>12. Push Notifications</Text>
          <Text style={settingsStyles.readingBody}>
            By using Farmstand, you may receive notifications related to:
          </Text>
          <Text style={settingsStyles.readingBody}>
            {'• '}Messages{'\n'}
            {'• '}Product updates{'\n'}
            {'• '}Claim status updates{'\n'}
            {'• '}Platform announcements
          </Text>
          <Text style={settingsStyles.readingBody}>
            You may manage notification preferences in your device settings.
          </Text>

          <Text style={settingsStyles.readingHeading}>13. Marketplace and Food Sales Disclaimer</Text>
          <Text style={settingsStyles.readingBody}>
            Farmstand is an online platform that connects consumers with local farms, farmstands,
            and independent producers. Farmstand does not produce, store, handle, inspect,
            distribute, or sell any food or agricultural products listed on the platform.
          </Text>
          <Text style={settingsStyles.readingBody}>
            All products listed on Farmstand are offered directly by independent sellers. Each
            seller is solely responsible for the accuracy of their listings and for ensuring that
            their products comply with all applicable local, state, and federal laws, regulations,
            and food safety requirements.
          </Text>
          <Text style={settingsStyles.readingBody}>
            By listing products on Farmstand, sellers represent and warrant that they have the
            legal right to sell the products listed and that such products comply with all applicable
            food safety, labeling, inspection, and licensing requirements in their jurisdiction.
          </Text>
          <Text style={settingsStyles.readingBody}>
            Consumers acknowledge that Farmstand does not verify or guarantee the safety, quality,
            legality, or condition of any products listed by sellers. Consumers purchase and consume
            products listed on the platform at their own discretion and risk.
          </Text>
          <Text style={settingsStyles.readingBody}>
            Farmstand makes no warranties or representations regarding any products offered by
            sellers and disclaims any liability arising from the sale, consumption, or use of
            products listed on the platform.
          </Text>
          <Text style={settingsStyles.readingBody}>
            Any transaction conducted through Farmstand is solely between the buyer and the seller.
            Farmstand is not a party to such transactions and assumes no responsibility for disputes,
            product safety, or regulatory compliance related to any listing or sale.
          </Text>
          <Text style={settingsStyles.readingBody}>
            Farmstand acts solely as a technology platform and is not a party to any transaction
            between buyers and sellers. Farmstand does not:
          </Text>
          <Text style={settingsStyles.readingBody}>
            {'• '}Handle payments between users{'\n'}
            {'• '}Store or distribute products{'\n'}
            {'• '}Inspect or verify food safety, licensing, or compliance
          </Text>
          <Text style={settingsStyles.readingBody}>
            Users acknowledge that all purchases and interactions are conducted at their own risk.
          </Text>

          <Text style={settingsStyles.readingHeading}>14. Contact</Text>
          <Text style={settingsStyles.readingBody}>
            Questions about these terms? Contact us at{' '}
            <Text
              style={{ color: settingsColors.primary, textDecorationLine: 'underline' }}
              onPress={() => openMailto(CONTACT_EMAIL)}
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
