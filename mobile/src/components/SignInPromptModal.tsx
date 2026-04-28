import React from 'react';
import { View, Text, Modal, Pressable, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, LogIn, UserPlus } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

interface SignInPromptModalProps {
  visible: boolean;
  onClose: () => void;
  action?: 'review' | 'favorite' | 'rate';
}

export function SignInPromptModal({ visible, onClose, action = 'favorite' }: SignInPromptModalProps) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  const handleSignIn = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
    router.push('/auth/login');
  };

  const handleCreateAccount = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
    router.push('/auth/login');
  };

  const getActionText = () => {
    switch (action) {
      case 'review':
        return 'leave reviews';
      case 'rate':
        return 'rate Farmstands';
      case 'favorite':
      default:
        return 'save favorites';
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        className="flex-1 bg-black/50 items-center justify-center px-6"
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="bg-white rounded-3xl w-full overflow-hidden"
          style={{ maxWidth: isTablet ? 520 : 384 }}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between px-5 py-4 border-b border-sand">
            <View className="w-8" />
            <Text className="text-charcoal font-bold text-lg">Sign In Required</Text>
            <Pressable onPress={onClose} className="p-1">
              <X size={22} color="#5C4033" />
            </Pressable>
          </View>

          {/* Content */}
          <View className="px-6 py-6">
            <Text className="text-charcoal text-center text-base leading-6">
              Please sign in or create an account to {getActionText()} or save Farmstands.
            </Text>

            {/* Guest Mode Notice */}
            <View className="bg-honey/20 rounded-xl p-4 mt-5">
              <Text className="text-bark text-center text-sm leading-5">
                Guest Mode: Guests can browse Farmstands but must sign in to leave reviews or save favorites.
              </Text>
            </View>
          </View>

          {/* Actions */}
          <View className="px-6 pb-6 space-y-3">
            <Pressable
              onPress={handleSignIn}
              className="bg-forest py-4 rounded-xl flex-row items-center justify-center mb-3"
            >
              <LogIn size={20} color="#FDF8F3" />
              <Text className="text-cream font-semibold text-base ml-2">Sign In</Text>
            </Pressable>

            <Pressable
              onPress={handleCreateAccount}
              className="bg-white border-2 border-forest py-4 rounded-xl flex-row items-center justify-center"
            >
              <UserPlus size={20} color="#2D5A3D" />
              <Text className="text-forest font-semibold text-base ml-2">Create Account</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
