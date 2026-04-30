import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Lock, Eye, EyeOff, Check, X } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { settingsStyles, settingsColors } from '@/lib/settings-styles';
import * as Haptics from 'expo-haptics';

export default function ChangePasswordScreen() {
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  // Validation checks
  const isLongEnough = newPassword.length >= 8;
  const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;
  const canSubmit = currentPassword && isLongEnough && passwordsMatch;

  const validateAndSave = async () => {
    const newErrors: { [key: string]: string } = {};

    if (!currentPassword) {
      newErrors.current = 'Please enter your current password';
    }
    if (!newPassword || newPassword.length < 8) {
      newErrors.new = 'Password must be at least 8 characters';
    }
    if (newPassword !== confirmPassword) {
      newErrors.confirm = 'Passwords do not match';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsSaving(true);

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1500));

    setIsSaving(false);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Password Updated', 'Your password has been changed successfully.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  };

  const PasswordRule = ({ met, text }: { met: boolean; text: string }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
      {met ? (
        <Check size={16} color={settingsColors.primary} />
      ) : (
        <X size={16} color={settingsColors.textMuted} />
      )}
      <Text
        style={{
          marginLeft: 8,
          fontSize: 14,
          color: met ? settingsColors.primary : settingsColors.textMuted,
        }}
      >
        {text}
      </Text>
    </View>
  );

  return (
    <View style={settingsStyles.pageContainer}>
      {/* Header */}
      <SafeAreaView edges={['top']} style={settingsStyles.header}>
        <View style={settingsStyles.headerContent}>
          <Pressable onPress={() => router.back()} style={settingsStyles.headerBackButton}>
            <ArrowLeft size={22} color={settingsColors.headerText} />
          </Pressable>
          <Text style={settingsStyles.headerTitle}>Change Password</Text>
        </View>
      </SafeAreaView>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={settingsStyles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Password Fields Card - Row Style */}
        <View style={settingsStyles.card}>
          {/* Current Password Row */}
          <View style={settingsStyles.inputRow}>
            <View style={settingsStyles.inputRowBubble}>
              <Lock size={18} color="#2D5A3D" />
            </View>
            <View style={settingsStyles.inputRowContent}>
              <Text style={settingsStyles.inputRowLabel}>Current Password</Text>
              <View
                style={[
                  settingsStyles.inputRowField,
                  { flexDirection: 'row', alignItems: 'center', paddingRight: 8 },
                  errors.current && { borderColor: settingsColors.danger },
                ]}
              >
                <TextInput
                  value={currentPassword}
                  onChangeText={(text) => {
                    setCurrentPassword(text);
                    setErrors((e) => ({ ...e, current: '' }));
                  }}
                  placeholder="Enter current password"
                  placeholderTextColor={settingsColors.textPlaceholder}
                  secureTextEntry={!showCurrent}
                  style={{ flex: 1, fontSize: 16, color: settingsColors.textPrimary }}
                />
                <Pressable onPress={() => setShowCurrent(!showCurrent)} hitSlop={10}>
                  {showCurrent ? (
                    <EyeOff size={20} color={settingsColors.textPlaceholder} />
                  ) : (
                    <Eye size={20} color={settingsColors.textPlaceholder} />
                  )}
                </Pressable>
              </View>
              {errors.current ? <Text style={settingsStyles.inputError}>{errors.current}</Text> : null}
            </View>
          </View>

          {/* Divider */}
          <View style={{ height: 1, backgroundColor: 'rgba(0,0,0,0.06)', marginVertical: 4 }} />

          {/* New Password Row */}
          <View style={settingsStyles.inputRow}>
            <View style={settingsStyles.inputRowBubble}>
              <Lock size={18} color="#2D5A3D" />
            </View>
            <View style={settingsStyles.inputRowContent}>
              <Text style={settingsStyles.inputRowLabel}>New Password</Text>
              <View
                style={[
                  settingsStyles.inputRowField,
                  { flexDirection: 'row', alignItems: 'center', paddingRight: 8 },
                  errors.new && { borderColor: settingsColors.danger },
                ]}
              >
                <TextInput
                  value={newPassword}
                  onChangeText={(text) => {
                    setNewPassword(text);
                    setErrors((e) => ({ ...e, new: '' }));
                  }}
                  placeholder="Enter new password"
                  placeholderTextColor={settingsColors.textPlaceholder}
                  secureTextEntry={!showNew}
                  style={{ flex: 1, fontSize: 16, color: settingsColors.textPrimary }}
                />
                <Pressable onPress={() => setShowNew(!showNew)} hitSlop={10}>
                  {showNew ? (
                    <EyeOff size={20} color={settingsColors.textPlaceholder} />
                  ) : (
                    <Eye size={20} color={settingsColors.textPlaceholder} />
                  )}
                </Pressable>
              </View>
              {errors.new ? <Text style={settingsStyles.inputError}>{errors.new}</Text> : null}
            </View>
          </View>

          {/* Divider */}
          <View style={{ height: 1, backgroundColor: 'rgba(0,0,0,0.06)', marginVertical: 4 }} />

          {/* Confirm Password Row */}
          <View style={settingsStyles.inputRow}>
            <View style={settingsStyles.inputRowBubble}>
              <Lock size={18} color="#2D5A3D" />
            </View>
            <View style={settingsStyles.inputRowContent}>
              <Text style={settingsStyles.inputRowLabel}>Confirm New Password</Text>
              <View
                style={[
                  settingsStyles.inputRowField,
                  { flexDirection: 'row', alignItems: 'center', paddingRight: 8 },
                  errors.confirm && { borderColor: settingsColors.danger },
                ]}
              >
                <TextInput
                  value={confirmPassword}
                  onChangeText={(text) => {
                    setConfirmPassword(text);
                    setErrors((e) => ({ ...e, confirm: '' }));
                  }}
                  placeholder="Confirm new password"
                  placeholderTextColor={settingsColors.textPlaceholder}
                  secureTextEntry={!showConfirm}
                  style={{ flex: 1, fontSize: 16, color: settingsColors.textPrimary }}
                />
                <Pressable onPress={() => setShowConfirm(!showConfirm)} hitSlop={10}>
                  {showConfirm ? (
                    <EyeOff size={20} color={settingsColors.textPlaceholder} />
                  ) : (
                    <Eye size={20} color={settingsColors.textPlaceholder} />
                  )}
                </Pressable>
              </View>
              {errors.confirm ? <Text style={settingsStyles.inputError}>{errors.confirm}</Text> : null}
            </View>
          </View>
        </View>

        {/* Password Rules Card */}
        <View style={settingsStyles.card}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: '600',
              color: settingsColors.textPrimary,
              marginBottom: 12,
            }}
          >
            Password requirements
          </Text>
          <PasswordRule met={isLongEnough} text="At least 8 characters" />
          <PasswordRule met={passwordsMatch} text="Passwords match" />
        </View>

        {/* Update Button */}
        <Pressable
          onPress={validateAndSave}
          disabled={isSaving || !canSubmit}
          style={{ alignSelf: 'center', marginTop: 24 }}
        >
          {({ pressed }) => (
            <View
              style={{
                backgroundColor: (!canSubmit || isSaving)
                  ? '#6F8F7A'
                  : pressed
                    ? '#245030'
                    : '#2D5A3D',
                paddingVertical: 16,
                paddingHorizontal: 32,
                borderRadius: 999,
                minWidth: 220,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                style={{
                  color: '#FFFFFF',
                  fontSize: 16,
                  fontWeight: '600',
                  textAlign: 'center',
                }}
              >
                {isSaving ? 'Updating...' : 'Update Password'}
              </Text>
            </View>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}
