/**
 * IllustrativeImageBadge Component
 *
 * Displays a small overlay badge on AI-generated hero images
 * with a tooltip explaining that the image is illustrative only.
 */

import React, { useState } from 'react';
import { View, Text, Pressable, Modal, StyleSheet, Dimensions } from 'react-native';
import { Info, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { ILLUSTRATIVE_IMAGE_INFO } from '@/lib/ai-hero-images';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface IllustrativeImageBadgeProps {
  /** Position of the badge */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Optional callback when claim CTA is pressed */
  onClaimPress?: () => void;
  /** Whether to show the claim CTA in the tooltip */
  showClaimCTA?: boolean;
}

export function IllustrativeImageBadge({
  position = 'bottom-left',
  onClaimPress,
  showClaimCTA = true,
}: IllustrativeImageBadgeProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowTooltip(true);
  };

  const handleClaimPress = () => {
    setShowTooltip(false);
    onClaimPress?.();
  };

  // Position styles based on prop
  const positionStyle = {
    'top-left': { top: 12, left: 12 },
    'top-right': { top: 12, right: 12 },
    'bottom-left': { bottom: 12, left: 12 },
    'bottom-right': { bottom: 12, right: 12 },
  }[position];

  return (
    <>
      {/* Badge */}
      <Animated.View
        entering={FadeIn.delay(300).duration(400)}
        style={[styles.badge, positionStyle]}
      >
        <Pressable
          onPress={handlePress}
          style={styles.badgeContent}
          hitSlop={8}
        >
          <Info size={12} color="#FFFFFF" />
          <Text style={styles.badgeText}>{ILLUSTRATIVE_IMAGE_INFO.label}</Text>
        </Pressable>
      </Animated.View>

      {/* Tooltip Modal */}
      <Modal
        visible={showTooltip}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTooltip(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowTooltip(false)}
        >
          <Animated.View
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(150)}
            style={styles.tooltipContainer}
          >
            <Pressable onPress={(e) => e.stopPropagation()}>
              {/* Header */}
              <View style={styles.tooltipHeader}>
                <View style={styles.tooltipTitleRow}>
                  <Info size={18} color="#2D5A3D" />
                  <Text style={styles.tooltipTitle}>{ILLUSTRATIVE_IMAGE_INFO.label}</Text>
                </View>
                <Pressable
                  onPress={() => setShowTooltip(false)}
                  hitSlop={12}
                  style={styles.closeButton}
                >
                  <X size={20} color="#6B7280" />
                </Pressable>
              </View>

              {/* Description */}
              <Text style={styles.tooltipDescription}>
                {ILLUSTRATIVE_IMAGE_INFO.description}
              </Text>

              {/* Claim CTA */}
              {showClaimCTA && onClaimPress && (
                <Pressable
                  onPress={handleClaimPress}
                  style={styles.claimButton}
                >
                  <Text style={styles.claimButtonText}>
                    {ILLUSTRATIVE_IMAGE_INFO.claimCTA}
                  </Text>
                </Pressable>
              )}
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    zIndex: 10,
  },
  badgeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 5,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  tooltipContainer: {
    width: SCREEN_WIDTH - 48,
    maxWidth: 340,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  tooltipHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  tooltipTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  tooltipTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1F2937',
    letterSpacing: -0.3,
  },
  closeButton: {
    padding: 4,
    marginLeft: 8,
  },
  tooltipDescription: {
    fontSize: 15,
    color: '#4B5563',
    lineHeight: 22,
    marginBottom: 16,
  },
  claimButton: {
    backgroundColor: '#2D5A3D',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
  },
  claimButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
});
