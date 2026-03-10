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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { User, Mail, Lock, Eye, EyeOff, ArrowLeft, Square, CheckSquare } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useUserStore, isAdminEmail, ADMIN_EMAIL } from '@/lib/user-store';
import { supabaseAuthSignUp, isSupabaseConfigured, SupabaseError, setSupabaseSession } from '@/lib/supabase';
import * as Haptics from 'expo-haptics';
import { AuthHeader } from '@/components/AuthHeader';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logSignupStart, logSignupComplete } from '@/lib/analytics-events';
import { LegalModal } from '@/components/LegalModal';

export default function SignUpScreen() {
  const router = useRouter();

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

  // Rate limit retry countdown
  const [retryCountdown, setRetryCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refs for input fields
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);

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

    // AUTHORITATIVE: Admin email gets admin role
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

    // Store user data and mark as logged in
    await AsyncStorage.setItem('farmstand_user', JSON.stringify(userProfile));
    await AsyncStorage.setItem('farmstand_logged_in', 'true');

    // CRITICAL: Persist Supabase session to SecureStore for app restarts
    if (session?.access_token) {
      await setSupabaseSession(session);
      console.log('[SignUp] Session stored to SecureStore');
    }

    // Also register in local users list for future logins
    const registeredUsersData = await AsyncStorage.getItem('farmstand_registered_users');
    const registeredUsers: Array<{ email: string; password: string; name: string; id?: string }> =
      registeredUsersData ? JSON.parse(registeredUsersData) : [];

    const existingIdx = registeredUsers.findIndex(u => u.email.toLowerCase() === userEmail.toLowerCase());
    if (existingIdx === -1) {
      registeredUsers.push({ email: userEmail, password, name: userName, id: userId });
      await AsyncStorage.setItem('farmstand_registered_users', JSON.stringify(registeredUsers));
    }

    // Update Zustand store directly
    useUserStore.setState({ user: userProfile, isLoggedIn: true });

    // Navigate to the app
    router.replace('/(tabs)');
  };

  // ONLY called on button press - never on onChange, useEffect, or screen load
  const handleSignUp = async () => {
    // SINGLE-SUBMIT LOCK: Prevent duplicate calls
    if (isSubmittingRef.current) {
      console.log('[SignUp] Blocked duplicate submission');
      return;
    }

    // Block if in retry countdown
    if (retryCountdown > 0) {
      console.log('[SignUp] Blocked - retry countdown active:', retryCountdown);
      return;
    }

    // VALIDATION: Check all fields before calling API
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

    // SET LOCK: Now we're submitting
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setError('');

    // Log signup start to analytics
    logSignupStart();

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      // Use Supabase Auth for signup
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

          // Check for rate limit error (429 or over_email_send_rate_limit)
          // Show friendly message and allow retry in 10 seconds
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

          // Check for user already exists error
          if (
            supabaseErr.message?.toLowerCase().includes('already registered') ||
            supabaseErr.message?.toLowerCase().includes('already exists') ||
            supabaseErr.message?.toLowerCase().includes('user already') ||
            supabaseErr.code === 'user_already_exists'
          ) {
            console.log('[SignUp] User already exists, routing to login');
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setError('An account with this email already exists. Please log in.');
            // After a short delay, navigate to login
            setTimeout(() => {
              goToLoginWithEmail(trimmedEmail);
            }, 1500);
            return;
          }

          // Generic error - show user-friendly message
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setError('Unable to create account. Please try again.');
          return;
        }

        // Success! Log the user in and navigate to the app immediately
        if (data?.user) {
          console.log('[SignUp] Success - logging in and navigating to app');
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          // Log signup complete to analytics
          logSignupComplete(data.user.id);
          // Pass the session to persist it for authenticated API calls
          const session = data.session as { access_token: string; refresh_token: string; expires_at?: number } | null;
          await loginAndNavigate(data.user.id, trimmedName, trimmedEmail, session);
        }
      } else {
        // Fallback to local signup if Supabase is not configured
        console.log('[SignUp] Supabase not configured, using local signup');
        const signUp = useUserStore.getState().signUp;
        const result = await signUp(trimmedName, trimmedEmail, password);

        if (result.success) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.replace('/(tabs)');
        } else {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setError(result.error || 'Sign up failed');
        }
      }
    } catch (err) {
      console.error('[SignUp] Unexpected error:', err);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError('Something went wrong. Please try again.');
    } finally {
      // RELEASE LOCK
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <LinearGradient
      colors={['#3D8B5F', '#2D5A3D', '#1A3D28']}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={{ flex: 1 }}
    >
      <SafeAreaView style={{ flex: 1, justifyContent: 'flex-start', overflow: 'visible' }}>
        {/* Back Button */}
        <View style={{ paddingHorizontal: 24, paddingTop: 16, flexShrink: 0 }}>
          <Pressable
            onPress={() => router.back()}
            disabled={isSubmitting}
            style={{
              width: 40,
              height: 40,
              backgroundColor: 'rgba(255,255,255,0.2)',
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ArrowLeft size={24} color="white" />
          </Pressable>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
          keyboardVerticalOffset={0}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Shared Auth Header - fixed at top */}
            <Animated.View entering={FadeInDown.delay(100).duration(500)} style={{ flexShrink: 0 }}>
              <AuthHeader />
            </Animated.View>

            {/* Auth Card */}
            <Animated.View
              entering={FadeInDown.delay(200).duration(500)}
              style={{
                marginTop: 24,
                backgroundColor: '#FFFFFF',
                borderRadius: 24,
                paddingTop: 22,
                paddingHorizontal: 22,
                paddingBottom: 22,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.15,
                shadowRadius: 16,
                elevation: 8,
              }}
            >
              <Text style={{ fontSize: 24, fontWeight: '700', color: '#222222', marginBottom: 20 }}>
                Create Account
              </Text>

              {error ? (
                <View style={{ backgroundColor: '#FEF2F2', borderRadius: 12, padding: 14, marginBottom: 16 }}>
                  <Text style={{ color: '#DC2626', fontSize: 14 }}>{error}</Text>
                </View>
              ) : null}

              {/* Name Input */}
              <View style={{ marginBottom: 14 }}>
                <Text style={{ fontSize: 14, fontWeight: '500', color: '#6B7280', marginBottom: 8 }}>Full Name</Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: '#F7F7F7',
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: '#E5E5E5',
                    paddingHorizontal: 16,
                    height: 56,
                  }}
                >
                  <User size={22} color="#717171" />
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="Enter your full name"
                    placeholderTextColor="#9CA3AF"
                    autoCapitalize="words"
                    returnKeyType="next"
                    onSubmitEditing={() => emailRef.current?.focus()}
                    blurOnSubmit={false}
                    editable={!isSubmitting}
                    style={{ flex: 1, marginLeft: 14, fontSize: 16, color: '#222222' }}
                  />
                </View>
              </View>

              {/* Email Input */}
              <View style={{ marginBottom: 14 }}>
                <Text style={{ fontSize: 14, fontWeight: '500', color: '#6B7280', marginBottom: 8 }}>Email</Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: '#F7F7F7',
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: '#E5E5E5',
                    paddingHorizontal: 16,
                    height: 56,
                  }}
                >
                  <Mail size={22} color="#717171" />
                  <TextInput
                    ref={emailRef}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="Enter your email"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="next"
                    onSubmitEditing={() => passwordRef.current?.focus()}
                    blurOnSubmit={false}
                    editable={!isSubmitting}
                    style={{ flex: 1, marginLeft: 14, fontSize: 16, color: '#222222' }}
                  />
                </View>
              </View>

              {/* Password Input */}
              <View style={{ marginBottom: 14 }}>
                <Text style={{ fontSize: 14, fontWeight: '500', color: '#6B7280', marginBottom: 8 }}>Password</Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: '#F7F7F7',
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: '#E5E5E5',
                    paddingHorizontal: 16,
                    height: 56,
                  }}
                >
                  <Lock size={22} color="#717171" />
                  <TextInput
                    ref={passwordRef}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Create a password"
                    placeholderTextColor="#9CA3AF"
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    returnKeyType="next"
                    onSubmitEditing={() => confirmPasswordRef.current?.focus()}
                    blurOnSubmit={false}
                    editable={!isSubmitting}
                    style={{ flex: 1, marginLeft: 14, fontSize: 16, color: '#222222' }}
                  />
                  <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={10} disabled={isSubmitting}>
                    {showPassword ? (
                      <EyeOff size={22} color="#717171" />
                    ) : (
                      <Eye size={22} color="#717171" />
                    )}
                  </Pressable>
                </View>
                <Text style={{ fontSize: 12, color: '#9CA3AF', marginTop: 4, marginLeft: 4 }}>
                  Must be at least 6 characters
                </Text>
              </View>

              {/* Confirm Password Input */}
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 14, fontWeight: '500', color: '#6B7280', marginBottom: 8 }}>Confirm Password</Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: '#F7F7F7',
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: '#E5E5E5',
                    paddingHorizontal: 16,
                    height: 56,
                  }}
                >
                  <Lock size={22} color="#717171" />
                  <TextInput
                    ref={confirmPasswordRef}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Confirm your password"
                    placeholderTextColor="#9CA3AF"
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    returnKeyType="go"
                    enablesReturnKeyAutomatically={true}
                    onSubmitEditing={handleSignUp}
                    editable={!isSubmitting}
                    style={{ flex: 1, marginLeft: 14, fontSize: 16, color: '#222222' }}
                  />
                </View>
              </View>

              {/* Terms & Privacy Checkbox */}
              <Pressable
                onPress={() => {
                  setSignupTosAccepted(!signupTosAccepted);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                disabled={isSubmitting}
                style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20 }}
              >
                <View style={{ marginTop: 2 }}>
                  {signupTosAccepted ? (
                    <CheckSquare size={22} color="#2D5A3D" />
                  ) : (
                    <Square size={22} color="#717171" />
                  )}
                </View>
                <Text style={{ flex: 1, marginLeft: 12, fontSize: 14, color: '#4B5563', lineHeight: 20 }}>
                  I agree to the{' '}
                  <Text
                    style={{ color: '#2D5A3D', textDecorationLine: 'underline' }}
                    onPress={() => {
                      setLegalModalType('terms');
                      setLegalModalVisible(true);
                    }}
                  >
                    Terms of Service
                  </Text>
                  {' '}and{' '}
                  <Text
                    style={{ color: '#2D5A3D', textDecorationLine: 'underline' }}
                    onPress={() => {
                      setLegalModalType('privacy');
                      setLegalModalVisible(true);
                    }}
                  >
                    Privacy Policy
                  </Text>
                  .
                </Text>
              </Pressable>

              {/* Sign Up Button - ONLY place that calls handleSignUp */}
              <Pressable
                onPress={handleSignUp}
                disabled={isSubmitting || retryCountdown > 0 || !signupTosAccepted}
                style={({ pressed }) => ({
                  backgroundColor: (isSubmitting || retryCountdown > 0 || !signupTosAccepted) ? '#9CA3AF' : (pressed ? '#1E4D2B' : '#2D5A3D'),
                  borderRadius: 14,
                  height: 56,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16,
                  opacity: (isSubmitting || retryCountdown > 0 || !signupTosAccepted) ? 0.7 : 1,
                })}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="white" />
                ) : retryCountdown > 0 ? (
                  <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '600' }}>
                    Retry in {retryCountdown}s
                  </Text>
                ) : (
                  <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '600' }}>
                    Create Account
                  </Text>
                )}
              </Pressable>

            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Legal Modal */}
      <LegalModal
        visible={legalModalVisible}
        type={legalModalType}
        onClose={() => setLegalModalVisible(false)}
      />
    </LinearGradient>
  );
}
