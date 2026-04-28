import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Path, Circle, G } from 'react-native-svg';

interface FarmstandLogoProps {
  size?: 'small' | 'medium' | 'large';
  color?: string;
}

// Dark brown color matching the logo (default)
const LOGO_COLOR = '#4A3F35';

export function FarmstandLogo({ size = 'large', color }: FarmstandLogoProps) {
  const logoColor = color ?? LOGO_COLOR;

  const sizeConfig = {
    small: { mainFont: 32, taglineFont: 8, branchWidth: 60, spacing: 4 },
    medium: { mainFont: 44, taglineFont: 10, branchWidth: 80, spacing: 6 },
    large: { mainFont: 56, taglineFont: 12, branchWidth: 100, spacing: 8 },
  };

  const { mainFont, taglineFont, branchWidth, spacing } = sizeConfig[size];

  // Decorative branch with leaves and flourish
  const DecorativeBranch = ({ flip = false }: { flip?: boolean }) => (
    <Svg
      width={branchWidth}
      height={branchWidth * 0.35}
      viewBox="0 0 100 35"
      style={{ transform: [{ scaleX: flip ? -1 : 1 }] }}
    >
      {/* Curly flourish */}
      <Path
        d="M50 20 Q45 20 42 17 Q38 12 30 15"
        stroke={logoColor}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      {/* Main stem */}
      <Path
        d="M30 15 Q20 12 5 18"
        stroke={logoColor}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      {/* Leaves - arranged along the branch */}
      <G>
        {/* Leaf 1 */}
        <Path
          d="M28 14 Q22 8 18 10 Q22 14 28 14"
          fill={logoColor}
        />
        {/* Leaf 2 */}
        <Path
          d="M24 16 Q20 22 16 20 Q20 16 24 16"
          fill={logoColor}
        />
        {/* Leaf 3 */}
        <Path
          d="M20 13 Q14 7 10 9 Q14 13 20 13"
          fill={logoColor}
        />
        {/* Leaf 4 */}
        <Path
          d="M16 16 Q12 22 8 20 Q12 16 16 16"
          fill={logoColor}
        />
        {/* Leaf 5 */}
        <Path
          d="M12 14 Q8 9 5 11 Q8 14 12 14"
          fill={logoColor}
        />
        {/* Leaf 6 - top */}
        <Path
          d="M8 16 Q5 21 2 19 Q5 16 8 16"
          fill={logoColor}
        />
      </G>
    </Svg>
  );

  // Three dots decoration
  const ThreeDots = () => (
    <Svg width={20} height={10} viewBox="0 0 20 10">
      <Circle cx="4" cy="5" r="2" fill={logoColor} />
      <Circle cx="10" cy="5" r="2" fill={logoColor} />
      <Circle cx="16" cy="5" r="2" fill={logoColor} />
    </Svg>
  );

  return (
    <View className="items-center">
      {/* Main "Farmstand" text */}
      <Text
        style={{
          fontSize: mainFont,
          fontWeight: '400',
          fontStyle: 'italic',
          color: logoColor,
          letterSpacing: 1,
          fontFamily: 'System',
        }}
      >
        Farmstand
      </Text>

      {/* Tagline with decorative elements */}
      <View className="flex-row items-center" style={{ marginTop: spacing }}>
        {/* Left branch */}
        <DecorativeBranch />

        {/* FRESH & LOCAL text with dots */}
        <View className="items-center mx-1">
          <Text
            style={{
              fontSize: taglineFont,
              fontWeight: '600',
              letterSpacing: 3,
              color: logoColor,
            }}
          >
            FRESH & LOCAL
          </Text>
          <View style={{ marginTop: 2 }}>
            <ThreeDots />
          </View>
        </View>

        {/* Right branch (flipped) */}
        <DecorativeBranch flip />
      </View>
    </View>
  );
}
