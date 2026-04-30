import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  Alert,
  Platform,
  ActionSheetIOS,
  Image,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, X, Camera, Send } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useUserStore } from '@/lib/user-store';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { getValidSession, getSupabaseUrl } from '@/lib/supabase';
import { submitFeedback, uploadFeedbackPhoto } from '@/lib/support-api';

const FEEDBACK_CATEGORIES = [
  'General Feedback',
  'Bug Report',
  'Feature Request',
  'Farm Stand Issue',
  'App Performance',
  'Other',
];

const MAX_PHOTOS = 5;

type PhotoAttachment = { uri: string; mime: string };


export default function RateUsScreen() {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [category, setCategory] = useState('');
  const [message, setMessage] = useState('');

  // Photo attachment state — supports up to MAX_PHOTOS
  const [photos, setPhotos] = useState<PhotoAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const user = useUserStore((s) => s.user);

  const handleAddPhoto = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const options = ['Take Photo', 'Choose from Library', 'Cancel'];
    const cancelButtonIndex = 2;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex },
        (buttonIndex) => {
          if (buttonIndex === 0) handleTakePhoto().catch(console.error);
          if (buttonIndex === 1) handleChooseFromLibrary().catch(console.error);
        }
      );
    } else {
      Alert.alert('Add Photo', 'Choose a photo source', [
        { text: 'Take Photo', onPress: handleTakePhoto },
        { text: 'Choose from Library', onPress: handleChooseFromLibrary },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const handleRemovePhoto = async (index: number) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const handleTakePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow camera access to take photos.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3] as [number, number],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhotos(prev => [...prev, { uri: result.assets[0]!.uri, mime: result.assets[0]!.mimeType ?? 'image/jpeg' }]);
    }
  };

  const handleChooseFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow photo library access to add photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as ImagePicker.MediaType[],
      allowsEditing: true,
      aspect: [4, 3] as [number, number],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhotos(prev => [...prev, { uri: result.assets[0]!.uri, mime: result.assets[0]!.mimeType ?? 'image/jpeg' }]);
    }
  };

  const handleSubmitFeedback = async () => {
    if (!message.trim()) {
      Alert.alert('Message Required', 'Please enter a message before sending.');
      return;
    }
    if (!user) {
      Alert.alert('Error', 'You must be logged in to submit feedback.');
      return;
    }

    const resolvedCategory = category || 'General Feedback';

    console.log('[Support] Submit tapped — category:', resolvedCategory, '| messageLength:', message.trim().length, '| photoCount:', photos.length);

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsSubmitting(true);

    try {
      const session = await getValidSession();
      if (!session) {
        Alert.alert('Error', 'Session expired. Please sign in again.');
        return;
      }

      // Upload all attached photos directly to Supabase Storage
      let screenshotUrls: string[] = [];
      if (photos.length > 0) {
        setIsUploading(true);
        if (__DEV__) console.log('[Support] Starting upload of', photos.length, 'photo(s)');
        try {
          const results = await Promise.allSettled(
            photos.map(async (p, i) => {
              if (__DEV__) console.log(`[Support] Uploading photo ${i + 1}/${photos.length} — mime:${p.mime} uri:${p.uri.slice(-40)}`);
              const url = await uploadFeedbackPhoto(user!.id!, i, p.uri, p.mime);
              if (__DEV__) console.log(`[Support] Photo ${i + 1} uploaded — url:${url}`);
              return url;
            })
          );
          const failed = results.filter(r => r.status === 'rejected');
          screenshotUrls = results
            .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
            .map(r => r.value);
          if (__DEV__) console.log('[Support] Upload results — success:', screenshotUrls.length, '| failed:', failed.length);
          if (failed.length > 0) {
            failed.forEach((r, i) => { if (__DEV__) console.warn(`[Support] Upload failure ${i + 1}:`, (r as PromiseRejectedResult).reason); });
          }
          if (failed.length > 0 && screenshotUrls.length === 0) {
            if (__DEV__) console.warn('[Support] All photo uploads failed — showing dialog');
            Alert.alert(
              'Photo Upload Failed',
              'We could not upload your screenshots. Would you like to submit without them?',
              [
                { text: 'Cancel', style: 'cancel', onPress: () => { setIsUploading(false); setIsSubmitting(false); } },
                { text: 'Submit Without Photos', onPress: async () => {
                  setIsUploading(false);
                  try {
                    await doSubmit([], session.access_token, '', resolvedCategory, true);
                  } catch (submitErr) {
                    if (__DEV__) console.warn('[Support] Submit-without-photos failed:', submitErr instanceof Error ? submitErr.message : String(submitErr));
                    Alert.alert('Error', "Couldn't send right now. Check connection and try again.");
                    setIsSubmitting(false);
                  }
                }},
              ]
            );
            return;
          }
        } finally {
          setIsUploading(false);
        }
      }

      // hadPhotoFailures = true when some photos were attached but at least one failed to upload
      const hadPhotoFailures = photos.length > 0 && screenshotUrls.length < photos.length;
      await doSubmit(screenshotUrls, session.access_token, '', resolvedCategory, hadPhotoFailures);
    } catch (error) {
      if (__DEV__) console.warn('[Feedback] Submit exception:', error instanceof Error ? error.message : String(error));
      Alert.alert('Error', "Couldn't send right now. Check connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // _token and _backendUrl kept in signature so call sites need no change
  const doSubmit = async (screenshotUrls: string[], _token: string, _backendUrl: string, resolvedCategory: string, hadPhotoFailures = false) => {
    const result = await submitFeedback({
      userId:        user!.id!,
      userEmail:     user!.email,
      userName:      user!.name ?? null,
      rating:        rating || null,
      category:      resolvedCategory,
      message:       message.trim(),
      sourceScreen:  'support',
      screenshotUrls,
    });

    if (!result.success) {
      if (__DEV__) console.warn('[Support] submitFeedback failed:', result.error);
      Alert.alert('Error', "Couldn't send right now. Check connection and try again.");
      setIsSubmitting(false);
      return;
    }

    if (__DEV__) console.log('[Support] Ticket created — id:', result.id);

    // Best-effort admin email — fire-and-forget, does not block submission
    void fetch(`${getSupabaseUrl()}/functions/v1/hyper-worker`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''}`,
      },
      body: JSON.stringify({
        type: 'support_ticket_submitted',
        data: {
          ticket_id:       result.id ?? null,
          subject:         resolvedCategory,
          source_screen:   'support',
          message:         message.trim(),
          user_id:         user!.id!,
          user_email:      user!.email,
          attachment_info: screenshotUrls.length > 0 ? `${screenshotUrls.length} photo(s) attached` : null,
          submitted_at:    new Date().toISOString(),
        },
      }),
    }).then(async (r) => {
      const body = await r.text().catch(() => '(unreadable)');
      if (__DEV__) console.log('[Support] hyper-worker response — status:', r.status, '| body:', body);
    }).catch((err: unknown) => {
      if (__DEV__) console.warn('[Support] hyper-worker network error:', err);
    });

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const successMessage = hadPhotoFailures
      ? 'Message saved, but photo upload failed. You can describe the issue in text — no photo needed.'
      : 'Your message was sent to the Farmstand team.';

    Alert.alert(
      'Message Sent!',
      successMessage,
      [{ text: 'OK', onPress: () => {
        setRating(0);
        setCategory('');
        setMessage('');
        setPhotos([]);
        router.back();
      }}]
    );

    setIsSubmitting(false);
  };

  const isBusy = isSubmitting || isUploading;
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: '#FDF8F3' }}>
      {/* Settings-style light header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#FDF8F3' }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#EDE8E0' }}>
          <Pressable onPress={() => router.back()} style={{ marginBottom: 12, alignSelf: 'flex-start', padding: 2, marginLeft: -2 }}>
            <ArrowLeft size={22} color="#4A7C59" />
          </Pressable>
          <Text style={{ fontSize: 26, fontWeight: '700', color: '#2C2420', letterSpacing: -0.3 }}>Support</Text>
        </View>
      </SafeAreaView>

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1 }}
        bottomOffset={20}
      >
        <View style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: insets.bottom + 32 }}>

          {/* Category */}
          <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.0, color: '#A8906E', marginBottom: 10, marginLeft: 4 }}>
            CATEGORY
          </Text>
          <View style={{ backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18, overflow: 'hidden', marginBottom: 6, shadowColor: 'rgba(0,0,0,0.06)', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {FEEDBACK_CATEGORIES.map((cat) => (
                <Pressable
                  key={cat}
                  onPress={() => setCategory(cat)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 20,
                    backgroundColor: category === cat ? '#2D5A3D' : '#F5F0EA',
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '500', color: category === cat ? '#FDF8F3' : '#6B5B4E' }}>
                    {cat}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Message */}
          <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.0, color: '#A8906E', marginBottom: 10, marginLeft: 4, marginTop: 24 }}>
            YOUR MESSAGE
          </Text>
          <View style={{ backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18, overflow: 'hidden', marginBottom: 6, shadowColor: 'rgba(0,0,0,0.06)', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 }}>
            <TextInput
              style={{
                backgroundColor: '#FAF7F2',
                borderRadius: 12,
                padding: 14,
                color: '#2C2420',
                minHeight: 120,
                fontSize: 15,
                lineHeight: 22,
                textAlignVertical: 'top',
              }}
              placeholder="Tell us what you think or describe the issue..."
              placeholderTextColor="#B8A898"
              multiline
              value={message}
              onChangeText={setMessage}
            />
          </View>

          {/* Photo Attachment — multi-photo grid */}
          <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.0, color: '#A8906E', marginBottom: 10, marginLeft: 4, marginTop: 24 }}>
            ADD PHOTOS (OPTIONAL)
          </Text>

          {/* Thumbnail strip */}
          {photos.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0, marginBottom: 10 }}
              contentContainerStyle={{ gap: 10, paddingHorizontal: 0 }}
            >
              {photos.map((photo, index) => (
                <View key={index} style={{ position: 'relative' }}>
                  <View
                    style={{
                      width: 88,
                      height: 88,
                      borderRadius: 14,
                      overflow: 'hidden',
                      backgroundColor: '#EEE8E0',
                    }}
                  >
                    <Image
                      source={{ uri: photo.uri }}
                      style={{ width: 88, height: 88 }}
                      resizeMode="cover"
                    />
                  </View>
                  <Pressable
                    onPress={() => handleRemovePhoto(index)}
                    style={{
                      position: 'absolute', top: 5, right: 5,
                      width: 22, height: 22, borderRadius: 11,
                      backgroundColor: '#FF3B30',
                      alignItems: 'center', justifyContent: 'center',
                    }}
                    hitSlop={6}
                  >
                    <X size={12} color="#FFFFFF" strokeWidth={2.5} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}

          {/* Add Photo row — hidden when at max */}
          {photos.length < MAX_PHOTOS && (
            <View style={{ marginBottom: 28 }}>
              <Pressable
                onPress={handleAddPhoto}
                style={{
                  borderWidth: 1,
                  borderColor: '#E6E6E6',
                  backgroundColor: '#FFFFFF',
                  borderRadius: 16,
                  padding: 14,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 12,
                    backgroundColor: '#F3F3F3',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  <Camera size={24} color="#7A7A7A" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', color: '#1F1F1F', fontSize: 16 }}>
                    Add Photo
                  </Text>
                  <Text style={{ color: '#7A7A7A', marginTop: 2, fontSize: 13 }}>
                    {photos.length === 0
                      ? 'Take a photo or choose from library'
                      : `${photos.length} of ${MAX_PHOTOS} added — tap to add more`}
                  </Text>
                </View>
                <Text style={{ color: '#1F6B4E', fontWeight: '700', fontSize: 20 }}>+</Text>
              </Pressable>
            </View>
          )}
          {photos.length >= MAX_PHOTOS && <View style={{ marginBottom: 28 }} />}

          {/* Submit */}
          <Pressable
            onPress={handleSubmitFeedback}
            disabled={isBusy}
            style={{
              marginTop: 24,
              marginBottom: 24,
              width: '100%',
              minHeight: 56,
              backgroundColor: isBusy ? '#A8C4B0' : '#2D5A3D',
              borderRadius: 16,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Send size={18} color="#FFFFFF" />
            <Text style={{ color: '#FFFFFF', fontWeight: '700', marginLeft: 8, fontSize: 16 }}>
              {isUploading ? 'Uploading Photo...' : isSubmitting ? 'Sending...' : 'Send Message'}
            </Text>
          </Pressable>

        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}
