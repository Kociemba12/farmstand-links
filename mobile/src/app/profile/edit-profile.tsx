import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { User, Mail, Camera } from 'lucide-react-native';
import { useRouter, Stack } from 'expo-router';
import { useUserStore } from '@/lib/user-store';
import { settingsStyles, settingsColors } from '@/lib/settings-styles';
import { uploadAvatarAndPersist, isSupabaseConfigured } from '@/lib/supabase';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';

export default function EditProfileScreen() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const updateUser = useUserStore((s) => s.updateUser);

  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [profilePhoto, setProfilePhoto] = useState<string | undefined>(user?.profilePhoto);
  const [isSaving, setIsSaving] = useState(false);
  const [isPickingImage, setIsPickingImage] = useState(false);

  const hasChanges =
    name !== (user?.name || '') ||
    email !== (user?.email || '') ||
    profilePhoto !== user?.profilePhoto;

  const handlePickImage = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    Alert.alert(
      'Change Profile Photo',
      'Choose how you would like to update your profile photo.',
      [
        { text: 'Take Photo', onPress: handleTakePhoto },
        { text: 'Choose from Library', onPress: handleChooseFromLibrary },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleTakePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Camera Permission Required',
        'Please enable camera access in your device settings to take a photo.'
      );
      return;
    }

    setIsPickingImage(true);
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setProfilePhoto(result.assets[0].uri);
      }
    } catch (error) {
      console.log('Error taking photo:', error);
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    } finally {
      setIsPickingImage(false);
    }
  };

  const handleChooseFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Photo Library Permission Required',
        'Please enable photo library access in your device settings to choose a photo.'
      );
      return;
    }

    setIsPickingImage(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setProfilePhoto(result.assets[0].uri);
      }
    } catch (error) {
      console.log('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    } finally {
      setIsPickingImage(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Name Required', 'Please enter your name.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      Alert.alert('Valid Email Required', 'Please enter a valid email address.');
      return;
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsSaving(true);

    // If the user picked a new photo (local URI, not a remote URL), upload it
    let finalPhotoUrl: string | undefined = profilePhoto;
    const isNewLocalPhoto =
      profilePhoto &&
      profilePhoto !== user?.profilePhoto &&
      !profilePhoto.startsWith('http');

    if (isNewLocalPhoto && user?.id && isSupabaseConfigured()) {
      console.log('[EditProfile] Uploading new avatar for user:', user.id);
      const { url, error: uploadErr } = await uploadAvatarAndPersist(user.id, profilePhoto!);
      if (uploadErr) {
        console.log('[EditProfile] Avatar upload/DB error:', uploadErr.message);
        Alert.alert(
          'Photo Upload Issue',
          `Photo could not be saved to the server: ${uploadErr.message}\n\nYour other profile changes will still be saved.`
        );
      }
      if (url) {
        finalPhotoUrl = url;
        console.log('[EditProfile] Avatar persisted at:', url);
      }
    }

    await updateUser({
      name: name.trim(),
      email: email.trim(),
      profilePhoto: finalPhotoUrl,
    });

    setIsSaving(false);
    Alert.alert('Profile Updated', 'Your profile has been updated successfully.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  };

  return (
    <View style={settingsStyles.pageContainer}>
      <Stack.Screen
        options={{
          title: 'Edit Profile',
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
        contentContainerStyle={[settingsStyles.scrollContent, { paddingBottom: 120 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Profile Photo Card */}
        <View style={settingsStyles.card}>
          <View style={{ alignItems: 'center' }}>
            <Pressable onPress={handlePickImage} disabled={isPickingImage}>
              <View
                style={{
                  width: 88,
                  height: 88,
                  borderRadius: 44,
                  backgroundColor: settingsColors.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {isPickingImage ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : profilePhoto ? (
                  <Image
                    source={{ uri: profilePhoto }}
                    style={{ width: 88, height: 88 }}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={{ color: '#FFFFFF', fontSize: 32, fontWeight: '700' }}>
                    {user?.initials}
                  </Text>
                )}
              </View>
              {/* Camera badge */}
              <View
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: settingsColors.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 2,
                  borderColor: '#FFFFFF',
                }}
              >
                <Camera size={14} color="#FFFFFF" />
              </View>
            </Pressable>
            <Pressable onPress={handlePickImage} disabled={isPickingImage} style={{ marginTop: 12 }}>
              <Text style={{ color: settingsColors.primary, fontSize: 15, fontWeight: '600' }}>
                {isPickingImage ? 'Loading...' : 'Change Photo'}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Profile Info Card - Row Style */}
        <View style={settingsStyles.card}>
          {/* Name Row */}
          <View style={settingsStyles.inputRow}>
            <View style={settingsStyles.inputRowBubble}>
              <User size={18} color="#2D5A3D" />
            </View>
            <View style={settingsStyles.inputRowContent}>
              <Text style={settingsStyles.inputRowLabel}>Full Name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Enter your name"
                placeholderTextColor={settingsColors.textPlaceholder}
                style={settingsStyles.inputRowField}
              />
            </View>
          </View>

          {/* Divider */}
          <View style={{ height: 1, backgroundColor: 'rgba(0,0,0,0.06)', marginVertical: 4 }} />

          {/* Email Row */}
          <View style={settingsStyles.inputRow}>
            <View style={settingsStyles.inputRowBubble}>
              <Mail size={18} color="#2D5A3D" />
            </View>
            <View style={settingsStyles.inputRowContent}>
              <Text style={settingsStyles.inputRowLabel}>Email Address</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="Enter your email"
                placeholderTextColor={settingsColors.textPlaceholder}
                keyboardType="email-address"
                autoCapitalize="none"
                style={settingsStyles.inputRowField}
              />
            </View>
          </View>
        </View>

        {/* Info Card */}
        <View style={settingsStyles.card}>
          <Text style={settingsStyles.infoText}>
            Your email is used for sign-in and account notifications. We'll never share your email
            with third parties.
          </Text>
        </View>

      </ScrollView>

      {/* Sticky Save Button */}
      <View
        style={{
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 16,
        }}
      >
        <SafeAreaView edges={['bottom']}>
          <Pressable
            onPress={handleSave}
            disabled={isSaving || !hasChanges}
            style={{
              height: 54,
              borderRadius: 14,
              backgroundColor: isSaving || !hasChanges ? 'rgba(31, 107, 78, 0.4)' : '#1F6B4E',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              shadowColor: '#000',
              shadowOpacity: 0.15,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 6 },
              elevation: 4,
            }}
          >
            {isSaving ? (
              <>
                <ActivityIndicator size="small" color="white" />
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800', marginLeft: 8 }}>Saving...</Text>
              </>
            ) : (
              <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800' }}>Save Changes</Text>
            )}
          </Pressable>
        </SafeAreaView>
      </View>
    </View>
  );
}
