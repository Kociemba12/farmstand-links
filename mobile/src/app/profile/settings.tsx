import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  StyleSheet,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import {
  User,
  Lock,
  Shield,
  FileText,
  Trash2,
  AlertTriangle,
  X,
  Bell,
} from 'lucide-react-native';
import { useRouter, Stack } from 'expo-router';
import { useUserStore } from '@/lib/user-store';
import * as Haptics from 'expo-haptics';
import { MenuRow } from '@/components/MenuRow';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseSession, loadSessionFromStorage } from '@/lib/supabase';

// Get backend URL from environment
const BACKEND_URL =
  Constants.expoConfig?.extra?.BACKEND_URL ||
  process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL ||
  'http://localhost:3000';

export default function SettingsScreen() {
  const router = useRouter();
  const signOut = useUserStore((s) => s.signOut);

  // Delete account modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleItemPress = async (route: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  };

  const handleDeleteAccount = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    // Open the delete confirmation modal
    setShowDeleteModal(true);
    setDeleteConfirmText('');
    setDeleteError(null);
  };

  const handleConfirmDelete = async () => {
    if (deleteConfirmText !== 'DELETE') {
      setDeleteError('Please type DELETE to confirm');
      return;
    }

    setIsDeleting(true);
    setDeleteError(null);

    try {
      console.log('[Settings] Starting account deletion...');

      // Get the access token from in-memory Supabase session (SecureStore is source of truth)
      const currentSession = getSupabaseSession();
      let accessToken: string | null = currentSession?.access_token ?? null;

      if (!accessToken) {
        // Try loading from SecureStore in case in-memory is cold
        await loadSessionFromStorage();
        accessToken = getSupabaseSession()?.access_token ?? null;
      }

      if (!accessToken) {
        console.error('[Settings] No access token found');
        setDeleteError('Please sign in again to confirm account deletion.');
        setIsDeleting(false);
        return;
      }

      console.log('[Settings] Calling delete-account API...');

      const response = await fetch(`${BACKEND_URL}/api/delete-account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ confirmation: 'DELETE' }),
      });

      const sct = response.headers.get('content-type') ?? '';
      if (!sct.includes('application/json')) {
        console.log('[Settings] delete-account non-JSON response (HTTP', response.status, '), content-type:', sct);
        setDeleteError(`Unexpected response from server (HTTP ${response.status})`);
        setIsDeleting(false);
        return;
      }
      const data = await response.json();

      if (!response.ok || !data.success) {
        console.error('[Settings] Delete account API error:', data);
        setDeleteError(data.error || 'Failed to delete account');
        setIsDeleting(false);
        return;
      }

      console.log('[Settings] Account deleted successfully');

      // Clear local storage
      try {
        await AsyncStorage.clear();
        console.log('[Settings] Local storage cleared');
      } catch (e) {
        console.warn('[Settings] Failed to clear AsyncStorage:', e);
      }

      // Close modal
      setShowDeleteModal(false);

      // Sign out and navigate to welcome screen
      await signOut();

      // Show success message
      Alert.alert(
        'Account Deleted',
        'Your account has been permanently deleted.',
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('[Settings] Delete account error:', error);
      setDeleteError(
        error instanceof Error ? error.message : 'An unexpected error occurred'
      );
      setIsDeleting(false);
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteModal(false);
    setDeleteConfirmText('');
    setDeleteError(null);
  };

  return (
    <View className="flex-1" style={{ backgroundColor: '#FDF8F3' }}>
      <Stack.Screen
        options={{
          title: 'Settings',
          headerShown: true,
          headerTitleAlign: 'center',
          headerTitleStyle: { fontSize: 20, fontWeight: '600' },
          headerStyle: { backgroundColor: '#FDF8F3' },
          headerBackTitle: '',
          headerBackButtonDisplayMode: 'minimal',
          headerTintColor: '#2f6b46',
          headerBackVisible: true,
        }}
      />

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {/* Account Section */}
          <Text style={styles.sectionHeader}>ACCOUNT</Text>
          <View style={styles.card}>
            <MenuRow
              icon={User}
              label="Edit Profile"
              subtitle="Update your name and email"
              onPress={() => handleItemPress('/profile/edit-profile')}
              iconColor="#2D5A3D"
            />
            <MenuRow
              icon={Lock}
              label="Change Password"
              subtitle="Update your password"
              onPress={() => handleItemPress('/profile/change-password')}
              iconColor="#2D5A3D"
            />
            <MenuRow
              icon={Bell}
              label="Notifications"
              subtitle="Manage your notification preferences"
              onPress={() => handleItemPress('/profile/notification-settings')}
              iconColor="#2D5A3D"
              isLast
            />
          </View>

          {/* Legal Section */}
          <Text style={[styles.sectionHeader, styles.sectionHeaderSpacing]}>LEGAL</Text>
          <View style={styles.card}>
            <MenuRow
              icon={Shield}
              label="Privacy Policy"
              subtitle="How we protect your data"
              onPress={() => handleItemPress('/profile/privacy-policy')}
              iconColor="#6B7280"
            />
            <MenuRow
              icon={FileText}
              label="Terms of Service"
              subtitle="Our terms and conditions"
              onPress={() => handleItemPress('/profile/terms')}
              iconColor="#6B7280"
              isLast
            />
          </View>

          {/* Account Actions */}
          <Text style={[styles.sectionHeader, styles.sectionHeaderSpacing]}>ACCOUNT ACTIONS</Text>
          <View style={styles.card}>
            <MenuRow
              icon={Trash2}
              label="Delete Account"
              subtitle="Permanently remove your account and data"
              onPress={handleDeleteAccount}
              iconColor="#B95348"
              iconBgColor="#FEE8E6"
              isLast
            />
          </View>
        </View>
      </ScrollView>

      {/* Delete Account Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={handleCancelDelete}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Close button */}
            <Pressable
              style={styles.closeButton}
              onPress={handleCancelDelete}
              disabled={isDeleting}
            >
              <X size={20} color="#6B7280" />
            </Pressable>

            {/* Warning icon */}
            <View style={styles.warningIconContainer}>
              <AlertTriangle size={32} color="#B95348" />
            </View>

            {/* Title */}
            <Text style={styles.modalTitle}>Delete Account</Text>

            {/* Warning message */}
            <Text style={styles.modalMessage}>
              Your account will be deleted immediately. This cannot be undone.
            </Text>

            <Text style={styles.modalSubMessage}>
              All your data including farmstands, reviews, and favorites will be permanently removed.
            </Text>

            {/* Confirmation input */}
            <Text style={styles.inputLabel}>Type DELETE to confirm:</Text>
            <TextInput
              style={[
                styles.confirmInput,
                deleteError ? styles.confirmInputError : null,
              ]}
              value={deleteConfirmText}
              onChangeText={(text) => {
                setDeleteConfirmText(text.toUpperCase());
                setDeleteError(null);
              }}
              placeholder="DELETE"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!isDeleting}
            />

            {/* Error message */}
            {deleteError && (
              <Text style={styles.errorText}>{deleteError}</Text>
            )}

            {/* Buttons */}
            <View style={styles.buttonRow}>
              <Pressable
                style={styles.cancelButton}
                onPress={handleCancelDelete}
                disabled={isDeleting}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={[
                  styles.deleteButton,
                  deleteConfirmText !== 'DELETE' && styles.deleteButtonDisabled,
                ]}
                onPress={handleConfirmDelete}
                disabled={deleteConfirmText !== 'DELETE' || isDeleting}
              >
                {isDeleting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.deleteButtonText}>Delete Account</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 48,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.0,
    color: '#A8906E',
    marginBottom: 10,
    marginLeft: 4,
  },
  sectionHeaderSpacing: {
    marginTop: 28,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 6,
    shadowColor: 'rgba(0,0,0,0.06)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 4,
  },
  warningIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FEE8E6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 12,
  },
  modalMessage: {
    fontSize: 15,
    color: '#B95348',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalSubMessage: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  confirmInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 2,
    textAlign: 'center',
    color: '#1F2937',
    marginBottom: 8,
  },
  confirmInputError: {
    borderColor: '#B95348',
  },
  errorText: {
    fontSize: 13,
    color: '#B95348',
    marginBottom: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    width: '100%',
  },
  cancelButton: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
  },
  deleteButton: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#B95348',
    alignItems: 'center',
  },
  deleteButtonDisabled: {
    backgroundColor: '#D1D5DB',
  },
  deleteButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
