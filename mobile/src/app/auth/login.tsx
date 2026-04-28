import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Alert,
  Image,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { CommonActions } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { SPLASH_GRADIENT, SPLASH_OVERLAY } from '@/lib/brand-colors';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react-native';
import Animated, { FadeIn, FadeInUp, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useUserStore, isAdminEmail } from '@/lib/user-store';
import { supabaseAuthSignIn, isSupabaseConfigured, setSupabaseSession, supabaseResetPassword, fetchProfileAvatarUrl, supabaseSignInWithOAuth, fetchSupabaseProfileFull } from '@/lib/supabase';
import { registerPushTokenForCurrentUser } from '@/lib/push';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LegalModal } from '@/components/LegalModal';
import { useAuth } from '@/providers/AuthProvider';
import Svg, { Path } from 'react-native-svg';

const LOGO_WIDTH = 300;
const LOGO_HEIGHT = 112;

function GoogleIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <Path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <Path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <Path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </Svg>
  );
}

function AppleIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11" fill="white" />
    </Svg>
  );
}

export default function LoginScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { email: prefilledEmail } = useLocalSearchParams<{ email?: string }>();
  const signIn = useUserStore((s) => s.signIn);
  const loadUser = useUserStore((s) => s.loadUser);
  const continueAsGuest = useUserStore((s) => s.continueAsGuest);
  const { notifySessionChanged } = useAuth();

  const [email, setEmail] = useState(prefilledEmail ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const socialLoadingRef = useRef(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [error, setError] = useState('');
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  // Legal modal state
  const [legalModalVisible, setLegalModalVisible] = useState(false);
  const [legalModalType, setLegalModalType] = useState<'terms' | 'privacy'>('terms');

  // Button press animation
  const buttonScale = useSharedValue(1);
  const createScale = useSharedValue(1);

  const animatedButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const createAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: createScale.value }],
  }));

  const handlePressIn = () => {
    buttonScale.value = withTiming(0.98, { duration: 100 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  const handleCreatePressIn = () => {
    createScale.value = withTiming(0.98, { duration: 100 });
  };

  const handleCreatePressOut = () => {
    createScale.value = withSpring(1, { damping: 15, stiffness: 400 });
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

      if (authError) {
        console.log('[Login] Supabase auth failed:', authError.message);
        setIsLoading(false);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        const msg = (authError.message ?? '').toLowerCase();
        let friendlyError = 'Something went wrong. Please try again.';
        if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
          friendlyError = 'Incorrect email or password.';
        } else if (msg.includes('invalid email') || msg.includes('unable to validate email')) {
          friendlyError = 'Please enter a valid email address.';
        } else if (msg.includes('network') || msg.includes('fetch') || msg.includes('connection')) {
          friendlyError = 'Check your internet connection and try again.';
        } else if (msg.includes('too many') || msg.includes('rate limit')) {
          friendlyError = 'Too many attempts. Please wait a moment and try again.';
        } else if (msg.includes('email not confirmed')) {
          friendlyError = 'Please check your email to confirm your account.';
        }
        setError(friendlyError);
        return;
      }

      if (data?.user) {
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
          notifySessionChanged();
        }

        const fullName = data.user.user_metadata?.full_name || email.split('@')[0];
        const names = fullName.split(' ');
        const initials = names.map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);

        const userRole = isAdminEmail(data.user.email) ? 'admin' : 'consumer';

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
          id: data.user.id,
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

        await loadUser();

        // HARD GUARANTEE: force push token registration immediately after login.
        // This runs asynchronously so it does not block navigation.
        console.log('[PushDebug][Login] Auth success — forcing push token registration for userId:', data.user.id);
        registerPushTokenForCurrentUser(data.user.id).catch((err) => {
          console.log('[PushDebug][Login] Push token registration error (non-fatal):', err);
        });

        // Navigate first — keep loading state so the form never flashes back to
        // interactive while the transition is in progress.  The component unmounts
        // after the reset so setIsLoading is not needed.
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: '(tabs)' }] }));
        return;
      }
    }

    // Fallback to local signin
    const result = await signIn(cleanEmail, cleanPassword);

    if (result.success) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: '(tabs)' }] }));
    } else {
      setIsLoading(false);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError('Incorrect email or password.');
    }
  };

  const handleSocialLogin = async (provider: 'google' | 'apple') => {
    if (socialLoadingRef.current) return;
    try {
      socialLoadingRef.current = true;
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setError('');

      const { data, error: authError } = await supabaseSignInWithOAuth(provider);

      if (authError) {
        socialLoadingRef.current = false;
        if (authError.message === 'Sign in cancelled') return;
        Alert.alert('Login failed', 'Please try again.');
        return;
      }

      if (data?.user && data?.session) {
        await setSupabaseSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
          expires_in: data.session.expires_in,
        });
        notifySessionChanged();

        const userId = data.user.id;

        // Always fetch fresh profile from Supabase — it is the source of truth.
        // AsyncStorage is a local cache for app-specific fields only (counts, role, etc.)
        const supabaseProfile = await fetchSupabaseProfileFull(userId);

        const storedRaw = await AsyncStorage.getItem('farmstand_user');
        const cachedProfile = storedRaw ? JSON.parse(storedRaw) : null;
        const hasCacheForThisUser = cachedProfile?.id === userId;

        let userProfile;
        if (supabaseProfile) {
          // Returning user — start from cache (preserves visitedCount, role, name, etc.)
          // then overlay fresh Supabase avatar so photo is never stale
          const base = hasCacheForThisUser ? cachedProfile : (() => {
            const fullName = (data.user.user_metadata?.full_name as string) || data.user.email?.split('@')[0] || 'User';
            const names = fullName.split(' ');
            const initials = names.map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
            return {
              id: userId,
              name: fullName,
              email: data.user.email,
              initials,
              memberSince: new Date().getFullYear(),
              visitedCount: 0,
              reviewsCount: 0,
              savedCount: 0,
              isFarmer: false,
              role: isAdminEmail(data.user.email) ? 'admin' : 'consumer',
            };
          })();

          userProfile = {
            ...base,
            // Supabase avatar_url is always fresh — wins over anything in cache
            ...(supabaseProfile.avatar_url ? { profilePhoto: supabaseProfile.avatar_url } : {}),
          };
        } else {
          // New user — build initial profile from OAuth provider data
          const fullName = (data.user.user_metadata?.full_name as string) || data.user.email?.split('@')[0] || 'User';
          const names = fullName.split(' ');
          const initials = names.map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
          const userRole = isAdminEmail(data.user.email) ? 'admin' : 'consumer';

          // Supabase is source of truth; OAuth photo is only a first-signup seed
          let avatarUrl: string | undefined;
          try {
            const fetched = await fetchProfileAvatarUrl(userId);
            if (fetched) avatarUrl = fetched;
          } catch {}
          if (!avatarUrl) {
            const metaAvatar = data.user.user_metadata?.avatar_url as string | undefined;
            if (metaAvatar) avatarUrl = metaAvatar;
          }

          userProfile = {
            id: userId,
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
        }

        await AsyncStorage.setItem('farmstand_user', JSON.stringify(userProfile));
        await AsyncStorage.setItem('farmstand_logged_in', 'true');
        await loadUser();

        // HARD GUARANTEE: force push token registration immediately after social login.
        console.log('[PushDebug][SocialLogin] Auth success — forcing push token registration for userId:', userId);
        registerPushTokenForCurrentUser(userId).catch((err) => {
          console.log('[PushDebug][SocialLogin] Push token registration error (non-fatal):', err);
        });

        socialLoadingRef.current = false;
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: '(tabs)' }] }));
      } else {
        socialLoadingRef.current = false;
        Alert.alert('Login failed', 'Please try again.');
      }
    } catch {
      socialLoadingRef.current = false;
      Alert.alert('Login failed', 'Please try again.');
    }
  };

  const handleSignUp = () => {
    router.push('/auth/signup');
  };

  const handleForgotPassword = async () => {
    if (isResettingPassword) return;

    if (!email.trim()) {
      Alert.alert('Email Required', 'Enter your email first.');
      return;
    }

    if (!isSupabaseConfigured()) {
      Alert.alert('Error', 'Password reset is not available at this time.');
      return;
    }

    setIsResettingPassword(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const { error: resetError } = await supabaseResetPassword(email.trim());

    setIsResettingPassword(false);

    if (resetError) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Failed to send reset email. Please try again.');
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

  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const isTablet = screenWidth >= 768;
  const anyLoading = isLoading;

  // Header height: top safe area + logo + tight padding
  const headerHeight = insets.top + LOGO_HEIGHT + 12;

  return (
    <View style={styles.container}>
      {/* Full-screen background — exact same gradient as splash/loading screen */}
      <LinearGradient
        colors={SPLASH_GRADIENT}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={StyleSheet.flatten([StyleSheet.absoluteFillObject, { backgroundColor: SPLASH_OVERLAY }])} />

      {/* ── Logo header — fixed height, OUTSIDE KeyboardAvoidingView ── */}
      <Animated.View
        entering={FadeIn.duration(600)}
        style={[styles.logoHeader, { height: headerHeight, paddingTop: insets.top + 8 }]}
      >
        <Image
          source={require('../../../assets/farmstand-logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </Animated.View>

      {/* ── Sheet — fills remaining space, KAV pushes it up on keyboard ── */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kavWrapper}
      >
        {/* On tablet: center the card. On phone: full-width bottom sheet */}
        <View style={isTablet ? styles.tabletSheetWrapper : null}>
          <Animated.View
            entering={FadeInUp.delay(180).duration(420)}
            style={[
              styles.sheet,
              isTablet && {
                borderRadius: 28,
                width: Math.min(560, screenWidth * 0.72),
                alignSelf: 'center' as const,
                marginBottom: Math.max(insets.bottom + 40, 60),
              },
            ]}
            pointerEvents={anyLoading ? 'none' : 'auto'}
          >
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces={false}
            contentContainerStyle={[
              styles.sheetContent,
              { paddingBottom: Math.max(insets.bottom, 16) + 10 },
            ]}
          >
            {/* Drag handle */}
            <View style={styles.dragHandle} />

            {/* Header text */}
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Welcome back to Farmstand</Text>
              <Text style={styles.headerSubtitle}>Sign in to save your favorite farmstands</Text>
            </View>

            {/* Error banner */}
            <View style={[styles.errorContainer, !error && styles.errorHidden]}>
              <Text style={styles.errorText}>{error || ' '}</Text>
            </View>

            {/* Email + Password grouped for iOS autofill */}
            <View>
              {/* Email */}
              <View style={[styles.inputRow, emailFocused && styles.inputFocused, anyLoading && styles.inputDisabled]}>
                <Mail size={19} color={anyLoading ? '#C8C8C8' : emailFocused ? '#2D5A3D' : '#999999'} />
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email address"
                  placeholderTextColor="#ABABAB"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="username"
                  autoComplete="username"
                  importantForAutofill="yes"
                  returnKeyType="next"
                  editable={!anyLoading}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                  style={[styles.input, anyLoading && styles.inputTextDisabled]}
                />
              </View>

              {/* Password */}
              <View style={[styles.inputRow, passwordFocused && styles.inputFocused, anyLoading && styles.inputDisabled]}>
                <Lock size={19} color={anyLoading ? '#C8C8C8' : passwordFocused ? '#2D5A3D' : '#999999'} />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password"
                  placeholderTextColor="#ABABAB"
                  secureTextEntry={!showPassword}
                  textContentType="password"
                  autoComplete="password"
                  importantForAutofill="yes"
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  editable={!anyLoading}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  style={[styles.input, anyLoading && styles.inputTextDisabled]}
                />
                <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={12} disabled={anyLoading}>
                  {showPassword
                    ? <EyeOff size={19} color={anyLoading ? '#C8C8C8' : '#999999'} />
                    : <Eye size={19} color={anyLoading ? '#C8C8C8' : '#999999'} />
                  }
                </Pressable>
              </View>
            </View>

            {/* Forgot password */}
            <Pressable
              style={styles.forgotRow}
              onPress={handleForgotPassword}
              disabled={isResettingPassword || anyLoading}
            >
              {isResettingPassword
                ? <ActivityIndicator size="small" color="#3A7A52" />
                : <Text style={[styles.forgotText, anyLoading && styles.forgotDisabled]}>Forgot password?</Text>
              }
            </Pressable>

            {/* ── Sign In ── */}
            <Animated.View style={[styles.signInBtn, isLoading && styles.signInBtnLoading, animatedButtonStyle]}>
              <Pressable
                onPress={handleLogin}
                onPressIn={handlePressIn}
                onPressOut={handlePressOut}
                disabled={anyLoading}
                style={styles.btnPressable}
              >
                <View style={[styles.btnContent, { opacity: isLoading ? 0 : 1, position: isLoading ? 'absolute' : 'relative' }]}>
                  <Text style={styles.signInBtnText}>Sign In</Text>
                </View>
                <View style={[styles.btnContent, { opacity: isLoading ? 1 : 0, position: isLoading ? 'relative' : 'absolute' }]}>
                  <ActivityIndicator color="white" size="small" style={{ marginRight: 8 }} />
                  <Text style={styles.signInBtnText}>Signing In...</Text>
                </View>
              </Pressable>
            </Animated.View>

            {/* ── Divider ── */}
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or continue with</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* ── Google button ── */}
            <View style={styles.googleBtn}>
              <Pressable
                onPress={() => handleSocialLogin('google')}
                disabled={anyLoading}
                style={styles.socialBtnPressable}
              >
                <View style={styles.socialIconSlot}>
                  <GoogleIcon />
                </View>
                <Text style={styles.googleBtnText}>Continue with Google</Text>
                <View style={styles.socialIconSlot} />
              </Pressable>
            </View>

            {/* ── Apple button — iOS only ── */}
            {Platform.OS === 'ios' && (
              <View style={styles.appleBtn}>
                <Pressable
                  onPress={() => handleSocialLogin('apple')}
                  disabled={anyLoading}
                  style={styles.socialBtnPressable}
                >
                  <View style={styles.socialIconSlot}>
                    <AppleIcon />
                  </View>
                  <Text style={styles.appleBtnText}>Continue with Apple</Text>
                  <View style={styles.socialIconSlot} />
                </Pressable>
              </View>
            )}

            {/* ── Create Account ── */}
            <Animated.View style={[styles.createBtn, anyLoading && styles.createBtnDisabled, createAnimatedStyle]}>
              <Pressable
                onPress={handleSignUp}
                onPressIn={handleCreatePressIn}
                onPressOut={handleCreatePressOut}
                disabled={anyLoading}
                style={({ pressed }) => [
                  styles.btnPressable,
                  pressed && !anyLoading && styles.createBtnPressed,
                ]}
              >
                <Text style={[styles.createBtnText, anyLoading && styles.createBtnTextDisabled]}>
                  Create Account
                </Text>
              </Pressable>
            </Animated.View>

            {/* ── Continue as Guest ── */}
            <Pressable
              onPress={handleContinueAsGuest}
              disabled={anyLoading}
              style={styles.guestBtn}
            >
              <Text style={[styles.guestBtnText, anyLoading && styles.guestBtnTextDisabled]}>
                Continue as Guest
              </Text>
            </Pressable>

            {/* Terms */}
            <View style={styles.termsRow}>
              <Text style={styles.terms}>By continuing, you agree to our </Text>
              <Pressable
                onPress={() => { if (!anyLoading) { setLegalModalType('terms'); setLegalModalVisible(true); } }}
                style={({ pressed }) => [styles.linkWrapper, pressed && styles.linkPressed]}
              >
                <Text style={styles.termsLink}>Terms of Service</Text>
              </Pressable>
              <Text style={styles.terms}> and </Text>
              <Pressable
                onPress={() => { if (!anyLoading) { setLegalModalType('privacy'); setLegalModalVisible(true); } }}
                style={({ pressed }) => [styles.linkWrapper, pressed && styles.linkPressed]}
              >
                <Text style={styles.termsLink}>Privacy Policy</Text>
              </Pressable>
              <Text style={styles.terms}>.</Text>
            </View>
          </ScrollView>
        </Animated.View>
        </View>
      </KeyboardAvoidingView>

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

  // ── Logo header ────────────────────────────────────────────────────────────
  // Fixed height set via inline style (insets.top + LOGO_HEIGHT + 56)
  // Lives OUTSIDE the KAV so it never gets compressed by keyboard
  logoHeader: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 12,
  },
  logo: {
    width: LOGO_WIDTH,
    height: LOGO_HEIGHT,
    tintColor: '#FFFFFF',
  },

  // ── KeyboardAvoidingView wrapper ──────────────────────────────────────────
  kavWrapper: {
    flex: 1,
    justifyContent: 'flex-end',
  },

  // On tablet: fills remaining space and centers the sheet vertically
  tabletSheetWrapper: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 0,
  },

  // ── Bottom sheet ─────────────────────────────────────────────────────────
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 10,
    maxHeight: '98%',
  },
  sheetContent: {
    paddingTop: 12,
    paddingHorizontal: 24,
  },

  // Drag handle
  dragHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E2E2',
    marginBottom: 20,
  },

  // ── Header text ───────────────────────────────────────────────────────────
  header: {
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A1A',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: 6,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#9A9A9A',
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 20,
  },

  // ── Error banner ──────────────────────────────────────────────────────────
  errorContainer: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorHidden: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    paddingVertical: 0,
    paddingHorizontal: 0,
    marginBottom: 0,
    height: 0,
    overflow: 'hidden',
  },
  errorText: {
    color: '#DC2626',
    fontSize: 13.5,
    fontWeight: '500',
    lineHeight: 18,
  },

  // ── Inputs ───────────────────────────────────────────────────────────────
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFEFEF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    paddingHorizontal: 16,
    height: 56,
    marginBottom: 12,
  },
  inputDisabled: {
    backgroundColor: '#F5F5F5',
    borderColor: '#DEDEDE',
  },
  inputFocused: {
    borderColor: '#2D5A3D',
    borderWidth: 1.5,
    backgroundColor: '#FAFFFE',
  },
  input: {
    flex: 1,
    marginLeft: 12,
    fontSize: 15.5,
    color: '#1A1A1A',
  },
  inputTextDisabled: {
    color: '#B8B8B8',
  },

  // ── Forgot password ───────────────────────────────────────────────────────
  forgotRow: {
    alignSelf: 'flex-end',
    marginTop: -4,
    marginBottom: 16,
    minHeight: 22,
    justifyContent: 'center',
  },
  forgotText: {
    color: '#3A7A52',
    fontSize: 13.5,
    fontWeight: '500',
  },
  forgotDisabled: {
    color: '#C0C0C0',
  },

  // ── Sign In ───────────────────────────────────────────────────────────────
  signInBtn: {
    borderRadius: 14,
    height: 56,
    width: '100%',
    backgroundColor: '#2D5A3D',
    marginBottom: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  signInBtnLoading: {
    backgroundColor: '#3D7A52',
    shadowOpacity: 0.10,
  },
  btnPressable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signInBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.1,
  },

  // ── Divider ───────────────────────────────────────────────────────────────
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E8E8E8',
  },
  dividerText: {
    fontSize: 12.5,
    color: '#ABABAB',
    fontWeight: '500',
    marginHorizontal: 12,
    letterSpacing: 0.1,
  },

  // ── Social buttons ────────────────────────────────────────────────────────
  // Outer View carries all visual styles; inner Pressable handles touch.
  // This avoids function-callback style composition issues in RN 0.76.
  googleBtn: {
    height: 56,
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  appleBtn: {
    height: 56,
    width: '100%',
    backgroundColor: '#000000',
    borderRadius: 14,
    marginBottom: 16,
    overflow: 'hidden',
  },
  socialBtnPressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  socialIconSlot: {
    width: 36,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleBtnText: {
    flex: 1,
    color: '#1A1A1A',
    fontSize: 15.5,
    fontWeight: '500',
    textAlign: 'center',
  },
  appleBtnText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15.5,
    fontWeight: '500',
    textAlign: 'center',
  },

  // ── Create Account ────────────────────────────────────────────────────────
  createBtn: {
    borderRadius: 14,
    height: 56,
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#4A8A5C',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  createBtnPressed: {
    backgroundColor: '#F4FAF6',
  },
  createBtnDisabled: {
    borderColor: '#E0E0E0',
    opacity: 0.55,
  },
  createBtnText: {
    color: '#2D5A3D',
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  createBtnTextDisabled: {
    color: '#AAAAAA',
  },

  // ── Continue as Guest ─────────────────────────────────────────────────────
  guestBtn: {
    alignItems: 'center',
    marginTop: 8,
    paddingVertical: 6,
    width: '100%',
  },
  guestBtnText: {
    color: '#5A5A5A',
    fontSize: 14,
    fontWeight: '500',
  },
  guestBtnTextDisabled: {
    color: '#D0D0D0',
  },

  // ── Terms ─────────────────────────────────────────────────────────────────
  terms: {
    fontSize: 11,
    color: '#C0C0C0',
    lineHeight: 17,
    letterSpacing: 0,
  },
  termsLink: {
    color: '#4A8A62',
    fontWeight: '500',
    fontSize: 11,
    lineHeight: 17,
  },
  termsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  linkWrapper: {
    borderRadius: 6,
  },
  linkPressed: {
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
});
