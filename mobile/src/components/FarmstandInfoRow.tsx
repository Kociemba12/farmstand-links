import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronDown, MapPin, Clock, Phone as PhoneIcon, CreditCard, Copy, Check } from 'lucide-react-native';
import Animated, { useAnimatedStyle, FadeIn, FadeOut } from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

export type FarmstandInfoIconType = 'verified' | 'location' | 'hours' | 'phone' | 'payments';

// Icon sizes - matching reference screenshot (~32-36px)
const ICON_SIZE = 34;
const ICON_CONTAINER_SIZE = 44;

// Icon color for consistent visual weight
const ICON_COLOR = '#2D5A3D';

// Custom icon component using Lucide icons for consistent style
const IconImage = ({ type, size = ICON_SIZE }: { type: FarmstandInfoIconType; size?: number }) => {
  const renderIcon = () => {
    switch (type) {
      case 'location':
      case 'verified':
        return <MapPin size={size} color={ICON_COLOR} strokeWidth={1.5} />;
      case 'hours':
        return <Clock size={size} color={ICON_COLOR} strokeWidth={1.5} />;
      case 'phone':
        return <PhoneIcon size={size} color={ICON_COLOR} strokeWidth={1.5} />;
      case 'payments':
        return <CreditCard size={size} color={ICON_COLOR} strokeWidth={1.5} />;
      default:
        return <MapPin size={size} color={ICON_COLOR} strokeWidth={1.5} />;
    }
  };

  return (
    <View style={{
      width: size,
      height: size,
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      {renderIcon()}
    </View>
  );
};

interface FarmstandInfoRowProps {
  type: FarmstandInfoIconType;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  showChevron?: boolean;
  chevronRotation?: Animated.SharedValue<number>;
  expanded?: boolean;
  titleStyle?: 'default' | 'highlight';
  numberOfLines?: number;
  selectable?: boolean;
  copyable?: boolean;
}

export function FarmstandInfoRow({
  type,
  title,
  subtitle,
  onPress,
  showChevron = false,
  chevronRotation,
  expanded,
  titleStyle = 'default',
  numberOfLines,
  selectable = false,
  copyable = false,
}: FarmstandInfoRowProps) {
  const [showCopied, setShowCopied] = useState(false);

  const chevronAnimatedStyle = useAnimatedStyle(() => {
    if (!chevronRotation) return {};
    return {
      transform: [{ rotate: `${chevronRotation.value}deg` }],
    };
  }, [chevronRotation]);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(title);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  const content = (
    <View style={styles.row}>
      {/* Icon Container - Fixed width for text alignment */}
      <View style={styles.iconContainer}>
        <IconImage type={type} size={ICON_SIZE} />
      </View>

      {/* Text Content */}
      <View style={styles.textContainer}>
        <Text
          style={[
            styles.title,
            titleStyle === 'highlight' && styles.titleHighlight,
          ]}
          numberOfLines={selectable ? undefined : (expanded ? undefined : numberOfLines)}
          selectable={selectable}
        >
          {title}
        </Text>
        {subtitle && (
          <Text style={styles.subtitle}>{subtitle}</Text>
        )}
      </View>

      {/* Copy Button */}
      {copyable && (
        <Pressable onPress={handleCopy} style={styles.copyButton} hitSlop={8}>
          {showCopied ? (
            <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)}>
              <Check size={18} color="#2D5A3D" />
            </Animated.View>
          ) : (
            <Copy size={18} color="#C4B5A4" />
          )}
        </Pressable>
      )}

      {/* Chevron */}
      {showChevron && (
        <Animated.View style={chevronAnimatedStyle}>
          <ChevronDown size={18} color="#C4B5A4" />
        </Animated.View>
      )}
    </View>
  );

  // Show toast when copied
  const toastOverlay = showCopied ? (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      style={styles.toastContainer}
    >
      <View style={styles.toast}>
        <Check size={14} color="#FDF8F3" />
        <Text style={styles.toastText}>Address copied</Text>
      </View>
    </Animated.View>
  ) : null;

  if (onPress) {
    return (
      <View>
        <Pressable onPress={onPress} style={styles.pressable}>
          {content}
        </Pressable>
        {toastOverlay}
      </View>
    );
  }

  return (
    <View>
      {content}
      {toastOverlay}
    </View>
  );
}

// Verified Banner Component - uses the verified icon
interface FarmstandVerifiedBannerProps {
  title?: string;
  subtitle?: string;
}

export function FarmstandVerifiedBanner({
  title = 'Verified Farmstand',
  subtitle = 'Managed by the owner',
}: FarmstandVerifiedBannerProps) {
  return (
    <View style={styles.verifiedBanner}>
      <View style={styles.verifiedIconContainer}>
        <IconImage type="verified" size={28} />
      </View>
      <View style={styles.verifiedContent}>
        <Text style={styles.verifiedTitle}>{title}</Text>
        <Text style={styles.verifiedSubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pressable: {
    // Keep pressable styling minimal
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  iconContainer: {
    width: ICON_CONTAINER_SIZE,
    height: ICON_CONTAINER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    // No background - transparent
  },
  textContainer: {
    flex: 1,
  },
  title: {
    color: '#3D3D3D',
    fontSize: 15,
  },
  titleHighlight: {
    color: '#2D5A3D',
    fontWeight: '600',
  },
  subtitle: {
    color: '#8B6F4E',
    fontSize: 13,
    marginTop: 2,
  },
  copyButton: {
    padding: 8,
    marginLeft: 4,
  },
  toastContainer: {
    position: 'absolute',
    bottom: -36,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2D5A3D',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  toastText: {
    color: '#FDF8F3',
    fontSize: 13,
    fontWeight: '500',
  },

  // Verified Banner Styles
  verifiedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    padding: 14,
    borderRadius: 14,
    marginBottom: 20,
  },
  verifiedIconContainer: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  verifiedContent: {
    flex: 1,
  },
  verifiedTitle: {
    color: '#2D5A3D',
    fontWeight: '600',
    fontSize: 15,
  },
  verifiedSubtitle: {
    color: '#5C4033',
    fontSize: 13,
    marginTop: 2,
  },
});
