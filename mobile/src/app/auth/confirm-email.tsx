import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Mail, CheckCircle, ExternalLink } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { supabaseResendConfirmation, SupabaseError } from '@/lib/supabase';

export default function ConfirmEmailScreen() {
  const router = useRouter();
  const { email, alreadySent } = useLocalSearchParams<{ email: string; alreadySent?: string }>();

  // Single-submit lock for resend
  const isResendingRef = useRef(false);
  const [isResending, setIsResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Show "already sent" message if coming from a 429 error
  const wasAlreadySent = alreadySent === 'true';

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (cooldownRef.current) {
        clearInterval(cooldownRef.current);
      }
    };
  }, []);

  const startCooldown = (seconds: number) => {
    setCooldownSeconds(seconds);
    if (cooldownRef.current) {
      clearInterval(cooldownRef.current);
    }
    cooldownRef.current = setInterval(() => {
      setCooldownSeconds((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) {
            clearInterval(cooldownRef.current);
            cooldownRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleResendEmail = async () => {
    // Single-submit lock
    if (isResendingRef.current || cooldownSeconds > 0 || !email) {
      console.log('[ConfirmEmail] Blocked resend - already resending or in cooldown');
      return;
    }

    isResendingRef.current = true;
    setIsResending(true);
    setResendSuccess(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      console.log('[ConfirmEmail] Resending confirmation to:', email);
      const { error } = await supabaseResendConfirmation(email);

      if (error) {
        const supabaseErr = error as SupabaseError;
        console.log('[ConfirmEmail] Resend error:', supabaseErr.status, supabaseErr.code);

        // Rate limit - treat as success (email was already sent)
        if (
          supabaseErr.status === 429 ||
          supabaseErr.code === 'over_email_send_rate_limit' ||
          supabaseErr.message?.toLowerCase().includes('rate limit') ||
          supabaseErr.message?.toLowerCase().includes('too many')
        ) {
          console.log('[ConfirmEmail] Rate limit - email already sent recently');
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setResendSuccess(true);
          startCooldown(60);
          return;
        }

        // Other errors - still start cooldown but don't show success
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        startCooldown(60);
        return;
      }

      // Success
      console.log('[ConfirmEmail] Resend success');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResendSuccess(true);
      startCooldown(60);
    } finally {
      isResendingRef.current = false;
      setIsResending(false);
    }
  };

  const handleGoToLogin = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.replace({
      pathname: '/auth/login',
      params: email ? { email } : undefined,
    });
  };

  const handleOpenEmailApp = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Try to open the default mail app
    const mailUrl = Platform.OS === 'ios' ? 'message://' : 'mailto:';
    const canOpen = await Linking.canOpenURL(mailUrl);

    if (canOpen) {
      await Linking.openURL(mailUrl);
    } else {
      // Fallback to mailto: which should work on most devices
      await Linking.openURL('mailto:');
    }
  };

  const isButtonDisabled = cooldownSeconds > 0 || isResending;

  return (
    <LinearGradient
      colors={['#3D8B5F', '#2D5A3D', '#1A3D28']}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={{ flex: 1 }}
    >
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 16 }}>
        {/* Content Card */}
        <Animated.View
          entering={FadeInDown.delay(100).duration(500)}
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 24,
            paddingTop: 32,
            paddingHorizontal: 24,
            paddingBottom: 28,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.15,
            shadowRadius: 16,
            elevation: 8,
          }}
        >
          {/* Icon */}
          <View style={{ alignItems: 'center', marginBottom: 24 }}>
            <View
              style={{
                width: 80,
                height: 80,
                borderRadius: 40,
                backgroundColor: '#E8F5E9',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Mail size={40} color="#2D5A3D" />
            </View>
          </View>

          {/* Title */}
          <Text
            style={{
              fontSize: 26,
              fontWeight: '700',
              color: '#222222',
              textAlign: 'center',
              marginBottom: 16,
            }}
          >
            Check your email
          </Text>

          {/* Email display */}
          {email && (
            <Text
              style={{
                fontSize: 15,
                color: '#2D5A3D',
                textAlign: 'center',
                fontWeight: '600',
                marginBottom: 16,
                backgroundColor: '#E8F5E9',
                paddingVertical: 8,
                paddingHorizontal: 16,
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              {email}
            </Text>
          )}

          {/* Body Text */}
          <Text
            style={{
              fontSize: 16,
              color: '#4B5563',
              textAlign: 'center',
              lineHeight: 24,
              marginBottom: 24,
            }}
          >
            {wasAlreadySent
              ? 'We already sent a confirmation link to your email. Please check your inbox (and spam folder) and tap the link to confirm your account.'
              : 'We sent a confirmation link to your email. Tap the link to confirm your account, then come back and log in.'}
          </Text>

          {/* Success Message */}
          {resendSuccess && (
            <Animated.View
              entering={FadeInDown.duration(300)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#E8F5E9',
                borderRadius: 12,
                padding: 14,
                marginBottom: 20,
              }}
            >
              <CheckCircle size={20} color="#2D5A3D" />
              <Text style={{ color: '#2D5A3D', fontSize: 15, fontWeight: '500', marginLeft: 8 }}>
                Confirmation email sent
              </Text>
            </Animated.View>
          )}

          {/* Open Email App Button */}
          <Pressable
            onPress={handleOpenEmailApp}
            style={({ pressed }) => ({
              backgroundColor: pressed ? '#1E4D2B' : '#2D5A3D',
              borderRadius: 14,
              height: 56,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 14,
            })}
          >
            <ExternalLink size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '600' }}>Open Email App</Text>
          </Pressable>

          {/* I Confirmed - Take Me to Login Button */}
          <Pressable
            onPress={handleGoToLogin}
            style={({ pressed }) => ({
              backgroundColor: pressed ? '#F3F4F6' : '#FFFFFF',
              borderRadius: 14,
              height: 56,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1.5,
              borderColor: '#2D5A3D',
              marginBottom: 14,
            })}
          >
            <Text style={{ color: '#2D5A3D', fontSize: 17, fontWeight: '600' }}>
              I Confirmed — Take Me to Login
            </Text>
          </Pressable>

          {/* Resend Confirmation Email Link */}
          <Pressable
            onPress={handleResendEmail}
            disabled={isButtonDisabled}
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 12,
              opacity: isButtonDisabled ? 0.5 : 1,
            }}
          >
            {isResending ? (
              <ActivityIndicator color="#2D5A3D" size="small" />
            ) : (
              <Text
                style={{
                  color: isButtonDisabled ? '#9CA3AF' : '#2D5A3D',
                  fontSize: 15,
                  fontWeight: '500',
                  textDecorationLine: isButtonDisabled ? 'none' : 'underline',
                }}
              >
                {cooldownSeconds > 0
                  ? `Resend email (${cooldownSeconds}s)`
                  : 'Resend email'}
              </Text>
            )}
          </Pressable>
        </Animated.View>
      </SafeAreaView>
    </LinearGradient>
  );
}
