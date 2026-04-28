import React from 'react';
import { View, Text, Pressable, Switch, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Bell, Info, Bug } from 'lucide-react-native';
import { AdminGuard } from '@/components/AdminGuard';
import Constants from 'expo-constants';

// Environment debug info
const getEnvironmentInfo = () => {
  const expoConfig = Constants.expoConfig;
  return {
    appName: expoConfig?.name || 'Unknown',
    version: expoConfig?.version || '1.0.0',
    sdkVersion: expoConfig?.sdkVersion || 'Unknown',
    platform: Constants.platform?.ios ? 'iOS' : Constants.platform?.android ? 'Android' : 'Web',
    isDevice: Constants.isDevice ? 'Physical Device' : 'Simulator/Emulator',
    debugMode: __DEV__ ? 'Development' : 'Production',
  };
};

function SettingsContent() {
  const router = useRouter();
  const [emailNotifications, setEmailNotifications] = React.useState(true);
  const envInfo = getEnvironmentInfo();

  return (
    <View className="flex-1 bg-gray-50">
      <SafeAreaView edges={['top']} className="bg-white">
        <View className="flex-row items-center justify-between px-5 py-4 border-b border-gray-100">
          <Pressable onPress={() => router.back()} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#111827" />
          </Pressable>
          <Text className="text-lg font-semibold text-gray-900">Admin Settings</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="mt-4 mx-4">
          <View className="bg-white rounded-2xl p-5 mb-4">
            <View className="flex-row items-center mb-4">
              <Bell size={18} color="#6b7280" />
              <Text className="text-sm font-semibold text-gray-500 uppercase ml-2">
                Notifications
              </Text>
            </View>

            <View className="flex-row items-center justify-between">
              <View className="flex-1 mr-4">
                <Text className="text-base font-medium text-gray-900">Email Notifications</Text>
                <Text className="text-sm text-gray-500 mt-0.5">
                  Receive emails for new submissions and reports
                </Text>
              </View>
              <Switch
                value={emailNotifications}
                onValueChange={setEmailNotifications}
                trackColor={{ false: '#d1d5db', true: '#86efac' }}
                thumbColor={emailNotifications ? '#16a34a' : '#9ca3af'}
              />
            </View>
          </View>

          {/* Environment Debug Info */}
          {__DEV__ && (
          <View className="bg-white rounded-2xl p-5 mb-4">
            <View className="flex-row items-center mb-4">
              <Bug size={18} color="#6b7280" />
              <Text className="text-sm font-semibold text-gray-500 uppercase ml-2">
                Environment Debug
              </Text>
            </View>

            <View className="space-y-2">
              <View className="flex-row justify-between py-2 border-b border-gray-100">
                <Text className="text-sm text-gray-500">App Name</Text>
                <Text className="text-sm font-medium text-gray-900">{envInfo.appName}</Text>
              </View>
              <View className="flex-row justify-between py-2 border-b border-gray-100">
                <Text className="text-sm text-gray-500">Version</Text>
                <Text className="text-sm font-medium text-gray-900">{envInfo.version}</Text>
              </View>
              <View className="flex-row justify-between py-2 border-b border-gray-100">
                <Text className="text-sm text-gray-500">SDK Version</Text>
                <Text className="text-sm font-medium text-gray-900">{envInfo.sdkVersion}</Text>
              </View>
              <View className="flex-row justify-between py-2 border-b border-gray-100">
                <Text className="text-sm text-gray-500">Platform</Text>
                <Text className="text-sm font-medium text-gray-900">{envInfo.platform}</Text>
              </View>
              <View className="flex-row justify-between py-2 border-b border-gray-100">
                <Text className="text-sm text-gray-500">Device</Text>
                <Text className="text-sm font-medium text-gray-900">{envInfo.isDevice}</Text>
              </View>
              <View className="flex-row justify-between py-2">
                <Text className="text-sm text-gray-500">Mode</Text>
                <View className={`px-2 py-0.5 rounded ${envInfo.debugMode === 'Development' ? 'bg-amber-100' : 'bg-green-100'}`}>
                  <Text className={`text-xs font-semibold ${envInfo.debugMode === 'Development' ? 'text-amber-700' : 'text-green-700'}`}>
                    {envInfo.debugMode}
                  </Text>
                </View>
              </View>
            </View>
          </View>
          )}

          {/* Version Info */}
          <View className="flex-row items-center justify-center mt-4">
            <Info size={14} color="#9ca3af" />
            <Text className="text-sm text-gray-400 ml-2">Admin Panel v{envInfo.version}</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

export default function Settings() {
  return (
    <AdminGuard>
      <SettingsContent />
    </AdminGuard>
  );
}
