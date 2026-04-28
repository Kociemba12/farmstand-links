import React from 'react';
import { View, Text, ImageBackground } from 'react-native';
import { Sprout } from 'lucide-react-native';

interface RusticHeaderProps {
  subtitle?: string;
}

export function RusticHeader({ subtitle = "Oregon" }: RusticHeaderProps) {
  return (
    <View className="overflow-hidden">
      {/* Wood texture background with overlay */}
      <ImageBackground
        source={{ uri: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800' }}
        resizeMode="cover"
        style={{ paddingVertical: 16, paddingHorizontal: 20 }}
      >
        {/* Dark overlay for readability */}
        <View
          className="absolute inset-0 bg-bark/70"
          style={{ backgroundColor: 'rgba(92, 64, 51, 0.75)' }}
        />

        {/* Content */}
        <View className="flex-row items-center justify-center relative">
          {/* Left decorative wheat/sprout */}
          <View className="absolute left-0">
            <Sprout size={28} color="#D4943A" style={{ transform: [{ rotate: '-30deg' }] }} />
          </View>

          {/* Main title area */}
          <View className="items-center">
            {/* Farmstand text with rustic styling */}
            <View className="flex-row items-center">
              <Text
                className="text-3xl font-bold tracking-wide"
                style={{
                  color: '#FDF8F3',
                  textShadowColor: 'rgba(0, 0, 0, 0.5)',
                  textShadowOffset: { width: 1, height: 1 },
                  textShadowRadius: 2,
                  fontFamily: 'System',
                  letterSpacing: 2,
                }}
              >
                FARMSTAND
              </Text>
            </View>

            {/* Decorative line */}
            <View className="flex-row items-center mt-1">
              <View className="h-0.5 w-8 bg-amber/60 rounded-full" />
              <Sprout size={14} color="#D4943A" className="mx-2" />
              <View className="h-0.5 w-8 bg-amber/60 rounded-full" />
            </View>

            {/* Subtitle */}
            <Text
              className="text-sm mt-1 tracking-widest uppercase"
              style={{
                color: '#E8DDD4',
                letterSpacing: 4,
              }}
            >
              {subtitle}
            </Text>
          </View>

          {/* Right decorative wheat/sprout */}
          <View className="absolute right-0">
            <Sprout size={28} color="#D4943A" style={{ transform: [{ rotate: '30deg' }] }} />
          </View>
        </View>
      </ImageBackground>
    </View>
  );
}
