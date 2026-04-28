import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useNavigation } from 'expo-router';
import { CommonActions } from '@react-navigation/native';
import { User, Mail, Lock, Eye, EyeOff, Square, CheckSquare } from 'lucide-react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { useUserStore, isAdminEmail } from '@/lib/user-store';
import { supabaseAuthSignUp, isSupabaseConfigured, SupabaseError, setSupabaseSession, fetchProfileAvatarUrl, supabaseSignInWithOAuth, fetchSupabaseProfileFull } from '@/lib/supabase';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logSignupStart, logSignupComplete } from '@/lib/analytics-events';
import { LegalModal } from '@/components/LegalModal';
import { useAuth } from '@/providers/AuthProvider';
import Svg, { Path } from 'react-native-svg';

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

export default function SignUpScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { notifySessionChanged } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [signupTosAccepted, setSignupTosAccepted] = useState(false);

  // Legal modal state
  const [legalModalVisible, setLegalModalVisible] = useState(false);
  const [legalModalType, setLegalModalType] = useState<'terms' | 'privacy'>('terms');

  // Single-submit lock - prevents multiple API calls
  const isSubmittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const socialLoadingRef = useRef(false);

  // Rate limit retry countdown
  const [retryCountdown, setRetryCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refs for input fields
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);

  // Focus states for input highlight
  const [nameFocused, setNameFocused] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [confirmFocused, setConfirmFocused] = useState(false);

  // Submit button press animation
  const submitScale = useSharedValue(1);
  const animatedSubmitStyle = useAnimatedStyle(() => ({
    transform: [{ scale: submitScale.value }],
  }));
  const handleSubmitPressIn = () => {
    submitScale.value = withTiming(0.98, { duration: 100 });
  };
  const handleSubmitPressOut = () => {
    submitScale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  // Swipe-down-to-dismiss
  // Start off-screen so the entrance is driven purely by useAnimatedStyle,
  // avoiding the Reanimated "transform overwritten by layout animation" conflict.
  const sheetTranslateY = useSharedValue(700);
  const animatedSheetDragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetTranslateY.value }],
  }));
  const goBack = useCallback(() => router.back(), [router]);
  const dismissKeyboard = useCallback(() => Keyboard.dismiss(), []);

  // Slide in on mount
  useEffect(() => {
    sheetTranslateY.value = withSpring(0, { damping: 26, stiffness: 280 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shared dismiss: animate the whole screen down, then pop the route
  const dismissWithAnimation = useCallback(() => {
    sheetTranslateY.value = withSpring(900, { damping: 25, stiffness: 150 }, () => {
      runOnJS(goBack)();
    });
  }, [goBack, sheetTranslateY]);

  const panGesture = Gesture.Pan()
    .onBegin(() => {
      runOnJS(dismissKeyboard)();
    })
    .onUpdate((e) => {
      sheetTranslateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      const shouldDismiss = e.translationY > 120 || e.velocityY > 600;
      if (shouldDismiss) {
        sheetTranslateY.value = withSpring(900, { damping: 25, stiffness: 150 }, () => {
          runOnJS(goBack)();
        });
      } else {
        sheetTranslateY.value = withSpring(0, { damping: 20, stiffness: 300 });
      }
    });

  // Cleanup countdown on unmount
  useEffect(() => {
    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
      }
    };
  }, []);

  // Start a 10-second countdown for rate limit retry
  const startRetryCountdown = useCallback(() => {
    setRetryCountdown(10);
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
    }
    countdownRef.current = setInterval(() => {
      setRetryCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Navigate to login screen with prefilled email
  const goToLoginWithEmail = (userEmail: string) => {
    router.replace({
      pathname: '/auth/login',
      params: { email: userEmail },
    });
  };

  // Log the user in locally and navigate to the app
  const loginAndNavigate = async (userId: string, userName: string, userEmail: string, session?: { access_token: string; refresh_token: string; expires_at?: number } | null) => {
    const names = userName.split(' ');
    const initials = names.map(n => n[0]).join('').toUpperCase().slice(0, 2);

    const userRole = isAdminEmail(userEmail) ? 'admin' as const : 'consumer' as const;

    const userProfile = {
      id: userId,
      name: userName,
      email: userEmail,
      initials,
      memberSince: new Date().getFullYear(),
      visitedCount: 0,
      reviewsCount: 0,
      savedCount: 0,
      isFarmer: false,
      role: userRole,
    };

    await AsyncStorage.setItem('farmstand_user', JSON.stringify(userProfile));
    await AsyncStorage.setItem('farmstand_logged_in', 'true');

    if (session?.access_token) {
      await setSupabaseSession(session);
      notifySessionChanged();
      console.log('[SignUp] Session stored and AuthProvider notified');
    }

    const registeredUsersData = await AsyncStorage.getItem('farmstand_registered_users');
    const registeredUsers: Array<{ email: string; password: string; name: string; id?: string }> =
      registeredUsersData ? JSON.parse(registeredUsersData) : [];

    const existingIdx = registeredUsers.findIndex(u => u.email.toLowerCase() === userEmail.toLowerCase());
    if (existingIdx === -1) {
      registeredUsers.push({ email: userEmail, password, name: userName, id: userId });
      await AsyncStorage.setItem('farmstand_registered_users', JSON.stringify(registeredUsers));
    }

    useUserStore.setState({ user: userProfile, isLoggedIn: true });

    // Reset the entire navigation stack to (tabs) so neither the signup modal
    // nor the login screen underneath it can flash during the transition.
    navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: '(tabs)' }] }));
  };

  const handleSignUp = async () => {
    if (isSubmittingRef.current) {
      console.log('[SignUp] Blocked duplicate submission');
      return;
    }

    if (retryCountdown > 0) {
      console.log('[SignUp] Blocked - retry countdown active:', retryCountdown);
      return;
    }

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedName) {
      setError('Please enter your name');
      return;
    }
    if (!trimmedEmail) {
      setError('Please enter your email');
      return;
    }
    if (!trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
      setError('Please enter a valid email');
      return;
    }
    if (!password) {
      setError('Please enter a password');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setError('');

    logSignupStart();

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      if (isSupabaseConfigured()) {
        console.log('[SignUp] Calling Supabase signUp for:', trimmedEmail);

        const { data, error: authError } = await supabaseAuthSignUp(
          trimmedEmail,
          password,
          { full_name: trimmedName }
        );

        if (authError) {
          const supabaseErr = authError as SupabaseError;
          console.log('[SignUp] Error:', supabaseErr.status, supabaseErr.code, supabaseErr.message);

          if (
            supabaseErr.status === 429 ||
            supabaseErr.code === 'over_email_send_rate_limit' ||
            supabaseErr.message?.toLowerCase().includes('rate limit') ||
            supabaseErr.message?.toLowerCase().includes('too many')
          ) {
            console.log('[SignUp] Rate limit hit - allowing retry in 10 seconds');
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setError('Too many requests. Please wait a moment and try again.');
            startRetryCountdown();
            return;
          }

          if (
            supabaseErr.message?.toLowerCase().includes('already registered') ||
            supabaseErr.message?.toLowerCase().includes('already exists') ||
            supabaseErr.message?.toLowerCase().includes('user already') ||
            supabaseErr.code === 'user_already_exists'
          ) {
            console.log('[SignUp] User already exists, routing to login');
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setError('An account with this email already exists. Please log in.');
            setTimeout(() => {
              goToLoginWithEmail(trimmedEmail);
            }, 1500);
            return;
          }

          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setError('Unable to create account. Please try again.');
          return;
        }

        if (data?.user) {
          console.log('[SignUp] Success - logging in and navigating to app');
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          logSignupComplete(data.user.id);
          const session = data.session as { access_token: string; refresh_token: string; expires_at?: number } | null;
          await loginAndNavigate(data.user.id, trimmedName, trimmedEmail, session);
        }
      } else {
        console.log('[SignUp] Supabase not configured, using local signup');
        const signUp = useUserStore.getState().signUp;
        const result = await signUp(trimmedName, trimmedEmail, password);

        if (result.success) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.replace('/(tabs)');
        } else {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setError('Unable to create account. Please try again.');
        }
      }
    } catch (err) {
      console.error('[SignUp] Unexpected error:', err);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError('Something went wrong. Please try again.');
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
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
              role: isAdminEmail(data.user.email) ? 'admin' as const : 'consumer' as const,
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
          const userRole = isAdminEmail(data.user.email) ? 'admin' as const : 'consumer' as const;

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
        useUserStore.setState({ user: userProfile, isLoggedIn: true });

        socialLoadingRef.current = false;
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace('/(tabs)');
      } else {
        socialLoadingRef.current = false;
        Alert.alert('Login failed', 'Please try again.');
      }
    } catch {
      socialLoadingRef.current = false;
      Alert.alert('Login failed', 'Please try again.');
    }
  };

  const insets = useSafeAreaInsets();
  const anyLoading = isSubmitting || retryCountdown > 0;
  const isDisabled = isSubmitting || retryCountdown > 0 || !signupTosAccepted;

  return (
    <View style={styles.container}>
      {/* Transparent container — Login screen is visible behind via transparentModal.
          Only the white sheet is animated; dragging reveals Login cleanly underneath. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <Animated.View style={animatedSheetDragStyle}>
          {/* White sheet — the only thing that moves */}
          <View
            style={styles.sheet}
            pointerEvents={anyLoading ? 'none' : 'auto'}
          >
            {/* Drag handle — gesture zone for swipe-to-dismiss */}
            <GestureDetector gesture={panGesture}>
              <View style={styles.handleZone}>
                <View style={styles.dragHandle} />
              </View>
            </GestureDetector>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              bounces={false}
              contentContainerStyle={[
                styles.sheetContent,
                { paddingBottom: Math.max(insets.bottom, 16) + 32 },
              ]}
            >
              {/* Header */}
              <View style={styles.header}>
                <Text style={styles.headerTitle}>Create Account</Text>
                <Text style={styles.headerSubtitle}>Join Farmstand and discover local farms</Text>
              </View>

              {/* Error banner */}
              <View style={[styles.errorContainer, !error && styles.errorHidden]}>
                <Text style={styles.errorText}>{error || ' '}</Text>
              </View>

              {/* Full Name */}
              <View style={[styles.inputRow, nameFocused && styles.inputFocused, anyLoading && styles.inputDisabled]}>
                <User size={19} color={anyLoading ? '#C8C8C8' : nameFocused ? '#2D5A3D' : '#999999'} />
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Full name"
                  placeholderTextColor="#ABABAB"
                  autoCapitalize="words"
                  returnKeyType="next"
                  onSubmitEditing={() => emailRef.current?.focus()}
                  blurOnSubmit={false}
                  editable={!anyLoading}
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => setNameFocused(false)}
                  style={[styles.input, anyLoading && styles.inputTextDisabled]}
                />
              </View>

              {/* Email */}
              <View style={[styles.inputRow, emailFocused && styles.inputFocused, anyLoading && styles.inputDisabled]}>
                <Mail size={19} color={anyLoading ? '#C8C8C8' : emailFocused ? '#2D5A3D' : '#999999'} />
                <TextInput
                  ref={emailRef}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email address"
                  placeholderTextColor="#ABABAB"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  blurOnSubmit={false}
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
                  ref={passwordRef}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Create a password"
                  placeholderTextColor="#ABABAB"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  returnKeyType="next"
                  onSubmitEditing={() => confirmPasswordRef.current?.focus()}
                  blurOnSubmit={false}
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
              <Text style={styles.helperText}>Must be at least 6 characters</Text>

              {/* Confirm Password */}
              <View style={[styles.inputRow, styles.inputRowSpaced, confirmFocused && styles.inputFocused, anyLoading && styles.inputDisabled]}>
                <Lock size={19} color={anyLoading ? '#C8C8C8' : confirmFocused ? '#2D5A3D' : '#999999'} />
                <TextInput
                  ref={confirmPasswordRef}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm password"
                  placeholderTextColor="#ABABAB"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  returnKeyType="go"
                  enablesReturnKeyAutomatically={true}
                  onSubmitEditing={handleSignUp}
                  editable={!anyLoading}
                  onFocus={() => setConfirmFocused(true)}
                  onBlur={() => setConfirmFocused(false)}
                  style={[styles.input, anyLoading && styles.inputTextDisabled]}
                />
              </View>

              {/* Terms checkbox */}
              <Pressable
                onPress={() => {
                  setSignupTosAccepted(!signupTosAccepted);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                disabled={anyLoading}
                style={styles.checkboxRow}
              >
                <View style={styles.checkboxIcon}>
                  {signupTosAccepted
                    ? <CheckSquare size={22} color="#2D5A3D" />
                    : <Square size={22} color="#BBBBBB" />
                  }
                </View>
                <View style={styles.checkboxLabelRow}>
                  <Text style={styles.checkboxLabel}>I agree to the </Text>
                  <Pressable
                    onPress={() => { setLegalModalType('terms'); setLegalModalVisible(true); }}
                    style={({ pressed }) => [styles.linkWrapper, pressed && styles.linkPressed]}
                  >
                    <Text style={styles.checkboxLink}>Terms of Service</Text>
                  </Pressable>
                  <Text style={styles.checkboxLabel}> and </Text>
                  <Pressable
                    onPress={() => { setLegalModalType('privacy'); setLegalModalVisible(true); }}
                    style={({ pressed }) => [styles.linkWrapper, pressed && styles.linkPressed]}
                  >
                    <Text style={styles.checkboxLink}>Privacy Policy</Text>
                  </Pressable>
                  <Text style={styles.checkboxLabel}>.</Text>
                </View>
              </Pressable>

              {/* Submit button */}
              <Animated.View style={[styles.submitBtn, isDisabled && styles.submitBtnDisabled, animatedSubmitStyle]}>
                <Pressable
                  onPress={handleSignUp}
                  onPressIn={handleSubmitPressIn}
                  onPressOut={handleSubmitPressOut}
                  disabled={isDisabled}
                  style={styles.btnPressable}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="white" />
                  ) : retryCountdown > 0 ? (
                    <Text style={styles.submitBtnText}>Retry in {retryCountdown}s</Text>
                  ) : (
                    <Text style={styles.submitBtnText}>Create Account</Text>
                  )}
                </Pressable>
              </Animated.View>

              {/* ── Social login ── */}
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or continue with</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Google */}
              <View style={styles.googleBtn}>
                <Pressable
                  onPress={() => handleSocialLogin('google')}
                  disabled={anyLoading}
                  style={styles.socialBtnPressable}
                >
                  <View style={styles.socialIconSlot}><GoogleIcon /></View>
                  <Text style={styles.googleBtnText}>Continue with Google</Text>
                  <View style={styles.socialIconSlot} />
                </Pressable>
              </View>

              {/* Apple — iOS only */}
              {Platform.OS === 'ios' && (
                <View style={styles.appleBtn}>
                  <Pressable
                    onPress={() => handleSocialLogin('apple')}
                    disabled={anyLoading}
                    style={styles.socialBtnPressable}
                  >
                    <View style={styles.socialIconSlot}><AppleIcon /></View>
                    <Text style={styles.appleBtnText}>Continue with Apple</Text>
                    <View style={styles.socialIconSlot} />
                  </Pressable>
                </View>
              )}

              {/* Back to Sign In */}
              <Pressable
                onPress={dismissWithAnimation}
                disabled={anyLoading}
                style={styles.backToLoginBtn}
              >
                <Text style={[styles.backToLoginText, anyLoading && styles.backToLoginTextDisabled]}>
                  Back to Sign In
                </Text>
              </Pressable>
            </ScrollView>
          </View>
        </Animated.View>
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
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
  },
  keyboardView: {
    justifyContent: 'flex-end',
  },

  // ── Bottom sheet ──────────────────────────────────────────────────────────
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 10,
    marginBottom: -18,
  },
  sheetContent: {
    paddingTop: 12,
    paddingHorizontal: 24,
  },

  // Drag handle zone — sits above ScrollView, gesture target for swipe-to-dismiss
  handleZone: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 10,
  },

  // Drag handle
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E2E2',
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A1A',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: 8,
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

  // ── Inputs ────────────────────────────────────────────────────────────────
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
  inputRowSpaced: {
    marginTop: 8,
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
  helperText: {
    fontSize: 12,
    color: '#ABABAB',
    marginTop: -6,
    marginBottom: 4,
    marginLeft: 4,
  },

  // ── Checkbox + Terms ──────────────────────────────────────────────────────
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 16,
    marginBottom: 20,
  },
  checkboxIcon: {
    marginTop: 1,
  },
  checkboxLabelRow: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginLeft: 12,
  },
  checkboxLabel: {
    fontSize: 13.5,
    color: '#5A5A5A',
    lineHeight: 20,
  },
  checkboxLink: {
    color: '#2D5A3D',
    fontWeight: '500',
    fontSize: 13.5,
    lineHeight: 20,
  },
  linkWrapper: {
    borderRadius: 6,
  },
  linkPressed: {
    backgroundColor: 'rgba(0,0,0,0.08)',
  },

  // ── Submit button ─────────────────────────────────────────────────────────
  submitBtn: {
    borderRadius: 14,
    height: 56,
    width: '100%',
    backgroundColor: '#2D5A3D',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
    marginBottom: 16,
  },
  submitBtnDisabled: {
    backgroundColor: '#8BAF97',
    shadowOpacity: 0.05,
  },
  btnPressable: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.1,
    includeFontPadding: false,
    textAlignVertical: 'center',
    textAlign: 'center',
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
  // Outer View carries visual styles; inner Pressable handles touch (matches login screen).
  googleBtn: {
    height: 56,
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
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

  // ── Back to Sign In ───────────────────────────────────────────────────────
  backToLoginBtn: {
    alignItems: 'center',
    paddingVertical: 8,
    width: '100%',
  },
  backToLoginText: {
    color: '#5A5A5A',
    fontSize: 14,
    fontWeight: '500',
  },
  backToLoginTextDisabled: {
    color: '#D0D0D0',
  },
});
