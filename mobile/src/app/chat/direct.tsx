import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

/**
 * /chat/direct?farmstandId=...&farmstandName=...&otherUserId=...
 *
 * Backward-compatibility shim for old push notification payloads.
 * New code navigates directly to /chat/new. This screen is kept only
 * so deep links with /chat/direct still work.
 */
export default function DirectChatRedirect() {
  const params = useLocalSearchParams<{
    farmstandId?: string;
    farmstandName?: string;
    otherUserId?: string;
  }>();
  const router = useRouter();

  useEffect(() => {
    const query = new URLSearchParams();
    if (params.farmstandId) query.set('farmstandId', params.farmstandId);
    if (params.farmstandName) query.set('farmstandName', params.farmstandName);
    if (params.otherUserId) query.set('otherUserId', params.otherUserId);
    router.replace(`/chat/new?${query.toString()}`);
  }, []);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" color="#4A7C59" />
    </View>
  );
}
