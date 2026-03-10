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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useUserStore, isAdminEmail } from '@/lib/user-store';
import { supabaseAuthSignIn, isSupabaseConfigured, setSupabaseSession, supabaseResetPassword, fetchProfileAvatarUrl } from '@/lib/supabase';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'react-native';
import { LegalModal } from '@/components/LegalModal';
import { useAuth } from '@/providers/AuthProvider';

// Logo dimensions - consistent with loading and explore screens
const LOGO_WIDTH = 360;
const LOGO_HEIGHT = 140;

export default function LoginScreen() {
  const router = useRouter();
  const { email: prefilledEmail } = useLocalSearchParams<{ email?: string }>();
  const signIn = useUserStore((s) => s.signIn);
  const loadUser = useUserStore((s) => s.loadUser);
  const continueAsGuest = useUserStore((s) => s.continueAsGuest);
  const { notifySessionChanged } = useAuth();

  const [email, setEmail] = useState(prefilledEmail ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [error, setError] = useState('');

  // Legal modal state
  const [legalModalVisible, setLegalModalVisible] = useState(false);
  const [legalModalType, setLegalModalType] = useState<'terms' | 'privacy'>('terms');

  // Button press animation
  const buttonScale = useSharedValue(1);

  const animatedButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const handlePressIn = () => {
    buttonScale.value = withTiming(0.98, { duration: 100 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  const handleLogin = async () => {
    if (!email.trim()) {
      setError('Please enter your email');
      return;
    }
    if (!password.trim()) {
      setError('Please enter your password');
      return;
    }

    setError('');
    setIsLoading(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    // Try Supabase Auth first if configured
    if (isSupabaseConfigured()) {
      const { data, error: authError } = await supabaseAuthSignIn(cleanEmail, cleanPassword);

      // === LOGIN.TSX SIGN-IN DEBUG ===
      console.log('[Login] supabaseAuthSignIn result:');
      console.log('  error:', authError ? JSON.stringify(authError) : 'null');
      console.log('  data is null:', data === null);
      console.log('  data.user exists:', !!(data?.user));
      console.log('  data.session exists:', !!(data?.session));
      const sess = data?.session;
      console.log('  session.access_token exists:', !!(sess?.access_token));
      console.log('  session.refresh_token exists:', !!(sess?.refresh_token));
      console.log('  session.expires_at:', sess?.expires_at ?? 'MISSING');
      console.log('  session.expires_in:', sess?.expires_in ?? 'MISSING');
      // ================================

      if (authError) {
        // If Supabase auth fails, try local fallback
        console.log('[Login] Supabase auth failed, trying local fallback');
        const result = await signIn(cleanEmail, cleanPassword);

        setIsLoading(false);

        if (result.success) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.replace('/(tabs)');
        } else {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setError(authError.message || result.error || 'Login failed');
        }
        return;
      }

      if (data?.user) {
        // Persist the session to SecureStore immediately after sign-in, before any navigation
        // or store updates. This is the authoritative write — even though supabaseAuthSignIn
        // does it internally, we re-do it here with the full session (including expires_in)
        // to ensure the correct expiry is stored.
        if (data.session) {
          const session = data.session;
          console.log('[Login] Persisting session to SecureStore, expires_in:', session.expires_in, 'expires_at:', session.expires_at);
          const writeOk = await setSupabaseSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            expires_at: session.expires_at,
            expires_in: session.expires_in,
          });
          console.log('[Login] setSupabaseSession write result:', writeOk);
          // Immediately sync AuthProvider so AdminGuard sees the new session
          // without waiting for the 1-second polling interval.
          notifySessionChanged();
        }

        // Store the user data locally with the Supabase UUID
        const fullName = data.user.user_metadata?.full_name || email.split('@')[0];
        const names = fullName.split(' ');
        const initials = names.map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);

        // AUTHORITATIVE: Admin email gets admin role
        const userRole = isAdminEmail(data.user.email) ? 'admin' : 'consumer';

        // Fetch persisted avatar_url from profiles table
        let avatarUrl: string | undefined;
        try {
          const fetchedUrl = await fetchProfileAvatarUrl(data.user.id);
          if (fetchedUrl) {
            avatarUrl = fetchedUrl;
            console.log('[Login] Loaded avatar_url from profiles:', avatarUrl);
          }
        } catch (avatarErr) {
          console.log('[Login] Could not fetch avatar_url (non-fatal):', avatarErr);
        }

        const userProfile = {
          id: data.user.id, // This is the Supabase UUID
          name: fullName,
          email: data.user.email,
          initials,
          memberSince: new Date().getFullYear(),
          visitedCount: 0,
          reviewsCount: 0,
          savedCount: 0,
          isFarmer: false,
          role: userRole,
          ...(avatarUrl ? { profilePhoto: avatarUrl } : {}),
        };

        await AsyncStorage.setItem('farmstand_user', JSON.stringify(userProfile));
        await AsyncStorage.setItem('farmstand_logged_in', 'true');

        // Reload user state
        await loadUser();

        setIsLoading(false);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace('/(tabs)');
        return;
      }
    }

    // Fallback to local signin
    const result = await signIn(cleanEmail, cleanPassword);

    setIsLoading(false);

    if (result.success) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)');
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(result.error || 'Login failed');
    }
  };

  const handleSignUp = () => {
    router.push('/auth/signup');
  };

  const handleForgotPassword = async () => {
    // Prevent double taps while loading
    if (isResettingPassword) return;

    // Check if email is filled
    if (!email.trim()) {
      Alert.alert('Email Required', 'Enter your email first.');
      return;
    }

    // Check if Supabase is configured
    if (!isSupabaseConfigured()) {
      Alert.alert('Error', 'Password reset is not available at this time.');
      return;
    }

    setIsResettingPassword(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Always uses farmstand://auth/callback (hardcoded in supabaseResetPassword)
    const { error: resetError } = await supabaseResetPassword(email.trim());

    setIsResettingPassword(false);

    if (resetError) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', resetError.message || 'Failed to send reset email. Please try again.');
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Check Your Email', 'Check your email for a password reset link.');
    }
  };

  const handleContinueAsGuest = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await continueAsGuest();
    router.replace('/(tabs)');
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
          keyboardVerticalOffset={0}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            // Prevent scroll bouncing from shifting the layout during submit
            bounces={false}
          >
            {/* Logo with fade + scale animation */}
            <Animated.View
              entering={FadeIn.delay(150).duration(600)}
              style={styles.logoContainer}
            >
              <Image
                source={require('../../../assets/farmstand-logo.png')}
                style={styles.logo}
                resizeMode="contain"
              />
            </Animated.View>

            {/* Auth Card — layout is FIXED; nothing inside changes size during submit */}
            {/* pointerEvents disables interaction while submitting without unmounting */}
            <View
              style={styles.card}
              pointerEvents={isLoading ? 'none' : 'auto'}
            >
              {/* Error banner — reserve its space always to avoid layout jump */}
              <View style={[styles.errorContainer, !error && styles.errorHidden]}>
                <Text style={styles.errorText}>{error || ' '}</Text>
              </View>

              {/* Email Input */}
              <View style={[styles.inputContainer, isLoading && styles.inputDisabled]}>
                <Mail size={22} color={isLoading ? '#B0B0B0' : '#717171'} />
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                  style={[styles.input, isLoading && styles.inputTextDisabled]}
                />
              </View>

              {/* Password Input */}
              <View style={[styles.inputContainer, isLoading && styles.inputDisabled]}>
                <Lock size={22} color={isLoading ? '#B0B0B0' : '#717171'} />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password"
                  placeholderTextColor="#9CA3AF"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  editable={!isLoading}
                  style={[styles.input, isLoading && styles.inputTextDisabled]}
                />
                <Pressable
                  onPress={() => setShowPassword(!showPassword)}
                  hitSlop={10}
                  disabled={isLoading}
                >
                  {showPassword ? (
                    <EyeOff size={22} color={isLoading ? '#B0B0B0' : '#717171'} />
                  ) : (
                    <Eye size={22} color={isLoading ? '#B0B0B0' : '#717171'} />
                  )}
                </Pressable>
              </View>

              {/* Sign In Button — fixed height, content swap never changes button size */}
              <Animated.View style={[styles.signInButton, isLoading && styles.signInButtonLoading, animatedButtonStyle]}>
                <Pressable
                  onPress={handleLogin}
                  onPressIn={handlePressIn}
                  onPressOut={handlePressOut}
                  disabled={isLoading}
                  style={styles.signInButtonPressable}
                >
                  {/* Both children always rendered; opacity toggled to avoid layout diff */}
                  <View style={[styles.signInButtonContent, { opacity: isLoading ? 0 : 1, position: isLoading ? 'absolute' : 'relative' }]}>
                    <Text style={styles.signInButtonText}>Sign In</Text>
                  </View>
                  <View style={[styles.signInButtonContent, { opacity: isLoading ? 1 : 0, position: isLoading ? 'relative' : 'absolute' }]}>
                    <ActivityIndicator color="white" size="small" style={{ marginRight: 8 }} />
                    <Text style={styles.signInButtonText}>Signing In...</Text>
                  </View>
                </Pressable>
              </Animated.View>

              {/* Forgot Password */}
              <Pressable
                style={styles.forgotPassword}
                onPress={handleForgotPassword}
                disabled={isResettingPassword || isLoading}
              >
                {isResettingPassword ? (
                  <ActivityIndicator size="small" color="#2D5A3D" />
                ) : (
                  <Text style={[styles.forgotPasswordText, isLoading && styles.forgotPasswordDisabled]}>Forgot password?</Text>
                )}
              </Pressable>

              {/* Divider */}
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Create Account Button */}
              <Pressable
                onPress={handleSignUp}
                disabled={isLoading}
                style={({ pressed }) => [
                  styles.createAccountButton,
                  pressed && !isLoading && styles.createAccountButtonPressed,
                  isLoading && styles.createAccountButtonDisabled,
                ]}
              >
                <Text style={[styles.createAccountText, isLoading && styles.createAccountTextDisabled]}>Create Account</Text>
              </Pressable>

              {/* Continue as Guest */}
              <Pressable
                onPress={handleContinueAsGuest}
                disabled={isLoading}
                style={styles.guestButton}
              >
                <Text style={[styles.guestButtonText, isLoading && styles.guestButtonTextDisabled]}>Continue as Guest</Text>
              </Pressable>

              {/* Terms notice for guest */}
              <Text style={styles.termsNotice}>
                By continuing, you agree to our{' '}
                <Text
                  style={styles.termsLink}
                  onPress={() => {
                    if (isLoading) return;
                    setLegalModalType('terms');
                    setLegalModalVisible(true);
                  }}
                >
                  Terms of Service
                </Text>
                {' '}and{' '}
                <Text
                  style={styles.termsLink}
                  onPress={() => {
                    if (isLoading) return;
                    setLegalModalType('privacy');
                    setLegalModalVisible(true);
                  }}
                >
                  Privacy Policy
                </Text>
                .
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Legal Modal */}
      <LegalModal
        visible={legalModalVisible}
        type={legalModalType}
        onClose={() => setLegalModalVisible(false)}
      />
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
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 10,
  },
  logo: {
    width: LOGO_WIDTH,
    height: LOGO_HEIGHT,
    tintColor: '#FFFFFF',
  },
  card: {
    alignSelf: 'center',
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingTop: 20,
    paddingHorizontal: 22,
    paddingBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 12,
  },
  // Error banner always occupies space — hidden state uses opacity so height never changes
  errorContainer: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  errorHidden: {
    backgroundColor: 'transparent',
    borderRadius: 0,
    padding: 0,
    marginBottom: 0,
    height: 0,
    overflow: 'hidden',
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7F7F7',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    paddingHorizontal: 16,
    height: 56,
    marginBottom: 14,
  },
  inputDisabled: {
    backgroundColor: '#F0F0F0',
    borderColor: '#E0E0E0',
  },
  input: {
    flex: 1,
    marginLeft: 14,
    fontSize: 16,
    color: '#222222',
  },
  inputTextDisabled: {
    color: '#9CA3AF',
  },
  // Sign In button — fixed height, never changes during loading
  signInButton: {
    borderRadius: 16,
    height: 56,
    width: '100%',
    backgroundColor: '#2D5A3D',
    marginTop: 14,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  signInButtonLoading: {
    backgroundColor: '#3D7A52',
  },
  signInButtonPressable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Both label and loading state rendered simultaneously — only opacity changes
  signInButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signInButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: 20,
    minHeight: 22,
    justifyContent: 'center',
  },
  forgotPasswordText: {
    color: '#2D5A3D',
    fontSize: 14,
    fontWeight: '500',
  },
  forgotPasswordDisabled: {
    color: '#A0A0A0',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E5E5',
  },
  dividerText: {
    color: '#9CA3AF',
    fontSize: 13,
    marginHorizontal: 16,
  },
  createAccountButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    height: 56,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#2D5A3D',
  },
  createAccountButtonPressed: {
    backgroundColor: '#F3F4F6',
  },
  createAccountButtonDisabled: {
    borderColor: '#C0C0C0',
    opacity: 0.6,
  },
  createAccountText: {
    color: '#2D5A3D',
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  createAccountTextDisabled: {
    color: '#A0A0A0',
  },
  guestButton: {
    alignItems: 'center',
    marginTop: 20,
    paddingVertical: 8,
    width: '100%',
  },
  guestButtonText: {
    color: '#717171',
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
  guestButtonTextDisabled: {
    color: '#B0B0B0',
  },
  termsNotice: {
    marginTop: 16,
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 18,
  },
  termsLink: {
    color: '#2D5A3D',
    textDecorationLine: 'underline' as const,
  },
});
