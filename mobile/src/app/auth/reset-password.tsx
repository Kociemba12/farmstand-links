import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  ImageBackground,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Lock, Eye, EyeOff, Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { supabaseUpdatePassword, supabaseSignOut } from '@/lib/supabase';

/**
 * ResetPassword Screen
 *
 * In-app screen where user sets a new password after clicking
 * the recovery link from their email.
 *
 * Flow:
 * 1. User clicks "Forgot password?" on login
 * 2. User receives email with reset link
 * 3. User clicks link → opens AuthCallback screen
 * 4. AuthCallback sets session → navigates here
 * 5. User enters new password → we call supabase.auth.updateUser
 * 6. Success → sign out and redirect to login
 */
export default function ResetPasswordScreen() {
  const router = useRouter();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleUpdatePassword = async () => {
    // Clear previous error
    setError('');

    // Validate password length
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    // Validate passwords match
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setIsLoading(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Update password in Supabase
    const { error: updateError } = await supabaseUpdatePassword(password);

    if (updateError) {
      setIsLoading(false);
      setError(updateError.message || 'Failed to update password. Please try again.');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    // Success - sign out to force clean login
    await supabaseSignOut();

    setIsLoading(false);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    Alert.alert(
      'Password Updated',
      'Your password has been updated successfully. Please sign in with your new password.',
      [
        {
          text: 'Sign In',
          onPress: () => router.replace('/auth/login'),
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      {/* Background image with blur effect */}
      <ImageBackground
        source={{ uri: 'https://images.unsplash.com/photo-1500651230702-0e2d8a49d4ad?w=800&q=80' }}
        style={StyleSheet.absoluteFillObject}
        blurRadius={25}
      >
        {/* Heavy green overlay with subtle vertical gradient */}
        <LinearGradient
          colors={['rgba(35, 75, 50, 0.92)', 'rgba(45, 90, 61, 0.88)', 'rgba(55, 100, 70, 0.85)']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
      </ImageBackground>

      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.iconContainer}>
                <Lock size={32} color="#FFFFFF" />
              </View>
              <Text style={styles.title}>Reset Password</Text>
              <Text style={styles.subtitle}>
                Enter your new password below
              </Text>
            </View>

            {/* Card */}
            <View style={styles.card}>
              {error ? (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* New Password Input */}
              <View style={styles.inputContainer}>
                <Lock size={22} color="#717171" />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="New Password"
                  placeholderTextColor="#9CA3AF"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />
                <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={10}>
                  {showPassword ? (
                    <EyeOff size={22} color="#717171" />
                  ) : (
                    <Eye size={22} color="#717171" />
                  )}
                </Pressable>
              </View>

              {/* Password requirement hint */}
              <View style={styles.hintContainer}>
                <Check size={14} color={password.length >= 8 ? '#2D5A3D' : '#9CA3AF'} />
                <Text style={[styles.hintText, password.length >= 8 && styles.hintTextValid]}>
                  At least 8 characters
                </Text>
              </View>

              {/* Confirm Password Input */}
              <View style={styles.inputContainer}>
                <Lock size={22} color="#717171" />
                <TextInput
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm Password"
                  placeholderTextColor="#9CA3AF"
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleUpdatePassword}
                  style={styles.input}
                />
                <Pressable onPress={() => setShowConfirmPassword(!showConfirmPassword)} hitSlop={10}>
                  {showConfirmPassword ? (
                    <EyeOff size={22} color="#717171" />
                  ) : (
                    <Eye size={22} color="#717171" />
                  )}
                </Pressable>
              </View>

              {/* Passwords match hint */}
              {confirmPassword.length > 0 && (
                <View style={styles.hintContainer}>
                  <Check size={14} color={password === confirmPassword ? '#2D5A3D' : '#DC2626'} />
                  <Text style={[
                    styles.hintText,
                    password === confirmPassword ? styles.hintTextValid : styles.hintTextInvalid
                  ]}>
                    {password === confirmPassword ? 'Passwords match' : 'Passwords do not match'}
                  </Text>
                </View>
              )}

              {/* Update Password Button */}
              <Pressable
                onPress={handleUpdatePassword}
                disabled={isLoading}
                style={[styles.updateButton, isLoading && styles.buttonDisabled]}
              >
                {isLoading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.updateButtonText}>Update Password</Text>
                )}
              </Pressable>

              {/* Back to Login */}
              <Pressable
                onPress={() => router.replace('/auth/login')}
                style={styles.backButton}
              >
                <Text style={styles.backButtonText}>Back to Login</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
  },
  card: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingTop: 24,
    paddingHorizontal: 22,
    paddingBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 12,
  },
  errorContainer: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F7F7',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    paddingHorizontal: 16,
    height: 56,
    marginBottom: 8,
  },
  input: {
    flex: 1,
    marginLeft: 14,
    fontSize: 16,
    color: '#222222',
  },
  hintContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  hintText: {
    fontSize: 13,
    color: '#9CA3AF',
    marginLeft: 6,
  },
  hintTextValid: {
    color: '#2D5A3D',
  },
  hintTextInvalid: {
    color: '#DC2626',
  },
  updateButton: {
    backgroundColor: '#2D5A3D',
    height: 56,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  updateButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  backButton: {
    alignItems: 'center',
    marginTop: 20,
    paddingVertical: 8,
  },
  backButtonText: {
    color: '#717171',
    fontSize: 15,
    fontWeight: '500',
  },
});
