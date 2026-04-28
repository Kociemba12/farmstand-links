import React, { useEffect, useState, useRef } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { supabaseSetSessionFromTokens } from '@/lib/supabase';

/**
 * Parse deep link URL to extract both query params and hash fragment params
 * Supports URLs like:
 *   farmstand://auth/callback#access_token=xxx&refresh_token=xxx&type=recovery
 *   farmstand://auth/callback?code=xxx
 *   farmstand://auth/callback?access_token=xxx&refresh_token=xxx&type=recovery
 */
function parseDeepLinkParams(url: string): {
  access_token: string | null;
  refresh_token: string | null;
  type: string | null;
  code: string | null;
} {
  console.log('[parseDeepLinkParams] Parsing URL:', url);

  let access_token: string | null = null;
  let refresh_token: string | null = null;
  let type: string | null = null;
  let code: string | null = null;

  try {
    // First, parse query params (after ?)
    const queryIndex = url.indexOf('?');
    if (queryIndex !== -1) {
      // Find where query ends (either at # or end of string)
      const hashIndex = url.indexOf('#', queryIndex);
      const queryString = hashIndex !== -1
        ? url.substring(queryIndex + 1, hashIndex)
        : url.substring(queryIndex + 1);

      const queryParams = new URLSearchParams(queryString);
      access_token = queryParams.get('access_token');
      refresh_token = queryParams.get('refresh_token');
      type = queryParams.get('type');
      code = queryParams.get('code');

      console.log('[parseDeepLinkParams] Query params - access_token:', !!access_token, 'refresh_token:', !!refresh_token, 'type:', type, 'code:', !!code);
    }

    // Second, parse hash fragment params (after #) - these override query params
    const hashIndex = url.indexOf('#');
    if (hashIndex !== -1) {
      const fragment = url.substring(hashIndex + 1);
      const fragmentParams = new URLSearchParams(fragment);

      // Only override if fragment has values
      const fragmentAccessToken = fragmentParams.get('access_token');
      const fragmentRefreshToken = fragmentParams.get('refresh_token');
      const fragmentType = fragmentParams.get('type');

      if (fragmentAccessToken) access_token = fragmentAccessToken;
      if (fragmentRefreshToken) refresh_token = fragmentRefreshToken;
      if (fragmentType) type = fragmentType;

      console.log('[parseDeepLinkParams] Fragment params - access_token:', !!fragmentAccessToken, 'refresh_token:', !!fragmentRefreshToken, 'type:', fragmentType);
    }
  } catch (err) {
    console.log('[parseDeepLinkParams] Error parsing URL:', err);
  }

  console.log('[parseDeepLinkParams] Final result - access_token:', !!access_token, 'refresh_token:', !!refresh_token, 'type:', type, 'code:', !!code);

  return { access_token, refresh_token, type, code };
}

/**
 * AuthCallback Screen
 *
 * This screen handles deep links from Supabase password recovery emails.
 * When user clicks the reset link in their email, it opens this screen via:
 * farmstand://auth/callback#access_token=xxx&refresh_token=xxx&type=recovery
 *
 * SUPABASE DASHBOARD CONFIGURATION REQUIRED:
 * Go to Supabase Dashboard → Authentication → URL Configuration
 * Add "farmstand://auth/callback" to Additional Redirect URLs
 */
export default function AuthCallbackScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const processedUrl = useRef<string | null>(null);

  useEffect(() => {
    // Handler for processing deep link URLs
    const processUrl = async (url: string | null) => {
      if (!url) {
        console.log('[AuthCallback] No URL to process');
        setStatus('error');
        setErrorMessage('Invalid password reset link. Please request a new one.');
        setTimeout(() => router.replace('/auth/login'), 3000);
        return;
      }

      // Prevent processing the same URL twice
      if (processedUrl.current === url) {
        console.log('[AuthCallback] URL already processed, skipping:', url);
        return;
      }
      processedUrl.current = url;

      console.log('[AuthCallback] ========================================');
      console.log('[AuthCallback] Processing deep link URL:', url);
      console.log('[AuthCallback] ========================================');

      // Parse tokens from URL (supports both query params and hash fragment)
      const { access_token, refresh_token, type, code } = parseDeepLinkParams(url);

      console.log('[AuthCallback] Parsed params:');
      console.log('[AuthCallback]   type:', type);
      console.log('[AuthCallback]   hasAccessToken:', !!access_token);
      console.log('[AuthCallback]   hasRefreshToken:', !!refresh_token);
      console.log('[AuthCallback]   hasCode:', !!code);

      // Handle recovery type deep links
      if (type === 'recovery' && access_token && refresh_token) {
        console.log('[AuthCallback] Valid recovery link detected, setting session...');

        // Set the session using the recovery tokens
        const { error } = await supabaseSetSessionFromTokens(access_token, refresh_token);

        if (error) {
          console.log('[AuthCallback] Session set error:', error.message);
          setStatus('error');
          setErrorMessage(error.message || 'Failed to verify reset link. Please try again.');
          setTimeout(() => router.replace('/auth/login'), 3000);
          return;
        }

        // Success - navigate to reset password screen
        console.log('[AuthCallback] Session set successfully, navigating to reset password');
        router.replace('/auth/reset-password');
        return;
      }

      // Handle PKCE flow with code parameter (if Supabase sends code instead of tokens)
      if (code) {
        console.log('[AuthCallback] Code parameter detected - PKCE flow not implemented, showing error');
        // Note: PKCE flow would require additional implementation
        // For now, treat as invalid since we expect token-based recovery
        setStatus('error');
        setErrorMessage('This reset link format is not supported. Please request a new password reset.');
        setTimeout(() => router.replace('/auth/login'), 3000);
        return;
      }

      // No valid tokens found
      console.log('[AuthCallback] Invalid link - no recovery tokens found');
      console.log('[AuthCallback] type was:', type);
      console.log('[AuthCallback] Expected type=recovery with access_token and refresh_token');
      setStatus('error');
      setErrorMessage('Invalid password reset link. Please request a new one.');
      setTimeout(() => router.replace('/auth/login'), 3000);
    };

    // Check for initial URL (app was cold started by deep link)
    const checkInitialUrl = async () => {
      try {
        const initialUrl = await Linking.getInitialURL();
        console.log('[AuthCallback] Initial URL:', initialUrl);

        if (initialUrl) {
          await processUrl(initialUrl);
        } else {
          // No initial URL - might be navigated to directly or URL comes via event
          console.log('[AuthCallback] No initial URL found, waiting for URL event...');

          // Give a short delay to allow URL event to fire
          // If no URL arrives, show error
          setTimeout(() => {
            if (!processedUrl.current) {
              console.log('[AuthCallback] No URL received after timeout');
              setStatus('error');
              setErrorMessage('Invalid password reset link. Please request a new one.');
              setTimeout(() => router.replace('/auth/login'), 3000);
            }
          }, 2000);
        }
      } catch (err) {
        console.log('[AuthCallback] Error getting initial URL:', err);
        setStatus('error');
        setErrorMessage('Something went wrong. Please try again.');
        setTimeout(() => router.replace('/auth/login'), 3000);
      }
    };

    // Listen for URL events (app was already running when deep link was clicked)
    const urlSubscription = Linking.addEventListener('url', (event) => {
      console.log('[AuthCallback] URL event received:', event.url);
      processUrl(event.url);
    });

    // Start processing
    checkInitialUrl();

    // Cleanup
    return () => {
      urlSubscription.remove();
    };
  }, [router]);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#2D5A3D', '#3D7A4D', '#4D9A5D']}
        style={StyleSheet.absoluteFillObject}
      />
      <SafeAreaView style={styles.content}>
        {status === 'loading' ? (
          <>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text style={styles.text}>Verifying reset link...</Text>
          </>
        ) : (
          <>
            <Text style={styles.errorIcon}>!</Text>
            <Text style={styles.errorText}>{errorMessage}</Text>
            <Text style={styles.redirectText}>Redirecting to login...</Text>
          </>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '500',
    marginTop: 20,
    textAlign: 'center',
  },
  errorIcon: {
    color: '#FFFFFF',
    fontSize: 48,
    fontWeight: '700',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    textAlign: 'center',
    lineHeight: 80,
    marginBottom: 20,
  },
  errorText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 12,
  },
  redirectText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
    textAlign: 'center',
  },
});
