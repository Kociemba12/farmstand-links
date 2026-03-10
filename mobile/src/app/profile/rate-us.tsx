import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, Alert, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Star, Camera, Send } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useUserStore } from '@/lib/user-store';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { getValidSession } from '@/lib/supabase';

const FEEDBACK_CATEGORIES = [
  'General Feedback',
  'Bug Report',
  'Feature Request',
  'Farm Stand Issue',
  'App Performance',
  'Other',
];

export default function RateUsScreen() {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [category, setCategory] = useState('');
  const [message, setMessage] = useState('');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const user = useUserStore((s) => s.user);

  const handleRateOnStore = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Open store URL directly
    const storeUrl = Platform.select({
      ios: 'https://apps.apple.com/app/farmstand/id123456789',
      android: 'https://play.google.com/store/apps/details?id=com.farmstand.app',
    });
    if (storeUrl) {
      Linking.openURL(storeUrl);
    }
  };

  const handleStarPress = async (star: number) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRating(star);
  };

  const handlePickScreenshot = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Please enable photo access in settings.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.5,
    });

    if (!result.canceled && result.assets[0]) {
      setScreenshot(result.assets[0].uri);
    }
  };

  const handleSubmitFeedback = async () => {
    // Validation
    if (!rating) {
      Alert.alert('Rating Required', 'Please select a star rating.');
      return;
    }
    if (!category) {
      Alert.alert('Category Required', 'Please select a feedback category.');
      return;
    }
    if (!message.trim()) {
      Alert.alert('Message Required', 'Please enter your feedback message.');
      return;
    }

    if (!user) {
      Alert.alert('Error', 'You must be logged in to submit feedback.');
      return;
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsSubmitting(true);

    try {
      const session = await getValidSession();
      if (!session) {
        Alert.alert('Error', 'Session expired. Please sign in again.');
        return;
      }

      const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';

      const resp = await fetch(`${backendUrl}/api/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          user_email: user.email,
          user_name: user.name ?? null,
          rating,
          category,
          message: message.trim(),
          source_screen: 'rate-us',
        }),
      });

      const json = await resp.json() as { success: boolean; error?: string };

      if (json.success) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        console.log('[Feedback] Submitted successfully for user:', user.id);
        Alert.alert(
          'Thanks!',
          'Your feedback was sent to the Farmstand team.',
          [{ text: 'OK', onPress: () => {
            setRating(0);
            setCategory('');
            setMessage('');
            setScreenshot(null);
            router.back();
          }}]
        );
      } else if (json.error === 'feedback_table_missing') {
        // Table not created yet — show a real error so the admin knows to set it up
        console.warn('[Feedback] feedback table missing — admin needs to run migration SQL');
        Alert.alert(
          'Submission Failed',
          'The feedback system is not set up yet. Please contact support directly at contact@farmstand.online.',
          [{ text: 'OK' }]
        );
      } else {
        console.warn('[Feedback] Submit failed:', json.error);
        Alert.alert('Error', json.error || 'Something went wrong. Please try again.');
      }
    } catch (error) {
      console.error('[Feedback] Submit exception:', error);
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View className="flex-1 bg-cream">
      <SafeAreaView edges={['top']} className="bg-forest">
        <View className="flex-row items-center px-4 py-4">
          <Pressable onPress={() => router.back()} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#FDF8F3" />
          </Pressable>
          <Text className="text-cream text-xl font-bold ml-2">Feedback & Support</Text>
        </View>
      </SafeAreaView>

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 40 }}
        bottomOffset={20}
      >
        <View className="px-5 py-6">
          {/* Rate on Store */}
          <View className="bg-white rounded-2xl p-5 border border-sand mb-6">
            <Text className="text-charcoal font-bold text-lg text-center mb-2">
              Enjoying Farmstand?
            </Text>
            <Text className="text-wood text-center mb-4">
              Leave us a review on the App Store to help others discover local farm stands!
            </Text>
            <Pressable
              onPress={handleRateOnStore}
              className="bg-forest py-3 rounded-xl flex-row items-center justify-center"
            >
              <Star size={18} color="#FDF8F3" fill="#FDF8F3" />
              <Text className="text-cream font-semibold ml-2">Rate on App Store</Text>
            </Pressable>
          </View>

          {/* Feedback Form */}
          <Text className="text-charcoal font-bold text-lg mb-4">Send Feedback</Text>

          {/* Star Rating */}
          <View className="bg-white rounded-2xl p-4 border border-sand mb-4">
            <Text className="text-charcoal font-medium mb-3">Your Rating</Text>
            <View className="flex-row justify-center">
              {[1, 2, 3, 4, 5].map((star) => (
                <Pressable key={star} onPress={() => handleStarPress(star)} className="mx-2">
                  <Star
                    size={36}
                    color="#D4943A"
                    fill={star <= rating ? '#D4943A' : 'transparent'}
                  />
                </Pressable>
              ))}
            </View>
          </View>

          {/* Category */}
          <View className="bg-white rounded-2xl p-4 border border-sand mb-4">
            <Text className="text-charcoal font-medium mb-3">Category</Text>
            <View className="flex-row flex-wrap">
              {FEEDBACK_CATEGORIES.map((cat) => (
                <Pressable
                  key={cat}
                  onPress={() => setCategory(cat)}
                  className={`px-3 py-2 rounded-full mr-2 mb-2 ${
                    category === cat ? 'bg-forest' : 'bg-sand'
                  }`}
                >
                  <Text className={category === cat ? 'text-cream' : 'text-bark'}>
                    {cat}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Message */}
          <View className="bg-white rounded-2xl p-4 border border-sand mb-4">
            <Text className="text-charcoal font-medium mb-3">Your Message</Text>
            <TextInput
              className="bg-cream rounded-xl p-4 text-charcoal min-h-[120px]"
              placeholder="Tell us what you think..."
              placeholderTextColor="#8B6F4E"
              multiline
              textAlignVertical="top"
              value={message}
              onChangeText={setMessage}
            />
          </View>

          {/* Screenshot */}
          <Pressable
            onPress={handlePickScreenshot}
            className="bg-white rounded-2xl p-4 border border-sand mb-6 flex-row items-center"
          >
            <View className="w-10 h-10 rounded-full bg-cream items-center justify-center">
              <Camera size={20} color="#2D5A3D" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-charcoal font-medium">
                {screenshot ? 'Screenshot Added' : 'Add Screenshot (Optional)'}
              </Text>
              <Text className="text-wood text-sm">Help us understand the issue</Text>
            </View>
          </Pressable>

          {/* Submit */}
          <Pressable
            onPress={handleSubmitFeedback}
            disabled={isSubmitting}
            className={`py-4 rounded-xl flex-row items-center justify-center ${
              isSubmitting ? 'bg-sand' : 'bg-terracotta'
            }`}
          >
            <Send size={18} color="#FDF8F3" />
            <Text className="text-cream font-semibold ml-2">
              {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}
