import React, { useState, useEffect } from 'react';
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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Lock, Eye, EyeOff, Check, AlertCircle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import {
  supabaseUpdatePassword,
  supabaseSignOut,
  supabaseSetSessionFromTokens,
  getSupabaseSession,
} from '@/lib/supabase';

/**
 * ResetPassword Screen (Root-level route for deep linking)
 *
 * This screen handles the deep link: farmstand://reset-password
 *
 * Flow:
 * 1. User clicks password reset link in email
 * 2. Link opens app via farmstand://reset-password#access_token=xxx&refresh_token=xxx&type=recovery
 * 3. This screen parses tokens from URL hash OR route params, sets Supabase session
 * 4. User enters new password
 * 5. Calls supabase.auth.updateUser({ password })
 * 6. Success → redirect to login
 */

// Parse deep link params from URL (handles both query params and hash fragment)
function parseDeepLinkParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};

  try {
    // Parse query params
    const queryStart = url.indexOf('?');
    if (queryStart !== -1) {
      const queryString = url.substring(queryStart + 1).split('#')[0];
      const queryPairs = queryString.split('&');
      for (const pair of queryPairs) {
        const [key, value] = pair.split('=');
        if (key && value) {
          params[key] = decodeURIComponent(value);
        }
      }
    }

    // Parse hash fragment (Supabase uses this for tokens)
    const hashStart = url.indexOf('#');
    if (hashStart !== -1) {
      const hashString = url.substring(hashStart + 1);
      const hashPairs = hashString.split('&');
      for (const pair of hashPairs) {
        const [key, value] = pair.split('=');
        if (key && value) {
          params[key] = decodeURIComponent(value);
        }
      }
    }
  } catch (err) {
    console.log('[ResetPassword] Error parsing URL params:', err);
  }

  return params;
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const searchParams = useLocalSearchParams();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSettingSession, setIsSettingSession] = useState(true);
  const [error, setError] = useState('');
  const [sessionReady, setSessionReady] = useState(false);

  // On mount, check for tokens and set session
  useEffect(() => {
    const setupSession = async () => {
      console.log('[ResetPassword] Starting session setup...');
      console.log('[ResetPassword] Route params:', JSON.stringify(searchParams));

      try {
        let accessToken: string | undefined;
        let refreshToken: string | undefined;

        // Priority 1: Check route params (passed from _layout.tsx deep link handler)
        if (searchParams.access_token && searchParams.refresh_token) {
          accessToken = searchParams.access_token as string;
          refreshToken = searchParams.refresh_token as string;
          console.log('[ResetPassword] Found tokens in route params');
        }

        // Priority 2: Check initial URL (for cold start)
        if (!accessToken || !refreshToken) {
          const initialUrl = await Linking.getInitialURL();
          console.log('[ResetPassword] Initial URL:', initialUrl);

          if (initialUrl) {
            const params = parseDeepLinkParams(initialUrl);
            console.log('[ResetPassword] Parsed URL params:', Object.keys(params));

            if (params.access_token && params.refresh_token) {
              accessToken = params.access_token;
              refreshToken = params.refresh_token;
              console.log('[ResetPassword] Found tokens in URL');
            }
          }
        }

        // If we have tokens, set the session
        if (accessToken && refreshToken) {
          console.log('[ResetPassword] Setting session from tokens...');

          const { error: sessionError } = await supabaseSetSessionFromTokens(
            accessToken,
            refreshToken
          );

          if (sessionError) {
            console.log('[ResetPassword] Session error:', sessionError.message);
            setError('Your reset link has expired. Please request a new password reset.');
            setIsSettingSession(false);
            return;
          }

          console.log('[ResetPassword] Session set successfully from tokens');
          setSessionReady(true);
          setIsSettingSession(false);
          return;
        }

        // Priority 3: Check if we already have a valid session
        console.log('[ResetPassword] No tokens found, checking existing session...');
        const existingSession = await getSupabaseSession();

        if (existingSession?.access_token) {
          console.log('[ResetPassword] Existing session found, ready for password update');
          setSessionReady(true);
          setIsSettingSession(false);
          return;
        }

        // No tokens and no session - show error
        console.log('[ResetPassword] No tokens and no session found');
        setError('Please open the password reset link from your email to continue.');
        setIsSettingSession(false);
      } catch (err) {
        console.log('[ResetPassword] Error during session setup:', err);
        setError('Something went wrong. Please try again.');
        setIsSettingSession(false);
      }
    };

    setupSession();
  }, [searchParams]);

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
    console.log('[ResetPassword] Calling supabaseUpdatePassword...');
    const { error: updateError } = await supabaseUpdatePassword(password);

    if (updateError) {
      console.log('[ResetPassword] Update error:', updateError.message);
      setIsLoading(false);

      // Check for specific error types
      if (updateError.message?.toLowerCase().includes('not authenticated') ||
          updateError.message?.toLowerCase().includes('invalid token') ||
          updateError.message?.toLowerCase().includes('expired')) {
        setError('Your session has expired. Please request a new password reset link.');
      } else {
        setError(updateError.message || 'Failed to update password. Please try again.');
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    console.log('[ResetPassword] Password updated successfully');

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

  // Show loading while setting session
  if (isSettingSession) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <LinearGradient
          colors={[
            'rgba(35, 75, 50, 0.92)',
            'rgba(45, 90, 61, 0.88)',
            'rgba(55, 100, 70, 0.85)',
          ]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <ActivityIndicator size="large" color="#FFFFFF" />
        <Text style={styles.loadingText}>Verifying reset link...</Text>
      </View>
    );
  }

  // Show error state if no session
  if (!sessionReady && error) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <LinearGradient
          colors={[
            'rgba(35, 75, 50, 0.92)',
            'rgba(45, 90, 61, 0.88)',
            'rgba(55, 100, 70, 0.85)',
          ]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={styles.errorIconContainer}>
          <AlertCircle size={48} color="#FFFFFF" />
        </View>
        <Text style={styles.errorTitle}>Unable to Reset Password</Text>
        <Text style={styles.errorDescription}>{error}</Text>
        <Pressable
          onPress={() => router.replace('/auth/login')}
          style={styles.errorButton}
        >
          <Text style={styles.errorButtonText}>Back to Login</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Background image with blur effect */}
      <ImageBackground
        source={{
          uri: 'https://images.unsplash.com/photo-1500651230702-0e2d8a49d4ad?w=800&q=80',
        }}
        style={StyleSheet.absoluteFillObject}
        blurRadius={25}
      >
        {/* Heavy green overlay with subtle vertical gradient */}
        <LinearGradient
          colors={[
            'rgba(35, 75, 50, 0.92)',
            'rgba(45, 90, 61, 0.88)',
            'rgba(55, 100, 70, 0.85)',
          ]}
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
              <Text style={styles.subtitle}>Enter your new password below</Text>
            </View>

            {/* Card */}
            <View style={styles.card}>
              {error ? (
                <View style={styles.formErrorContainer}>
                  <Text style={styles.formErrorText}>{error}</Text>
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
                <Pressable
                  onPress={() => setShowPassword(!showPassword)}
                  hitSlop={10}
                >
                  {showPassword ? (
                    <EyeOff size={22} color="#717171" />
                  ) : (
                    <Eye size={22} color="#717171" />
                  )}
                </Pressable>
              </View>

              {/* Password requirement hint */}
              <View style={styles.hintContainer}>
                <Check
                  size={14}
                  color={password.length >= 8 ? '#2D5A3D' : '#9CA3AF'}
                />
                <Text
                  style={[
                    styles.hintText,
                    password.length >= 8 && styles.hintTextValid,
                  ]}
                >
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
                <Pressable
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  hitSlop={10}
                >
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
                  <Check
                    size={14}
                    color={password === confirmPassword ? '#2D5A3D' : '#DC2626'}
                  />
                  <Text
                    style={[
                      styles.hintText,
                      password === confirmPassword
                        ? styles.hintTextValid
                        : styles.hintTextInvalid,
                    ]}
                  >
                    {password === confirmPassword
                      ? 'Passwords match'
                      : 'Passwords do not match'}
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
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 16,
    marginTop: 16,
  },
  errorIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  errorTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  errorDescription: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
  },
  errorButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  errorButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
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
  formErrorContainer: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  formErrorText: {
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
