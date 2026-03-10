import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Platform, Linking } from 'react-native';
import { logLocationPermission } from '@/lib/analytics-events';

export type LocationPermissionStatus = 'unknown' | 'granted' | 'denied' | 'blocked';

interface LocationState {
  hasSeenLocationOnboarding: boolean;
  permissionStatus: LocationPermissionStatus;
  userCoordinates: { latitude: number; longitude: number } | null;
  isLoading: boolean;
  bannerDismissedForSession: boolean;

  // Anchor location for distance calculations - only updated by explicit user actions
  // (Use My Location, manual address search, etc.), NOT by farmstand selection
  anchorLocation: { latitude: number; longitude: number } | null;

  // Actions
  loadLocationState: () => Promise<void>;
  setOnboardingSeen: () => Promise<void>;
  requestLocationPermission: () => Promise<LocationPermissionStatus>;
  checkPermissionStatus: () => Promise<LocationPermissionStatus>;
  getCurrentLocation: () => Promise<{ latitude: number; longitude: number } | null>;
  dismissBannerForSession: () => void;
  openSettings: () => void;
  setAnchorLocation: (location: { latitude: number; longitude: number } | null) => Promise<void>;
}

const STORAGE_KEYS = {
  HAS_SEEN_ONBOARDING: 'farmstand_location_onboarding_seen',
  PERMISSION_STATUS: 'farmstand_location_permission_status',
  USER_COORDINATES: 'farmstand_user_coordinates',
  ANCHOR_LOCATION: 'farmstand_anchor_location',
};

export const useLocationStore = create<LocationState>((set, get) => ({
  hasSeenLocationOnboarding: false,
  permissionStatus: 'unknown',
  userCoordinates: null,
  isLoading: false,
  bannerDismissedForSession: false,
  anchorLocation: null,

  loadLocationState: async () => {
    set({ isLoading: true });
    try {
      const [onboardingData, permissionData, coordinatesData, anchorData] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.HAS_SEEN_ONBOARDING),
        AsyncStorage.getItem(STORAGE_KEYS.PERMISSION_STATUS),
        AsyncStorage.getItem(STORAGE_KEYS.USER_COORDINATES),
        AsyncStorage.getItem(STORAGE_KEYS.ANCHOR_LOCATION),
      ]);

      const hasSeenLocationOnboarding = onboardingData === 'true';
      const storedPermissionStatus = (permissionData as LocationPermissionStatus) || 'unknown';
      const userCoordinates = coordinatesData ? JSON.parse(coordinatesData) : null;
      const anchorLocation = anchorData ? JSON.parse(anchorData) : null;

      // Set cached coordinates immediately for instant UI
      set({
        hasSeenLocationOnboarding,
        permissionStatus: storedPermissionStatus,
        userCoordinates,
        anchorLocation,
        isLoading: false,
      });

      // If permission was granted, verify and refresh location in background
      if (storedPermissionStatus === 'granted') {
        const currentStatus = await get().checkPermissionStatus();
        if (currentStatus === 'granted') {
          // Refresh location in background without blocking UI
          get().getCurrentLocation();
        } else {
          // Permission was revoked
          set({ permissionStatus: currentStatus, userCoordinates: null });
          await AsyncStorage.setItem(STORAGE_KEYS.PERMISSION_STATUS, currentStatus);
          await AsyncStorage.removeItem(STORAGE_KEYS.USER_COORDINATES);
        }
      }
    } catch (error) {
      console.error('Error loading location state:', error);
      set({ isLoading: false });
    }
  },

  setOnboardingSeen: async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.HAS_SEEN_ONBOARDING, 'true');
      set({ hasSeenLocationOnboarding: true });
    } catch (error) {
      console.error('Error saving onboarding state:', error);
    }
  },

  checkPermissionStatus: async (): Promise<LocationPermissionStatus> => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();

      if (status === 'granted') {
        return 'granted';
      } else if (status === 'denied') {
        // On iOS, if denied once, we can't ask again - it's blocked
        // On Android, we can potentially ask again unless "Don't ask again" was selected
        // We'll treat both as denied initially, and blocked if we try to request and fail
        const currentStored = get().permissionStatus;
        return currentStored === 'blocked' ? 'blocked' : 'denied';
      }

      return 'unknown';
    } catch (error) {
      console.error('Error checking permission:', error);
      return 'unknown';
    }
  },

  requestLocationPermission: async (): Promise<LocationPermissionStatus> => {
    set({ isLoading: true });
    try {
      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();

      let permissionStatus: LocationPermissionStatus;

      if (status === 'granted') {
        permissionStatus = 'granted';
        // Get the current location immediately and set as anchor
        const coords = await get().getCurrentLocation();
        if (coords) {
          set({ userCoordinates: coords, anchorLocation: coords });
          await AsyncStorage.setItem(STORAGE_KEYS.USER_COORDINATES, JSON.stringify(coords));
          await AsyncStorage.setItem(STORAGE_KEYS.ANCHOR_LOCATION, JSON.stringify(coords));
        }
      } else if (!canAskAgain) {
        // User selected "Don't allow" on iOS or "Don't ask again" on Android
        permissionStatus = 'blocked';
      } else {
        permissionStatus = 'denied';
      }

      await AsyncStorage.setItem(STORAGE_KEYS.PERMISSION_STATUS, permissionStatus);
      set({ permissionStatus, isLoading: false });

      // Log location permission to analytics
      logLocationPermission(permissionStatus === 'granted');

      return permissionStatus;
    } catch (error) {
      console.error('Error requesting permission:', error);
      set({ isLoading: false });
      return 'denied';
    }
  },

  getCurrentLocation: async () => {
    try {
      // Use low accuracy first for quick response, then optionally refine
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Low,
      });

      const coords = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };

      set({ userCoordinates: coords });
      await AsyncStorage.setItem(STORAGE_KEYS.USER_COORDINATES, JSON.stringify(coords));

      return coords;
    } catch (error) {
      // Fall back to last known location for even faster response
      try {
        const lastKnown = await Location.getLastKnownPositionAsync();
        if (lastKnown) {
          const coords = {
            latitude: lastKnown.coords.latitude,
            longitude: lastKnown.coords.longitude,
          };
          set({ userCoordinates: coords });
          await AsyncStorage.setItem(STORAGE_KEYS.USER_COORDINATES, JSON.stringify(coords));
          return coords;
        }
      } catch {
        // Ignore fallback errors
      }
      // Use console.log instead of console.error for expected location errors
      // kCLErrorDomain error 1 = location services denied/unavailable (common on simulators)
      console.log('[Location] Could not get current location:', error instanceof Error ? error.message : 'Unknown');
      return null;
    }
  },

  dismissBannerForSession: () => {
    set({ bannerDismissedForSession: true });
  },

  openSettings: () => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  },

  setAnchorLocation: async (location) => {
    set({ anchorLocation: location });
    if (location) {
      await AsyncStorage.setItem(STORAGE_KEYS.ANCHOR_LOCATION, JSON.stringify(location));
    } else {
      await AsyncStorage.removeItem(STORAGE_KEYS.ANCHOR_LOCATION);
    }
  },
}));
