import React from 'react';
import { View, Image } from 'react-native';

// Logo dimensions - FORCE OVERRIDE
const LOGO_WIDTH = 360;
const LOGO_HEIGHT = 140;
const TOP_PADDING = 0; // Removed - controlled by screen
const LOGO_TO_CARD = 14; // Space between logo and white card

export function AuthHeader() {
  return (
    <View style={{
      alignItems: 'center',
      paddingTop: TOP_PADDING,
      marginBottom: LOGO_TO_CARD,
    }}>
      {/* Logo container */}
      <View style={{
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'visible',
        marginTop: 0,
        marginBottom: 0,
      }}>
        <Image
          source={require('../../assets/farmstand-logo.png')}
          style={{
            width: LOGO_WIDTH,
            height: LOGO_HEIGHT,
            flexShrink: 0,
            tintColor: '#FFFFFF'
          }}
          resizeMode="contain"
        />
      </View>
    </View>
  );
}

export { LOGO_WIDTH, LOGO_HEIGHT, TOP_PADDING, LOGO_TO_CARD };
