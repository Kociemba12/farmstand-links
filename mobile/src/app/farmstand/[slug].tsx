import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export default function FarmstandBySlug() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const [error, setError] = useState(false);

  useEffect(() => {
    console.log('[FarmstandBySlug] ===== SLUG RESOLUTION START =====');
    console.log('[FarmstandBySlug] Incoming slug:', slug);

    if (!slug) {
      console.log('[FarmstandBySlug] ERROR: No slug provided');
      setError(true);
      return;
    }

    const resolve = async () => {
      try {
        if (!isSupabaseConfigured()) {
          console.log('[FarmstandBySlug] ERROR: Supabase not configured');
          setError(true);
          return;
        }

        console.log('[FarmstandBySlug] Querying farmstands table for slug:', slug);

        const result = await supabase
          .from<{ id: string }>('farmstands')
          .select('id')
          .eq('slug', slug)
          .limit(1)
          .execute();

        const data = result?.data?.[0] ?? null;

        console.log('[FarmstandBySlug] Query result - found:', !!data, 'id:', data?.id ?? 'none');
        console.log('[FarmstandBySlug] Query error:', result?.error?.message ?? 'none');

        if (data?.id) {
          console.log('[FarmstandBySlug] SUCCESS: Navigating to /farm/' + data.id);
          console.log('[FarmstandBySlug] ===== SLUG RESOLUTION COMPLETE =====');
          router.replace(`/farm/${data.id}`);
        } else {
          console.log('[FarmstandBySlug] ERROR: Farmstand not found for slug:', slug);
          setError(true);
        }
      } catch (err) {
        console.log('[FarmstandBySlug] EXCEPTION resolving slug:', err);
        setError(true);
      }
    };

    resolve();
  }, [slug, router]);

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-[#FDF8F3] px-8">
        <Text className="text-2xl font-bold text-[#2D5A3D] mb-3 text-center">
          Farmstand Not Found
        </Text>
        <Text className="text-base text-[#8B6F4E] text-center leading-6">
          The farmstand you're looking for doesn't exist or may have been removed.
        </Text>
        <Text
          className="mt-6 text-sm text-[#2D5A3D] underline"
          onPress={() => router.replace('/(tabs)')}
        >
          Browse all farmstands
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center bg-[#FDF8F3]">
      <ActivityIndicator size="large" color="#2D5A3D" />
      <Text className="mt-4 text-sm text-[#8B6F4E]">Loading farmstand...</Text>
    </View>
  );
}
