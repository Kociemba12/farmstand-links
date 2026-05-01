import React, { useEffect, useState, useCallback } from 'react';
import { VideoView, useVideoPlayer } from 'expo-video';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Switch,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Save,
  Image as ImageIcon,
  MapPin,
  Phone,
  Mail,
  Globe,
  X,
  Camera,
  Star,
  ImagePlus,
  Clock,
  ChevronDown,
  CheckCircle,
  Calendar,
  CreditCard,
  FileText,
  Eye,
  EyeOff,
  Trash2,
  AlertCircle,
  Check,
  RefreshCw,
  Plus,
  Video,
  Play,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useAdminStore } from '@/lib/admin-store';
import { useUserStore } from '@/lib/user-store';
import { Farmstand, OperatingStatus, SeasonalDates, HoursSchedule, HoursDay } from '@/lib/farmer-store';
import { useProductsStore } from '@/lib/products-store';
import { logFarmstandEdit } from '@/lib/analytics-events';
import { FarmerRouteGuard } from '@/components/FarmerRouteGuard';
import { formatPhoneNumber, getPhoneDigits } from '@/lib/phone-utils';
import { isDefaultCoordinates } from '@/utils/geocode';
import { uploadToSupabaseStorage, deleteFromSupabaseStorage, getStoragePublicUrl, isSupabaseConfigured, ensureSessionReady } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useCanManageFarmstand } from '@/lib/useCanManageFarmstand';
import { trackEvent } from '@/lib/track';

// ============ CONSTANTS ============

const FREE_PHOTO_LIMIT = 1;
const PREMIUM_PHOTO_LIMIT = 20;
const FREE_VIDEO_LIMIT = 0;
const PREMIUM_VIDEO_LIMIT = 1;
const MAX_VIDEO_DURATION_SECONDS = 30;

const PRODUCT_CATEGORIES = [
  'Fruits',
  'Vegetables',
  'Eggs',
  'Dairy',
  'Meat',
  'Honey',
  'Flowers',
  'Baked Goods',
  'Preserves',
  'Herbs',
];

const PAYMENT_OPTIONS = [
  { id: 'cash', label: 'Cash' },
  { id: 'card', label: 'Credit/Debit Card' },
  { id: 'venmo', label: 'Venmo' },
  { id: 'cashapp', label: 'Cash App' },
  { id: 'paypal', label: 'PayPal' },
  { id: 'zelle', label: 'Zelle' },
];

const OPERATIONAL_STATUS_OPTIONS: { id: OperatingStatus; label: string; color: string }[] = [
  { id: 'open', label: 'Open & Operating', color: '#16a34a' },
  { id: 'temporarily_closed', label: 'Temporarily Closed', color: '#f59e0b' },
  { id: 'seasonal', label: 'Seasonal (Closed Now)', color: '#3b82f6' },
  { id: 'permanently_closed', label: 'Permanently Closed', color: '#ef4444' },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

const DAYS: { key: DayKey; label: string; short: string }[] = [
  { key: 'mon', label: 'Monday', short: 'Mon' },
  { key: 'tue', label: 'Tuesday', short: 'Tue' },
  { key: 'wed', label: 'Wednesday', short: 'Wed' },
  { key: 'thu', label: 'Thursday', short: 'Thu' },
  { key: 'fri', label: 'Friday', short: 'Fri' },
  { key: 'sat', label: 'Saturday', short: 'Sat' },
  { key: 'sun', label: 'Sunday', short: 'Sun' },
];

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hour = Math.floor(i / 2);
  const minute = i % 2 === 0 ? '00' : '30';
  const hourStr = hour.toString().padStart(2, '0');
  return `${hourStr}:${minute}`;
});

const DEFAULT_HOURS: HoursSchedule = {
  timezone: 'America/Los_Angeles',
  mon: { open: '09:00', close: '17:00', closed: false },
  tue: { open: '09:00', close: '17:00', closed: false },
  wed: { open: '09:00', close: '17:00', closed: false },
  thu: { open: '09:00', close: '17:00', closed: false },
  fri: { open: '09:00', close: '17:00', closed: false },
  sat: { open: '09:00', close: '17:00', closed: false },
  sun: { open: '09:00', close: '17:00', closed: true },
};

// ============ HELPERS ============

const formatTime = (time: string): string => {
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${minutes.toString().padStart(2, '0')} ${period}`;
};

const timeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

// ============ INTERFACES ============

interface PhotoItem {
  id: string;
  uri: string;
  uploading?: boolean;
  failed?: boolean;
  isLocalPreview?: boolean;
}

interface VideoItem {
  uri: string;
  storagePath: string | null;
  uploading: boolean;
  failed: boolean;
  isLocalPreview: boolean;
  durationSeconds: number | null;
}

interface FormData {
  name: string;
  shortDescription: string;
  description: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  latitude: string;
  longitude: string;
  paymentOptions: string[];
  operatingStatus: OperatingStatus;
  showOnMap: boolean;
  seasonalNotes: string;
  photos: string[];
  mainPhotoIndex: number;
  honorSystem: boolean;
  selfServe: boolean;
  directionsNotes: string;
  parkingNotes: string;
  todaysNote: string;
  seasonalStart: { month: number; day: number } | null;
  seasonalEnd: { month: number; day: number } | null;
}

// ============ DAY HOURS ROW COMPONENT ============

interface DayHoursRowProps {
  dayKey: DayKey;
  label: string;
  hours: HoursDay;
  onOpenChange: (time: string) => void;
  onCloseChange: (time: string) => void;
  onClosedToggle: (closed: boolean) => void;
}

function DayHoursRow({ dayKey, label, hours, onOpenChange, onCloseChange, onClosedToggle }: DayHoursRowProps) {
  const [showOpenPicker, setShowOpenPicker] = useState(false);
  const [showClosePicker, setShowClosePicker] = useState(false);

  return (
    <>
      <View className="flex-row items-center py-3 border-b border-gray-100">
        <View className="w-20">
          <Text className="text-gray-900 font-medium text-sm">{label}</Text>
        </View>

        {hours.closed ? (
          <View className="flex-1 flex-row items-center justify-center">
            <Text className="text-gray-400 font-medium text-sm">Closed</Text>
          </View>
        ) : (
          <View className="flex-1 flex-row items-center justify-center">
            <Pressable
              onPress={() => setShowOpenPicker(true)}
              className="bg-gray-100 px-2.5 py-1.5 rounded-lg"
            >
              <Text className="text-gray-900 text-sm">{formatTime(hours.open ?? '09:00')}</Text>
            </Pressable>
            <Text className="text-gray-400 mx-1.5 text-sm">to</Text>
            <Pressable
              onPress={() => setShowClosePicker(true)}
              className="bg-gray-100 px-2.5 py-1.5 rounded-lg"
            >
              <Text className="text-gray-900 text-sm">{formatTime(hours.close ?? '17:00')}</Text>
            </Pressable>
          </View>
        )}

        <Switch
          value={!hours.closed}
          onValueChange={(open) => onClosedToggle(!open)}
          trackColor={{ false: '#d1d5db', true: '#86efac' }}
          thumbColor={!hours.closed ? '#16a34a' : '#9ca3af'}
          style={{ transform: [{ scale: 0.85 }] }}
        />
      </View>

      {/* Open Time Picker */}
      <Modal visible={showOpenPicker} transparent animationType="fade">
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setShowOpenPicker(false)}>
          <View className="bg-white rounded-t-3xl pt-2 pb-8 max-h-[50%]">
            <View className="w-10 h-1 bg-gray-300 rounded-full self-center mb-4" />
            <Text className="text-lg font-semibold text-gray-900 px-5 mb-3">{label} - Opens At</Text>
            <ScrollView>
              {TIME_OPTIONS.map((time) => (
                <Pressable
                  key={time}
                  onPress={() => {
                    onOpenChange(time);
                    setShowOpenPicker(false);
                  }}
                  className="flex-row items-center px-5 py-3 active:bg-gray-50"
                >
                  <Text className="text-base text-gray-700 flex-1">{formatTime(time)}</Text>
                  {hours.open === time && <CheckCircle size={20} color="#2D5A3D" />}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* Close Time Picker */}
      <Modal visible={showClosePicker} transparent animationType="fade">
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setShowClosePicker(false)}>
          <View className="bg-white rounded-t-3xl pt-2 pb-8 max-h-[50%]">
            <View className="w-10 h-1 bg-gray-300 rounded-full self-center mb-4" />
            <Text className="text-lg font-semibold text-gray-900 px-5 mb-3">{label} - Closes At</Text>
            <ScrollView>
              {TIME_OPTIONS.map((time) => (
                <Pressable
                  key={time}
                  onPress={() => {
                    onCloseChange(time);
                    setShowClosePicker(false);
                  }}
                  className="flex-row items-center px-5 py-3 active:bg-gray-50"
                >
                  <Text className="text-base text-gray-700 flex-1">{formatTime(time)}</Text>
                  {hours.close === time && <CheckCircle size={20} color="#2D5A3D" />}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

// ============ SECTION HEADER COMPONENT ============

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  delay?: number;
}

function Section({ icon, title, subtitle, children, delay = 0 }: SectionProps) {
  return (
    <Animated.View entering={FadeInDown.delay(delay)} className="bg-white mt-4 mx-4 rounded-2xl overflow-hidden">
      <View className="px-5 pt-5 pb-3 border-b border-gray-100">
        <View className="flex-row items-center">
          {icon}
          <Text className="text-base font-semibold text-gray-900 ml-2">{title}</Text>
        </View>
        {subtitle && (
          <Text className="text-sm text-gray-500 mt-1">{subtitle}</Text>
        )}
      </View>
      <View className="p-5">
        {children}
      </View>
    </Animated.View>
  );
}

// ============ VIDEO THUMBNAIL COMPONENT ============

function VideoThumbnailView({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') {
        player.pause();
      }
    });
    return () => sub.remove();
  }, [player]);

  return (
    <VideoView
      player={player}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

// ============ MAIN COMPONENT ============

export default function OwnerEditScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const farmstandId = params.id;

  const user = useUserStore((s) => s.user);
  const isLoggedIn = useUserStore((s) => s.isLoggedIn);
  const isGuest = useUserStore((s) => s.isGuest);

  // Get auth session from AuthProvider for reliable session state
  const { session: authSession, loading: authLoading } = useAuth();

  // Get safe area insets for floating back button positioning
  const insets = useSafeAreaInsets();

  const getFarmstandById = useAdminStore((s) => s.getFarmstandById);
  const updateFarmstand = useAdminStore((s) => s.updateFarmstand);
  const refreshSingleFarmstand = useAdminStore((s) => s.refreshSingleFarmstand);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const ownerDeleteFarmstand = useAdminStore((s) => s.ownerDeleteFarmstand);

  const logEdit = useProductsStore((s) => s.logEdit);
  const fetchProductsForFarmstand = useProductsStore((s) => s.fetchProductsForFarmstand);

  const isGuestUser = isGuest();

  // Check if user is an approved owner of this farmstand via Supabase owner_id
  const canManage = useCanManageFarmstand(farmstandId);

  const [formData, setFormData] = useState<FormData>({
    name: '',
    shortDescription: '',
    description: '',
    addressLine1: '',
    city: '',
    state: 'OR',
    zip: '',
    phone: '',
    email: '',
    latitude: '',
    longitude: '',
    paymentOptions: ['cash'],
    operatingStatus: 'open',
    showOnMap: true,
    seasonalNotes: '',
    photos: [],
    mainPhotoIndex: 0,
    honorSystem: false,
    selfServe: false,
    directionsNotes: '',
    parkingNotes: '',
    todaysNote: '',
    seasonalStart: null,
    seasonalEnd: null,
  });

  const [hours, setHours] = useState<HoursSchedule>(DEFAULT_HOURS);
  const [isOpen24_7, setIsOpen24_7] = useState(false);
  const [originalData, setOriginalData] = useState<FormData | null>(null);
  const [originalHours, setOriginalHours] = useState<HoursSchedule | null>(null);
  const [originalIsOpen24_7, setOriginalIsOpen24_7] = useState(false);
  const [farmstand, setFarmstand] = useState<Farmstand | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showPhotoOptions, setShowPhotoOptions] = useState(false);
  const [showSeasonalModal, setShowSeasonalModal] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [localPhotos, setLocalPhotos] = useState<PhotoItem[]>([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [selectedProductCategories, setSelectedProductCategories] = useState<string[]>([]);
  const [otherProductItems, setOtherProductItems] = useState<string[]>([]);
  const [otherProductInput, setOtherProductInput] = useState('');
  const [localVideo, setLocalVideo] = useState<VideoItem | null>(null);

  const showToast = (text: string, type: 'success' | 'error') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 2500);
  };

  const toggleProductCategory = useCallback(async (category: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedProductCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
    );
  }, []);

  const addOtherProductItem = useCallback(async () => {
    const trimmed = otherProductInput.trim();
    if (!trimmed) return;
    const isDuplicate = otherProductItems.some((p) => p.toLowerCase() === trimmed.toLowerCase());
    if (isDuplicate) {
      Alert.alert('Duplicate', 'This product has already been added.');
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOtherProductItems((prev) => [...prev, trimmed]);
    setOtherProductInput('');
  }, [otherProductInput, otherProductItems]);

  const removeOtherProductItem = useCallback(async (product: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOtherProductItems((prev) => prev.filter((p) => p !== product));
  }, []);

  // Check if current user is the owner (for delete button visibility)
  const isOwner = farmstand && user?.id && (
    farmstand.claimedByUserId === user.id ||
    farmstand.ownerUserId === user.id
  );

  const isPremium = farmstand?.premiumStatus === 'trial' || farmstand?.premiumStatus === 'active';
  const photoLimit = isPremium ? PREMIUM_PHOTO_LIMIT : FREE_PHOTO_LIMIT;
  const photoSubtitle = isPremium
    ? `Add up to ${PREMIUM_PHOTO_LIMIT} photos. First photo is your main image.`
    : `Add 1 photo. First photo is your main image.`;

  // Check authorization
  useEffect(() => {
    if (!isLoggedIn) {
      router.replace('/auth/login');
    }
  }, [isLoggedIn]);

  // Load farmstand data
  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      await loadAdminData();

      if (farmstandId) {
        const fs = getFarmstandById(farmstandId);
        if (fs) {
          // Log auth debug info
          console.log('[EditListing] Checking ownership:');
          console.log('  user.id:', user?.id);
          console.log('  user.email:', user?.email);
          console.log('  fs.ownerUserId:', fs.ownerUserId);
          console.log('  fs.claimedByUserId:', fs.claimedByUserId);

          // Verify ownership - check multiple possible owner identifiers
          // claimedByUserId is the Supabase auth.uid() from claimed_by column
          const isOwner =
            fs.claimedByUserId === user?.id ||
            fs.ownerUserId === user?.id ||
            fs.ownerUserId === user?.email ||
            fs.claimedByUserId === user?.email;

          console.log('  isOwner:', isOwner);

          // Note: if isOwner is false here, canManage hook will also be false
          // and the render guard below will show "Claim pending approval" UI
          // We still load farmstand data so it's ready if ownership is confirmed

          setFarmstand(fs);
          if (__DEV__) console.log('[EditListing] Pre-loading products from farmstand_products for:', farmstandId);
          fetchProductsForFarmstand(farmstandId).catch(() => {});
          const data: FormData = {
            name: fs.name,
            shortDescription: fs.shortDescription,
            description: fs.description,
            addressLine1: fs.addressLine1 || '',
            city: fs.city || '',
            state: fs.state || 'OR',
            zip: fs.zip || '',
            phone: fs.phone || '',
            email: fs.email || '',
            latitude: fs.latitude?.toString() || '',
            longitude: fs.longitude?.toString() || '',
            paymentOptions: fs.paymentOptions,
            operatingStatus: fs.operatingStatus || 'active',
            showOnMap: fs.showOnMap,
            seasonalNotes: fs.seasonalNotes || '',
            // CRITICAL: Filter out local file:// URIs, only load http/https URLs from database
            photos: (fs.photos || []).filter((p) => p.startsWith('http')),
            mainPhotoIndex: fs.mainPhotoIndex ?? 0,
            honorSystem: fs.honorSystem || false,
            selfServe: fs.selfServe || false,
            directionsNotes: fs.directionsNotes || '',
            parkingNotes: fs.parkingNotes || '',
            todaysNote: fs.todaysNote || '',
            seasonalStart: fs.seasonalDates ? { month: fs.seasonalDates.start_month, day: fs.seasonalDates.start_day } : null,
            seasonalEnd: fs.seasonalDates ? { month: fs.seasonalDates.end_month, day: fs.seasonalDates.end_day } : null,
          };
          setFormData(data);
          setOriginalData(data);

          // Seed localPhotos from saved remote URLs
          const savedPhotos: PhotoItem[] = (data.photos as string[]).map((url) => ({
            id: url,
            uri: url,
            uploading: false,
            failed: false,
            isLocalPreview: false,
          }));
          setLocalPhotos(savedPhotos);

          // Seed localVideo from saved remote URL
          if (__DEV__) console.log('[EditListing] Loaded video fields — videoUrl:', fs.videoUrl ?? '(none)', '| videoPath:', fs.videoPath ?? '(none)', '| duration:', fs.videoDurationSeconds ?? '(none)');
          if (fs.videoUrl) {
            setLocalVideo({
              uri: fs.videoUrl,
              storagePath: fs.videoPath ?? null,
              uploading: false,
              failed: false,
              isLocalPreview: false,
              durationSeconds: fs.videoDurationSeconds ?? null,
            });
          }

          // Initialize product categories and other products from offerings
          const existingProductCats = (fs.offerings || []).filter((o: string) =>
            PRODUCT_CATEGORIES.includes(o)
          );
          setSelectedProductCategories(existingProductCats);
          setOtherProductItems(fs.otherProducts || []);

          // Load hours
          const loadedHours = fs.hours || DEFAULT_HOURS;
          setHours(loadedHours);
          setOriginalHours(loadedHours);

          // Load 24/7 status
          setIsOpen24_7(fs.isOpen24_7 || false);
          setOriginalIsOpen24_7(fs.isOpen24_7 || false);

        } else {
          Alert.alert('Not Found', 'Farmstand not found.', [
            { text: 'OK', onPress: () => router.back() },
          ]);
        }
      }
      setIsLoading(false);
    };

    load();
  }, [farmstandId]);

  // ============ FORM FIELD HANDLERS ============

  const updateField = useCallback(<K extends keyof FormData>(field: K, value: FormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const togglePayment = useCallback((payment: string) => {
    setFormData((prev) => ({
      ...prev,
      paymentOptions: prev.paymentOptions.includes(payment)
        ? prev.paymentOptions.filter((p) => p !== payment)
        : [...prev.paymentOptions, payment],
    }));
  }, []);

  // ============ HOURS HANDLERS ============

  const updateDayHours = useCallback((day: DayKey, field: keyof HoursDay, value: string | boolean) => {
    setHours((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        [field]: value,
      },
    }));
  }, []);

  const setWeekdayWeekendHours = useCallback(() => {
    setHours((prev) => ({
      ...prev,
      mon: { open: '09:00', close: '17:00', closed: false },
      tue: { open: '09:00', close: '17:00', closed: false },
      wed: { open: '09:00', close: '17:00', closed: false },
      thu: { open: '09:00', close: '17:00', closed: false },
      fri: { open: '09:00', close: '17:00', closed: false },
      sat: { open: '08:00', close: '14:00', closed: false },
      sun: { open: '08:00', close: '14:00', closed: true },
    }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  // ============ ADDRESS HANDLERS (No auto-geocoding - use map instead) ============

  const parseAndSetAddress = useCallback((fullAddress: string) => {
    const trimmed = fullAddress.trim();
    const parts = trimmed.split(',').map(p => p.trim());

    if (parts.length >= 2) {
      const street = parts[0];
      const lastPart = parts[parts.length - 1];
      let city = '';
      let stateZip = lastPart;

      if (parts.length >= 3) {
        city = parts[1];
        stateZip = parts[parts.length - 1];
      } else {
        stateZip = lastPart;
      }

      const stateZipMatch = stateZip.match(/([A-Z]{2})\s*(\d{5})?/i);
      let state = formData.state || 'OR';
      let zip = '';

      if (stateZipMatch) {
        state = stateZipMatch[1].toUpperCase();
        zip = stateZipMatch[2] || '';
        if (!city) {
          city = stateZip.replace(stateZipMatch[0], '').trim();
        }
      } else if (!city) {
        city = stateZip;
      }

      setFormData(prev => ({
        ...prev,
        addressLine1: street,
        city: city,
        state: state,
        zip: zip,
      }));
    } else {
      setFormData(prev => ({ ...prev, addressLine1: trimmed }));
    }
  }, [formData.state]);

  const handleAddressChange = useCallback((text: string) => {
    const hasComma = text.includes(',');
    const hasStatePattern = /[A-Z]{2}\s*\d{5}|,\s*[A-Z]{2}(?:\s|$)/i.test(text);

    if (hasComma || hasStatePattern) {
      parseAndSetAddress(text);
    } else {
      setFormData(prev => ({ ...prev, addressLine1: text }));
    }
  }, [parseAndSetAddress]);

  const handleCityChange = useCallback((text: string) => {
    setFormData(prev => ({ ...prev, city: text }));
  }, []);

  const handleStateChange = useCallback((text: string) => {
    const upperText = text.toUpperCase();
    setFormData(prev => ({ ...prev, state: upperText }));
  }, []);

  // ============ PHOTO MANAGEMENT ============

  const removePhoto = useCallback(async (photoId: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLocalPhotos((prev) => prev.filter((p) => p.id !== photoId));
    setFormData((prev) => {
      const newPhotos = prev.photos.filter((url) => url !== photoId);
      return { ...prev, photos: newPhotos, mainPhotoIndex: Math.max(0, Math.min(prev.mainPhotoIndex, newPhotos.length - 1)) };
    });
  }, []);

  const setAsMainPhoto = useCallback(async (photoId: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Only allow setting main photo for fully uploaded remote images
    if (!photoId.startsWith('http')) return;

    setFormData((prev) => {
      const idx = prev.photos.indexOf(photoId);
      if (idx === -1) return prev;
      return { ...prev, mainPhotoIndex: idx };
    });

    if (farmstandId) {
      try {
        await updateFarmstand(farmstandId, { heroImageUrl: photoId });
        setFarmstand((prev) => prev ? { ...prev, heroImageUrl: photoId } : prev);
        console.log('[EditListing] Updated hero_image_url to:', photoId);
      } catch (err) {
        console.error('[EditListing] Failed to update hero image:', err);
      }
    }
  }, [farmstandId, updateFarmstand]);

  const addPhoto = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    trackEvent('photos_manager_opened', { farmstand_id: farmstandId ?? null, farmstand_name: farmstand?.name ?? null });
    setShowPhotoOptions(true);
  }, [farmstandId, farmstand?.name]);

  /**
   * Upload a local URI to Supabase Storage and save it to the farmstand record.
   * Returns the remote URL on success, throws on failure.
   */
  const uploadAndSavePhoto = async (localUri: string): Promise<string> => {
    if (!farmstandId || !isSupabaseConfigured()) {
      throw new Error('Storage is not configured');
    }

    const timestamp = Date.now();
    const fileExtension = localUri.split('.').pop()?.toLowerCase() || 'jpg';
    const fileName = `${timestamp}.${fileExtension}`;
    const storagePath = `${farmstandId}/${fileName}`;

    console.log('[EditListing] Uploading photo:', storagePath);

    const { url: uploadedUrl, error: uploadError } = await uploadToSupabaseStorage(
      'farmstand-photos',
      storagePath,
      localUri,
      `image/${fileExtension === 'png' ? 'png' : 'jpeg'}`
    );

    if (uploadError || !uploadedUrl) {
      throw new Error(uploadError?.message || 'Upload failed');
    }

    if (!uploadedUrl.startsWith('http')) {
      throw new Error('Invalid URL returned from storage');
    }

    // Derive the current remote photos from formData (only http URLs)
    const currentPhotos = formData.photos.filter((p) => p.startsWith('http'));
    const updatedPhotos = [...currentPhotos, uploadedUrl];
    const needsHeroImage = !farmstand?.heroImageUrl || currentPhotos.length === 0;

    await updateFarmstand(farmstandId, {
      photos: updatedPhotos,
      ...(needsHeroImage ? { heroImageUrl: uploadedUrl } : {}),
    });

    await refreshSingleFarmstand(farmstandId);

    if (needsHeroImage) {
      setFarmstand((prev) => prev ? { ...prev, heroImageUrl: uploadedUrl } : prev);
    }

    // Keep formData.photos in sync (used for hero logic above)
    setFormData((prev) => ({
      ...prev,
      photos: [...prev.photos.filter((p) => p.startsWith('http')), uploadedUrl],
    }));

    console.log('[EditListing] ✅ Photo saved:', uploadedUrl);
    return uploadedUrl;
  };

  /** Shared optimistic upload logic — called by both library picker and camera */
  const startOptimisticUpload = (localUri: string) => {
    const tempId = `temp-${Date.now()}`;
    const tempPhoto: PhotoItem = {
      id: tempId,
      uri: localUri,
      uploading: true,
      failed: false,
      isLocalPreview: true,
    };

    setLocalPhotos((prev) => [...prev, tempPhoto]);

    // Fire upload in background — do NOT await here so UI is never blocked
    uploadAndSavePhoto(localUri).then((uploadedUrl) => {
      setLocalPhotos((prev) =>
        prev.map((p) =>
          p.id === tempId
            ? { id: uploadedUrl, uri: uploadedUrl, uploading: false, failed: false, isLocalPreview: false }
            : p
        )
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }).catch((err) => {
      console.error('[EditListing] Upload failed:', err);
      setLocalPhotos((prev) =>
        prev.map((p) =>
          p.id === tempId ? { ...p, uploading: false, failed: true } : p
        )
      );
    });
  };

  const retryPhoto = (photo: PhotoItem) => {
    // Reset to uploading state and retry
    setLocalPhotos((prev) =>
      prev.map((p) => (p.id === photo.id ? { ...p, uploading: true, failed: false } : p))
    );

    uploadAndSavePhoto(photo.uri).then((uploadedUrl) => {
      setLocalPhotos((prev) =>
        prev.map((p) =>
          p.id === photo.id
            ? { id: uploadedUrl, uri: uploadedUrl, uploading: false, failed: false, isLocalPreview: false }
            : p
        )
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }).catch((err) => {
      console.error('[EditListing] Retry failed:', err);
      setLocalPhotos((prev) =>
        prev.map((p) =>
          p.id === photo.id ? { ...p, uploading: false, failed: true } : p
        )
      );
    });
  };

  /**
   * Upload photo to Supabase Storage and immediately update farmstand record.
   * Kept for backward compat — now calls uploadAndSavePhoto internally.
   * @deprecated use startOptimisticUpload instead
   */
  const _uploadAndSavePhotoLegacy = uploadAndSavePhoto;

  // ============ VIDEO MANAGEMENT ============

  const uploadAndSaveVideo = async (localUri: string, durationSeconds: number | null, mimeType: string): Promise<void> => {
    if (!farmstandId || !isSupabaseConfigured()) throw new Error('Not configured');
    await ensureSessionReady();

    const ext = mimeType === 'video/quicktime' ? 'mov' : 'mp4';
    const timestamp = Date.now();
    const storagePath = `${farmstandId}/${timestamp}-video.${ext}`;
    console.log('[VideoUpload] upload starting — bucket: farmstand-videos | path:', storagePath, '| mime:', mimeType, '| uri:', localUri.slice(0, 80));

    // Delete old video from storage if replacing
    if (farmstand?.videoPath) {
      deleteFromSupabaseStorage('farmstand-videos', farmstand.videoPath).catch(() => {});
    }

    const { error: uploadError } = await uploadToSupabaseStorage(
      'farmstand-videos',
      storagePath,
      localUri,
      mimeType
    );
    if (uploadError) {
      console.log('[VideoUpload] upload failed — code:', (uploadError as { code?: string }).code ?? 'n/a', '| message:', uploadError.message, '| details:', JSON.stringify(uploadError));
      throw new Error(uploadError.message || 'Video upload failed');
    }

    const publicUrl = getStoragePublicUrl('farmstand-videos', storagePath);
    console.log('[VideoUpload] upload success — publicUrl:', publicUrl, '| path:', storagePath);

    const dbPayload = { videoUrl: publicUrl, videoPath: storagePath, videoDurationSeconds: durationSeconds };
    console.log('[VideoUpload] database update starting —', JSON.stringify(dbPayload));

    try {
      await updateFarmstand(farmstandId, dbPayload);
      console.log('[VideoUpload] database update success');
    } catch (e) {
      console.log('[VideoUpload] database update failed — message:', e instanceof Error ? e.message : String(e), '| details:', JSON.stringify(e));
      throw e;
    }

    setFarmstand((prev) => prev ? { ...prev, videoUrl: publicUrl, videoPath: storagePath, videoDurationSeconds: durationSeconds } : prev);
    setLocalVideo({ uri: publicUrl, storagePath: storagePath, uploading: false, failed: false, isLocalPreview: false, durationSeconds });
    showToast('Video uploaded!', 'success');
  };

  const pickVideo = async () => {
    if (!isPremium) {
      if (__DEV__) console.log('[EditFarm] pickVideo blocked — not premium, premiumStatus:', farmstand?.premiumStatus);
      Alert.alert('Premium Required', 'Upgrade to Premium to add a video to your listing.');
      return;
    }
    if (__DEV__) console.log('[EditFarm] pickVideo opened — farmstandId:', farmstandId, 'isPremium:', isPremium);
    trackEvent('video_manager_opened', { farmstand_id: farmstandId ?? null, farmstand_name: farmstand?.name ?? null });

    const existing = await ImagePicker.getMediaLibraryPermissionsAsync();
    let granted = existing.status === 'granted';
    if (!granted) {
      if (!existing.canAskAgain) {
        Alert.alert('Permission Required', 'Please enable photo library access in Settings to add a video.');
        return;
      }
      const requested = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (requested.status !== 'granted') return;
      granted = true;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    if (__DEV__) console.log('[EditFarm] pickVideo launching image library picker');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
      quality: 0.3,
    });

    if (result.canceled || !result.assets[0]) {
      if (__DEV__) console.log('[EditFarm] pickVideo — picker cancelled or no asset');
      return;
    }
    const asset = result.assets[0];
    const durationMs = asset.duration ?? null;
    const assetMimeType = (asset as { mimeType?: string }).mimeType ?? 'video/mp4';
    const assetFileSize = (asset as { fileSize?: number }).fileSize ?? null;
    console.log('[VideoUpload] picker result — uri:', asset.uri.slice(0, 80), '| mimeType:', assetMimeType, '| durationMs:', durationMs, '| fileSize:', assetFileSize);

    if (durationMs !== null && durationMs > MAX_VIDEO_DURATION_SECONDS * 1000) {
      console.log('[VideoUpload] picker rejected — video too long:', durationMs, 'ms, max:', MAX_VIDEO_DURATION_SECONDS * 1000);
      Alert.alert('Video Too Long', `Video must be ${MAX_VIDEO_DURATION_SECONDS} seconds or less.`);
      return;
    }

    const durationSeconds = durationMs !== null ? Math.round(durationMs / 1000) : null;
    console.log('[VideoUpload] selected — uri:', asset.uri.slice(0, 80), '| type:', assetMimeType, '| durationSeconds:', durationSeconds, '| fileSize:', assetFileSize);

    // Optimistic preview — storagePath is null until upload completes
    setLocalVideo({ uri: asset.uri, storagePath: null, uploading: true, failed: false, isLocalPreview: true, durationSeconds });

    uploadAndSaveVideo(asset.uri, durationSeconds, assetMimeType)
      .then(() => {
        console.log('[VideoUpload] upload+save pipeline finished successfully');
      })
      .catch((err: unknown) => {
        console.log('[VideoUpload] upload+save pipeline failed —', err instanceof Error ? err.message : String(err));
        setLocalVideo((prev) => prev ? { ...prev, uploading: false, failed: true } : prev);
        showToast('Video upload failed. Please try again.', 'error');
      });
  };

  const removeVideo = async () => {
    if (!farmstandId) return;
    const oldPath = farmstand?.videoPath;
    if (__DEV__) console.log('[EditFarm] removeVideo — clearing video fields, oldPath:', oldPath ?? '(none)');
    setLocalVideo(null);
    await updateFarmstand(farmstandId, { videoUrl: null, videoPath: null, videoDurationSeconds: null });
    if (__DEV__) console.log('[EditFarm] removeVideo — updateFarmstand succeeded (video_url=null, video_path=null)');
    setFarmstand((prev) => prev ? { ...prev, videoUrl: null, videoPath: null, videoDurationSeconds: null } : prev);
    if (oldPath) deleteFromSupabaseStorage('farmstand-videos', oldPath).catch(() => {});
    showToast('Video removed.', 'success');
  };

  const pickImageFromLibrary = async () => {
    setShowPhotoOptions(false);

    // Check current permission status first to avoid launching the picker
    // while the iOS permission dialog is still being dismissed (causes double-open bug)
    const existing = await ImagePicker.getMediaLibraryPermissionsAsync();
    let granted = existing.status === 'granted';

    if (!granted) {
      if (!existing.canAskAgain) {
        Alert.alert('Permission Required', 'Please enable photo library access in Settings to add photos.');
        return;
      }
      const requested = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (requested.status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to your photo library.');
        return;
      }
      granted = true;
      // Give iOS time to fully dismiss the permission dialog before opening the picker
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      console.log('[EditListing] Image picked:', result.assets[0].uri);
      if (localPhotos.length >= photoLimit) {
        Alert.alert(
          'Photo Limit Reached',
          isPremium
            ? `You can upload up to ${PREMIUM_PHOTO_LIMIT} photos.`
            : `Free listings can have 1 photo. Upgrade to Premium to add up to ${PREMIUM_PHOTO_LIMIT} photos.`
        );
        return;
      }
      startOptimisticUpload(result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    setShowPhotoOptions(false);

    const existing = await ImagePicker.getCameraPermissionsAsync();
    let granted = existing.status === 'granted';

    if (!granted) {
      if (!existing.canAskAgain) {
        Alert.alert('Permission Required', 'Please enable camera access in Settings to take photos.');
        return;
      }
      const requested = await ImagePicker.requestCameraPermissionsAsync();
      if (requested.status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to your camera.');
        return;
      }
      granted = true;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      console.log('[EditListing] Photo taken:', result.assets[0].uri);
      if (localPhotos.length >= photoLimit) {
        Alert.alert(
          'Photo Limit Reached',
          isPremium
            ? `You can upload up to ${PREMIUM_PHOTO_LIMIT} photos.`
            : `Free listings can have 1 photo. Upgrade to Premium to add up to ${PREMIUM_PHOTO_LIMIT} photos.`
        );
        return;
      }
      startOptimisticUpload(result.assets[0].uri);
    }
  };

  // ============ VALIDATION ============

  const validateHours = (): { valid: boolean; error?: string } => {
    for (const day of DAYS) {
      const dayHours = hours[day.key];
      if (!dayHours.closed) {
        if (!dayHours.open || !dayHours.close) {
          return { valid: false, error: `${day.label}: Please set both open and close times` };
        }
        const openMinutes = timeToMinutes(dayHours.open);
        const closeMinutes = timeToMinutes(dayHours.close);
        if (closeMinutes <= openMinutes) {
          return { valid: false, error: `${day.label}: Close time must be later than open time` };
        }
      }
    }
    return { valid: true };
  };

  const prepareDay = (day: HoursDay): HoursDay => {
    if (day.closed) {
      return { open: null, close: null, closed: true };
    }
    return {
      open: day.open || '09:00',
      close: day.close || '17:00',
      closed: false,
    };
  };

  // ============ DELETE HANDLER ============

  const handleDeleteFarmstand = async () => {
    if (!farmstandId || !user?.id) return;

    setIsDeleting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // CRITICAL FIX: Check AuthProvider session first (most reliable in production builds)
    // Fall back to ensureSessionReady for race conditions
    let session = authSession;
    if (!session) {
      console.log('[EditListing] No session from AuthProvider, trying ensureSessionReady...');
      session = await ensureSessionReady();
    }

    if (!session) {
      setIsDeleting(false);
      setShowDeleteModal(false);
      showToast('Please sign in to continue', 'error');
      console.log('[EditListing] Delete failed: No valid session found');
      return;
    }

    console.log('[EditListing] Session verified, proceeding with delete');
    const result = await ownerDeleteFarmstand(farmstandId, user.id);

    setIsDeleting(false);
    setShowDeleteModal(false);

    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast('Farmstand deleted', 'success');
      // Navigate back to profile after a brief delay to show the toast
      setTimeout(() => {
        router.replace('/(tabs)/profile');
      }, 1000);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast(result.error || 'Failed to delete farmstand', 'error');
    }
  };

  // ============ SAVE HANDLER ============

  const handleSave = async () => {
    if (localVideo?.uploading === true) {
      Alert.alert('Upload In Progress', 'Please wait for the video to finish uploading before saving.');
      return;
    }

    if (!formData.name.trim()) {
      Alert.alert('Required', 'Please enter a farmstand name');
      return;
    }

    // Validate hours
    const validation = validateHours();
    if (!validation.valid) {
      Alert.alert('Invalid Hours', validation.error);
      return;
    }

    if (!farmstandId || !user?.id) return;

    setIsSaving(true);

    try {
      // Build seasonal dates if provided
      let seasonalDates: SeasonalDates | null = null;
      if (formData.seasonalStart && formData.seasonalEnd) {
        seasonalDates = {
          start_month: formData.seasonalStart.month,
          start_day: formData.seasonalStart.day,
          end_month: formData.seasonalEnd.month,
          end_day: formData.seasonalEnd.day,
        };
      }

      // Prepare hours for save
      const hoursToSave: HoursSchedule = {
        timezone: hours.timezone || 'America/Los_Angeles',
        mon: prepareDay(hours.mon),
        tue: prepareDay(hours.tue),
        wed: prepareDay(hours.wed),
        thu: prepareDay(hours.thu),
        fri: prepareDay(hours.fri),
        sat: prepareDay(hours.sat),
        sun: prepareDay(hours.sun),
      };

      // DEBUG: Log hours being saved
      console.log('[EditListing] Saving hours - isOpen24_7:', isOpen24_7);
      console.log('[EditListing] Saving hours - hoursToSave:', JSON.stringify(hoursToSave));

      // IMPORTANT: Only include editable fields - do NOT include these restricted fields:
      // - claimed_by, claimed_at, submitted_by (ownership - RLS will block)
      // - verified, verified_at, verification_status (admin-only)
      // - status, approval_status (admin-only)

      // Get valid photos (only http/https URLs)
      const validPhotos = formData.photos.filter((p) => p.startsWith('http'));

      // CRITICAL: Set hero_image_url based on the selected main photo
      // This ensures the public detail page shows the correct hero image
      const mainPhotoUrl = validPhotos[formData.mainPhotoIndex] ?? validPhotos[0] ?? null;

      const updates: Partial<Farmstand> = {
        name: formData.name.trim(),
        shortDescription: formData.shortDescription.trim() || formData.description.slice(0, 100),
        description: formData.description.trim(),
        // CRITICAL: Filter out local file:// URIs, only save http/https URLs
        // photos column is NOT NULL, so ensure we always save an array (empty [] if no valid URLs)
        photos: validPhotos,
        mainPhotoIndex: formData.mainPhotoIndex,
        // STANDARDIZED: hero_image_url is THE SINGLE SOURCE OF TRUTH for card/hero images
        // Always sync hero_image_url with the selected main photo
        heroImageUrl: mainPhotoUrl,
        phone: formData.phone.trim() || null,
        email: formData.email.trim() || null,
        operatingStatus: formData.operatingStatus,
        showOnMap: formData.showOnMap,
        addressLine1: formData.addressLine1.trim() || null,
        city: formData.city.trim() || null,
        state: formData.state || null,
        zip: formData.zip.trim() || null,
        latitude: formData.latitude ? parseFloat(formData.latitude) : null,
        longitude: formData.longitude ? parseFloat(formData.longitude) : null,
        seasonalNotes: formData.seasonalNotes.trim() || null,
        seasonalDates,
        paymentOptions: formData.paymentOptions,
        honorSystem: formData.honorSystem,
        selfServe: formData.selfServe,
        directionsNotes: formData.directionsNotes.trim() || null,
        parkingNotes: formData.parkingNotes.trim() || null,
        todaysNote: formData.todaysNote.trim() || null,
        hours: isOpen24_7 ? null : hoursToSave,
        isOpen24_7: isOpen24_7,
        offerings: [...selectedProductCategories, ...otherProductItems],
        otherProducts: otherProductItems,
      };

      // Video — always include in Save Changes so the DB stays in sync regardless
      // of whether the optimistic per-upload save succeeded.
      const isVideoReady =
        localVideo !== null &&
        !localVideo.isLocalPreview &&
        !localVideo.uploading &&
        !localVideo.failed;
      console.log('[VideoSave] pre-save video state — localVideo:', JSON.stringify(localVideo), '| isVideoReady:', isVideoReady, '| farmstand.videoUrl:', farmstand?.videoUrl, '| farmstand.videoPath:', farmstand?.videoPath);
      if (isVideoReady) {
        updates.videoUrl = localVideo!.uri;
        updates.videoPath = localVideo!.storagePath ?? farmstand?.videoPath ?? null;
        updates.videoDurationSeconds = localVideo!.durationSeconds;
        console.log('[VideoSave] Save includes uploaded video — videoUrl:', updates.videoUrl, '| videoPath:', updates.videoPath, '| duration:', updates.videoDurationSeconds);
      } else if (localVideo === null) {
        // No video (never set or explicitly removed)
        updates.videoUrl = null;
        updates.videoPath = null;
        updates.videoDurationSeconds = null;
        console.log('[VideoSave] Save — no video set, clearing video fields');
      } else {
        // Upload in progress or failed — omit video fields entirely so the RPC's
        // CASE WHEN p_updates ? 'video_url' THEN ... ELSE video_url END
        // preserves whatever is already in the DB instead of overwriting with null.
        console.log('[VideoSave] Save — upload in progress or failed; omitting video fields so DB keeps existing values');
      }

      // DEBUG: Log the hours and isOpen24_7 values being sent
      console.log('[EditListing] Updates object hours:', JSON.stringify(updates.hours));
      console.log('[EditListing] Updates object isOpen24_7:', updates.isOpen24_7);

      console.log('[EditListing] Setting heroImageUrl to main photo:', mainPhotoUrl);

      // Safety check: log what we're about to save for photos
      console.log('[EditListing] About to save photos array:', updates.photos);
      if (updates.photos && updates.photos.length > 0) {
        updates.photos.forEach((photo, idx) => {
          if (!photo.startsWith('http')) {
            console.error(`[EditListing] ⚠️ WARNING: photos[${idx}] is NOT a valid URL:`, photo);
          }
        });
      }

      // Log the update attempt
      console.log('[EditListing] Saving farmstand:', farmstandId);
      console.log('[EditListing] user.id:', user.id);
      console.log('[EditListing] Update fields:', Object.keys(updates).join(', '));

      // Log changes to edit history
      if (originalData) {
        const fieldsToTrack: (keyof FormData)[] = [
          'name', 'shortDescription', 'description', 'phone', 'email',
          'addressLine1', 'city', 'state', 'zip', 'operatingStatus', 'seasonalNotes',
          'honorSystem', 'selfServe', 'directionsNotes', 'parkingNotes', 'todaysNote'
        ];

        for (const field of fieldsToTrack) {
          const oldVal = originalData[field];
          const newVal = formData[field];
          if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
            await logEdit(
              farmstandId,
              field,
              oldVal != null ? String(oldVal) : null,
              newVal != null ? String(newVal) : null,
              user.id,
              'owner'
            );
          }
        }
      }

      // Log hours change
      if (originalHours && JSON.stringify(hoursToSave) !== JSON.stringify(originalHours)) {
        await logEdit(
          farmstandId,
          'hours',
          JSON.stringify(originalHours),
          JSON.stringify(hoursToSave),
          user.id,
          'owner'
        );
      }

      if (__DEV__) console.log('[VideoSave] payload sent to Supabase — videoUrl:', updates.videoUrl, '| videoPath:', updates.videoPath, '| videoDurationSeconds:', updates.videoDurationSeconds, '| videoKey present:', 'videoUrl' in updates);
      await updateFarmstand(farmstandId, updates);
      if (__DEV__) console.log('[VideoSave] updateFarmstand succeeded');

      // Re-fetch the farmstand from Supabase and update the store
      // This ensures the UI shows the latest data immediately
      const refreshed = await refreshSingleFarmstand(farmstandId);
      console.log('[VideoSave] refreshSingleFarmstand done');
      console.log('[VideoUpload] reloaded farmstand video fields (from DB) — videoUrl:', refreshed?.videoUrl ?? '(null)', '| videoPath:', refreshed?.videoPath ?? '(null)', '| videoDurationSeconds:', refreshed?.videoDurationSeconds ?? '(null)');

      // Log analytics event
      logFarmstandEdit(farmstandId, ['general'], user.id);

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', 'Your farmstand has been updated!', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error) {
      console.error('[EditListing] Save error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check for RLS permission error
      if (errorMessage.includes('403') || errorMessage.includes('401') || errorMessage.toLowerCase().includes('permission') || errorMessage.toLowerCase().includes('unauthorized')) {
        Alert.alert(
          'Permission Denied',
          "You don't have permission to edit this farmstand. Please log out and log in again, then try again.",
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Error', 'Failed to save changes. Please try again.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  // ============ RENDER ============

  // Show guard for guests - AFTER all hooks
  if (isGuestUser) {
    return <FarmerRouteGuard title="Edit Farmstand" />;
  }

  if (isLoading) {
    return (
      <View className="flex-1 bg-[#FAF7F2] items-center justify-center">
        <ActivityIndicator size="large" color="#2D5A3D" />
      </View>
    );
  }

  // Still waiting for ownership check — don't flash the pending screen
  if (canManage === null) {
    return (
      <View className="flex-1 bg-[#FAF7F2] items-center justify-center">
        <ActivityIndicator size="large" color="#2D5A3D" />
      </View>
    );
  }

  // Show "Claim pending approval" screen only after we've confirmed the user is NOT the owner
  if (!canManage) {
    return (
      <SafeAreaView className="flex-1 bg-[#FAF7F2]" edges={['top']}>
        <View className="flex-1 items-center justify-center px-8">
          <View className="w-16 h-16 rounded-full bg-amber-100 items-center justify-center mb-5">
            <AlertCircle size={32} color="#d97706" />
          </View>
          <Text className="text-xl font-bold text-gray-900 text-center mb-2">
            Claim Pending Approval
          </Text>
          <Text className="text-base text-gray-500 text-center leading-6 mb-8">
            You'll be able to edit this Farmstand once an admin approves your claim request.
          </Text>
          <Pressable
            onPress={() => router.back()}
            className="bg-[#2D5A3D] rounded-2xl px-8 py-3.5"
          >
            <Text className="text-white font-semibold text-base">Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const mainPhoto = formData.photos[formData.mainPhotoIndex] || formData.photos[0];

  if (__DEV__) console.log('[EditFarm] render — farmstandId:', farmstandId, '| premiumStatus:', farmstand?.premiumStatus, '| isPremium:', isPremium, '| localVideo:', localVideo ? `uri=${localVideo.uri.slice(0, 60)} uploading=${localVideo.uploading}` : null, '| farmstand.videoUrl:', farmstand?.videoUrl ?? null);

  return (
    <View className="flex-1 bg-[#F5F3EE]">
      {/* Hero Image Header */}
      <View style={{ height: 200 }}>
        {mainPhoto ? (
          <Image source={{ uri: mainPhoto }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <View className="w-full h-full bg-gray-200 items-center justify-center">
            <ImageIcon size={48} color="#9ca3af" />
            <Text className="text-gray-400 text-sm mt-2">No photos yet</Text>
          </View>
        )}

        {/* Floating Back Button */}
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={{
            position: 'absolute',
            top: insets.top + 12,
            left: 16,
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: '#FFFFFF',
            justifyContent: 'center',
            alignItems: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.15,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: 4,
            zIndex: 10,
          }}
        >
          <ArrowLeft size={20} color="#1F1F1F" />
        </Pressable>
      </View>

      {/* Farmstand Name Card */}
      <View className="mx-4 -mt-6 bg-white rounded-2xl p-4 shadow-sm" style={{ zIndex: 1 }}>
        <Text className="text-lg font-semibold text-gray-900" numberOfLines={1}>
          {formData.name || 'Your Farmstand Name'}
        </Text>
        <Text className="text-sm text-gray-500 mt-0.5" numberOfLines={1}>
          {formData.city && formData.state
            ? `${formData.city}, ${formData.state}`
            : 'Add your location below'}
        </Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 120, paddingTop: 16 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* Section 1: Basics */}
          <Section
            icon={<FileText size={18} color="#2D5A3D" />}
            title="Basics"
            subtitle="Your farmstand name and description"
            delay={50}
          >
            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-1">Name *</Text>
              <Text className="text-xs text-gray-500 mb-2">What customers will see when they find you</Text>
              <TextInput
                value={formData.name}
                onChangeText={(v) => updateField('name', v)}
                placeholder="e.g., Sunny Acres Farm Stand"
                placeholderTextColor="#9ca3af"
                className="bg-gray-50 rounded-xl px-4 py-3 text-base text-gray-900 border border-gray-200"
              />
            </View>

            <View>
              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-sm font-medium text-gray-700">About</Text>
                <Text className="text-xs text-gray-400">{formData.description.length}/500</Text>
              </View>
              <Text className="text-xs text-gray-500 mb-2">Tell visitors your story - what you grow, your farming practices, etc.</Text>
              <TextInput
                value={formData.description}
                onChangeText={(v) => updateField('description', v.slice(0, 500))}
                placeholder="Share your story with visitors..."
                placeholderTextColor="#9ca3af"
                multiline
                numberOfLines={4}
                maxLength={500}
                textAlignVertical="top"
                className="bg-gray-50 rounded-xl px-4 py-3 text-base text-gray-900 min-h-[100px] border border-gray-200"
              />
            </View>
          </Section>

          {/* Section 1b: Product Categories */}
          <Section
            icon={<Check size={18} color="#2D5A3D" />}
            title="Product Categories"
            subtitle="Select all that apply"
            delay={75}
          >
            <View className="flex-row flex-wrap">
              {PRODUCT_CATEGORIES.map((category, index) => {
                const isSelected = selectedProductCategories.includes(category);
                return (
                  <Animated.View
                    key={category}
                    entering={FadeInUp.delay(index * 30).springify()}
                  >
                    <Pressable
                      onPress={() => toggleProductCategory(category)}
                      className={`px-4 py-3 rounded-full mr-2 mb-3 border-2 ${
                        isSelected ? 'bg-forest border-forest' : 'bg-white border-gray-200'
                      }`}
                      style={{
                        shadowColor: isSelected ? '#2D5A3D' : 'transparent',
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: isSelected ? 0.2 : 0,
                        shadowRadius: 4,
                        elevation: isSelected ? 3 : 0,
                      }}
                    >
                      <View className="flex-row items-center">
                        {isSelected && (
                          <Check size={14} color="#FDF8F3" style={{ marginRight: 6 }} />
                        )}
                        <Text className={`font-medium ${isSelected ? 'text-white' : 'text-gray-800'}`}>
                          {category}
                        </Text>
                      </View>
                    </Pressable>
                  </Animated.View>
                );
              })}
            </View>
          </Section>

          {/* Section 1c: Other Products */}
          <Section
            icon={<Plus size={18} color="#2D5A3D" />}
            title="Other Products"
            subtitle="Add individual items not in categories above"
            delay={90}
          >
            <View className="flex-row items-center mb-3">
              <TextInput
                className="flex-1 bg-gray-50 rounded-xl px-4 py-3 text-gray-900 border border-gray-200 text-base"
                value={otherProductInput}
                onChangeText={setOtherProductInput}
                placeholder="e.g., Maple Syrup"
                placeholderTextColor="#9ca3af"
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={addOtherProductItem}
              />
              <Pressable
                onPress={addOtherProductItem}
                disabled={!otherProductInput.trim()}
                className={`ml-3 w-12 h-12 rounded-xl items-center justify-center ${
                  otherProductInput.trim() ? 'bg-forest' : 'bg-gray-100'
                }`}
                style={{
                  shadowColor: otherProductInput.trim() ? '#2D5A3D' : 'transparent',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: otherProductInput.trim() ? 0.2 : 0,
                  shadowRadius: 4,
                  elevation: otherProductInput.trim() ? 3 : 0,
                }}
              >
                <Plus size={22} color={otherProductInput.trim() ? '#ffffff' : '#9ca3af'} />
              </Pressable>
            </View>
            {(otherProductItems || []).length > 0 && (
              <View className="flex-row flex-wrap mt-1">
                {(otherProductItems || []).map((product, index) => (
                  <Animated.View
                    key={`${product}-${index}`}
                    entering={FadeInUp.delay(index * 30).springify()}
                  >
                    <Pressable
                      onPress={() => removeOtherProductItem(product)}
                      className="flex-row items-center px-4 py-2.5 rounded-full mr-2 mb-2 bg-red-50 border border-red-200"
                    >
                      <Text className="text-red-700 font-medium mr-2">{product}</Text>
                      <X size={14} color="#b91c1c" />
                    </Pressable>
                  </Animated.View>
                ))}
              </View>
            )}
          </Section>

          {/* Section 2: Photos */}
          <Section
            icon={<ImageIcon size={18} color="#2D5A3D" />}
            title="Photos"
            subtitle={photoSubtitle}
            delay={100}
          >
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginHorizontal: -8 }}>
              {localPhotos.map((photo, index) => (
                <Animated.View key={photo.id} entering={FadeIn.delay(index * 50)} className="mx-1.5 relative">
                  <Pressable onPress={() => !photo.isLocalPreview && setAsMainPhoto(photo.id)}>
                    <Image
                      source={{ uri: photo.uri }}
                      className="w-24 h-24 rounded-xl"
                      resizeMode="cover"
                      style={photo.uploading || photo.failed ? { opacity: 0.6 } : undefined}
                    />
                    {/* Main photo badge — only for confirmed remote photos */}
                    {!photo.isLocalPreview && photo.id === formData.photos[formData.mainPhotoIndex] && (
                      <>
                        <View className="absolute bottom-1 left-1 right-1 bg-[#2D5A3D]/90 rounded-lg py-0.5 px-2 flex-row items-center justify-center">
                          <Star size={10} color="#ffffff" fill="#ffffff" />
                          <Text className="text-white text-[10px] font-semibold ml-0.5">Main</Text>
                        </View>
                        <View className="absolute inset-0 rounded-xl" style={{ borderWidth: 2, borderColor: '#2D5A3D' }} />
                      </>
                    )}
                    {/* Uploading overlay */}
                    {photo.uploading && (
                      <View className="absolute inset-0 rounded-xl items-center justify-center bg-black/30">
                        <ActivityIndicator size="small" color="#ffffff" />
                        <Text className="text-white text-[9px] mt-1 font-semibold">Uploading</Text>
                      </View>
                    )}
                    {/* Failed overlay */}
                    {photo.failed && (
                      <View className="absolute inset-0 rounded-xl items-center justify-center bg-red-900/50">
                        <Pressable
                          onPress={() => retryPhoto(photo)}
                          className="items-center"
                          hitSlop={8}
                        >
                          <RefreshCw size={18} color="#ffffff" />
                          <Text className="text-white text-[9px] mt-0.5 font-semibold">Retry</Text>
                        </Pressable>
                      </View>
                    )}
                  </Pressable>
                  {/* Remove button — hidden while uploading */}
                  {!photo.uploading && (
                    <Pressable
                      onPress={() => removePhoto(photo.id)}
                      className="absolute top-1.5 right-1.5 w-6 h-6 bg-red-500 rounded-full items-center justify-center shadow-sm"
                    >
                      <X size={14} color="#ffffff" />
                    </Pressable>
                  )}
                </Animated.View>
              ))}
              {localPhotos.length < photoLimit && (
                <Pressable
                  onPress={addPhoto}
                  className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-300 items-center justify-center bg-gray-50 mx-1.5"
                >
                  <ImagePlus size={24} color="#6b7280" />
                  <Text className="text-gray-500 text-[10px] mt-1 font-medium">Add</Text>
                </Pressable>
              )}
            </ScrollView>
            <Text className="text-xs text-gray-400 mt-3">Tap a photo to set it as the main display image</Text>
          </Section>

          {/* Section 2b: Video (Premium) */}
          <Section
            icon={<Video size={18} color="#2D5A3D" />}
            title="Video (Premium)"
            subtitle={isPremium ? 'Add 1 video up to 30 seconds' : 'Available on Premium plan'}
            delay={150}
          >
            {!isPremium ? (
              <View className="flex-row items-center bg-amber-50 rounded-xl p-3 border border-amber-200">
                <Video size={16} color="#D97706" />
                <Text className="text-amber-700 text-sm ml-2 flex-1">Upgrade to Premium to add a video to your listing.</Text>
              </View>
            ) : localVideo ? (
              <View>
                {/* Video preview card */}
                <View className="w-24 h-24 rounded-xl overflow-hidden bg-gray-900 mx-1.5 relative">
                  {/* Video thumbnail (first frame) */}
                  <VideoThumbnailView uri={localVideo.uri} />
                  {/* Play icon overlay */}
                  <View className="absolute inset-0 items-center justify-center">
                    <View className="w-10 h-10 rounded-full bg-white/80 items-center justify-center">
                      <Play size={18} color="#1C1C1E" fill="#1C1C1E" />
                    </View>
                  </View>
                  {/* Duration badge */}
                  {localVideo.durationSeconds !== null && (
                    <View className="absolute bottom-1 right-1 bg-black/60 rounded px-1 py-0.5">
                      <Text className="text-white text-[9px] font-semibold">
                        {localVideo.durationSeconds}s
                      </Text>
                    </View>
                  )}
                  {/* Uploading overlay */}
                  {localVideo.uploading && (
                    <View className="absolute inset-0 bg-black/50 items-center justify-center rounded-xl">
                      <ActivityIndicator size="small" color="#ffffff" />
                      <Text className="text-white text-[9px] mt-1 font-semibold">Uploading</Text>
                    </View>
                  )}
                  {/* Failed overlay */}
                  {localVideo.failed && (
                    <View className="absolute inset-0 bg-red-900/60 items-center justify-center rounded-xl">
                      <AlertCircle size={16} color="#ffffff" />
                      <Text className="text-white text-[9px] mt-0.5 font-semibold">Failed</Text>
                    </View>
                  )}
                </View>
                {/* Replace / Remove buttons */}
                {!localVideo.uploading && (
                  <View className="flex-row mt-3 gap-2">
                    <Pressable
                      onPress={pickVideo}
                      className="flex-row items-center bg-forest/10 rounded-xl px-3 py-2"
                    >
                      <Video size={14} color="#2D5A3D" />
                      <Text className="text-forest text-xs font-semibold ml-1.5">Replace Video</Text>
                    </Pressable>
                    <Pressable
                      onPress={removeVideo}
                      className="flex-row items-center bg-red-50 rounded-xl px-3 py-2"
                    >
                      <Trash2 size={14} color="#DC2626" />
                      <Text className="text-red-600 text-xs font-semibold ml-1.5">Remove</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ) : (
              <Pressable
                onPress={pickVideo}
                className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-300 items-center justify-center bg-gray-50 mx-1.5"
              >
                <Video size={24} color="#6b7280" />
                <Text className="text-gray-500 text-[10px] mt-1 font-medium">Add Video</Text>
              </Pressable>
            )}
          </Section>

          {/* Section 3: Contact */}
          <Section
            icon={<Phone size={18} color="#2D5A3D" />}
            title="Contact"
            subtitle="How customers can reach you"
            delay={150}
          >
            <View className="mb-4">
              <View className="flex-row items-center mb-2">
                <Phone size={14} color="#6b7280" />
                <Text className="text-sm font-medium text-gray-700 ml-2">Phone</Text>
              </View>
              <TextInput
                value={formatPhoneNumber(formData.phone)}
                onChangeText={(v) => {
                  const digits = getPhoneDigits(v);
                  updateField('phone', digits);
                }}
                placeholder="(503) 555-1234"
                placeholderTextColor="#9ca3af"
                keyboardType="phone-pad"
                maxLength={14}
                className="bg-gray-50 rounded-xl px-4 py-3 text-base text-gray-900 border border-gray-200"
              />
            </View>

            <View className="mb-4">
              <View className="flex-row items-center mb-2">
                <Mail size={14} color="#6b7280" />
                <Text className="text-sm font-medium text-gray-700 ml-2">Email</Text>
              </View>
              <TextInput
                value={formData.email}
                onChangeText={(v) => updateField('email', v)}
                placeholder="contact@farmstand.com"
                placeholderTextColor="#9ca3af"
                keyboardType="email-address"
                autoCapitalize="none"
                className="bg-gray-50 rounded-xl px-4 py-3 text-base text-gray-900 border border-gray-200"
              />
            </View>
          </Section>

          {/* Section 4: Hours */}
          <Section
            icon={<Clock size={18} color="#2D5A3D" />}
            title="Hours"
            subtitle="When are you open for visitors?"
            delay={200}
          >
            {/* 24/7 Toggle */}
            <View className="flex-row items-center justify-between mb-4 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <View className="flex-1 mr-3">
                <Text className="text-green-800 font-medium">Open 24 hours</Text>
                <Text className="text-green-600 text-xs">Always open for visitors</Text>
              </View>
              <Switch
                value={isOpen24_7}
                onValueChange={(value) => {
                  setIsOpen24_7(value);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                trackColor={{ false: '#d1d5db', true: '#86efac' }}
                thumbColor={isOpen24_7 ? '#16a34a' : '#9ca3af'}
              />
            </View>

            {/* Quick Actions - only show when not 24/7 */}
            {!isOpen24_7 && (
              <>
                <View className="flex-row mb-4">
                  <Pressable
                    onPress={setWeekdayWeekendHours}
                    className="flex-1 bg-gray-50 border border-gray-200 rounded-xl py-2.5 mr-2 items-center"
                  >
                    <Text className="text-gray-700 font-medium text-xs">Standard Week</Text>
                    <Text className="text-gray-400 text-[10px]">9-5 weekdays</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      const sourceHours = hours.mon;
                      setHours((prev) => {
                        const updated = { ...prev };
                        DAYS.forEach((d) => {
                          updated[d.key] = { ...sourceHours };
                        });
                        return updated;
                      });
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    }}
                    className="flex-1 bg-gray-50 border border-gray-200 rounded-xl py-2.5 ml-2 items-center"
                  >
                    <Text className="text-gray-700 font-medium text-xs">Copy Monday</Text>
                    <Text className="text-gray-400 text-[10px]">Apply to all</Text>
                  </Pressable>
                </View>

                {/* Weekly Schedule */}
                <View className="bg-gray-50 rounded-xl px-3 border border-gray-200">
                  {DAYS.map((day) => (
                    <DayHoursRow
                      key={day.key}
                      dayKey={day.key}
                      label={day.short}
                      hours={hours[day.key]}
                      onOpenChange={(time) => updateDayHours(day.key, 'open', time)}
                      onCloseChange={(time) => updateDayHours(day.key, 'close', time)}
                      onClosedToggle={(closed) => updateDayHours(day.key, 'closed', closed)}
                    />
                  ))}
                </View>
              </>
            )}
          </Section>

          {/* Section 5: Location */}
          <Section
            icon={<MapPin size={18} color="#2D5A3D" />}
            title="Location"
            subtitle="Where customers can find you"
            delay={250}
          >
            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-1">Street Address</Text>
              <Text className="text-xs text-gray-500 mb-2">Optional — use "Locate on Map" button below to set exact location</Text>
              <TextInput
                value={formData.addressLine1}
                onChangeText={handleAddressChange}
                placeholder="123 Main Street"
                placeholderTextColor="#9ca3af"
                className="bg-gray-50 rounded-xl px-4 py-3 text-base text-gray-900 border border-gray-200"
                textContentType="streetAddressLine1"
                autoComplete="street-address"
              />
            </View>

            <View className="flex-row mb-4">
              <View className="flex-1 mr-2">
                <Text className="text-sm font-medium text-gray-700 mb-1">City</Text>
                <Text className="text-xs text-gray-500 mb-1">Enter city and state to auto-fill ZIP</Text>
                <TextInput
                  value={formData.city}
                  onChangeText={handleCityChange}
                  placeholder="City"
                  placeholderTextColor="#9ca3af"
                  className="bg-gray-50 rounded-xl px-4 py-3 text-base text-gray-900 border border-gray-200"
                  textContentType="addressCity"
                />
              </View>
              <View className="w-16 mr-2">
                <Text className="text-sm font-medium text-gray-700 mb-1">State</Text>
                <Text className="text-xs text-gray-500 mb-1"> </Text>
                <TextInput
                  value={formData.state}
                  onChangeText={handleStateChange}
                  placeholder="OR"
                  placeholderTextColor="#9ca3af"
                  maxLength={2}
                  autoCapitalize="characters"
                  className="bg-gray-50 rounded-xl px-4 py-3 text-base text-gray-900 border border-gray-200"
                  textContentType="addressState"
                />
              </View>
              <View className="w-20">
                <Text className="text-sm font-medium text-gray-700 mb-1">ZIP</Text>
                <Text className="text-xs text-gray-500 mb-1"> </Text>
                <TextInput
                  value={formData.zip}
                  onChangeText={(v) => updateField('zip', v)}
                  placeholder="97XXX"
                  placeholderTextColor="#9ca3af"
                  keyboardType="numeric"
                  maxLength={5}
                  className="bg-gray-50 rounded-xl px-4 py-3 text-base text-gray-900 border border-gray-200"
                  textContentType="postalCode"
                />
              </View>
            </View>

            {/* GPS Coordinates Status */}
            <View className="bg-gray-50 rounded-xl p-3 mb-4 border border-gray-200">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-medium text-gray-700">GPS Coordinates</Text>
              </View>
              {formData.latitude && formData.longitude &&
               !isDefaultCoordinates(parseFloat(formData.latitude), parseFloat(formData.longitude)) ? (
                <View className="mt-1">
                  <Text className="text-[#2D5A3D] text-sm font-medium">
                    {formData.latitude}, {formData.longitude}
                  </Text>
                  <Text className="text-gray-400 text-xs mt-0.5">Location verified via map</Text>
                </View>
              ) : (
                <Text className="text-gray-400 text-sm mt-1">Use "Locate on Map" or drag the pin to set location</Text>
              )}
            </View>

          </Section>

          {/* Section 6: Payments */}
          <Section
            icon={<CreditCard size={18} color="#2D5A3D" />}
            title="Payments"
            subtitle="What payment methods do you accept?"
            delay={300}
          >
            <View className="flex-row flex-wrap -m-1">
              {PAYMENT_OPTIONS.map((option) => {
                const isSelected = formData.paymentOptions.includes(option.id);
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => togglePayment(option.id)}
                    className={`px-3 py-2 rounded-full m-1 border ${isSelected ? 'bg-[#2D5A3D] border-[#2D5A3D]' : 'bg-gray-50 border-gray-200'}`}
                  >
                    <Text className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-gray-600'}`}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

          </Section>

          {/* Section 7: Visibility */}
          <Section
            icon={<Eye size={18} color="#2D5A3D" />}
            title="Visibility"
            subtitle="Control how your listing appears"
            delay={350}
          >
            {/* Operating Status */}
            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-2">Operating Status</Text>
              <Pressable
                onPress={() => setShowStatusModal(true)}
                className="flex-row items-center justify-between bg-gray-50 rounded-xl px-4 py-3 border border-gray-200"
              >
                <View className="flex-row items-center">
                  <View
                    className="w-3 h-3 rounded-full mr-3"
                    style={{ backgroundColor: OPERATIONAL_STATUS_OPTIONS.find((s) => s.id === formData.operatingStatus)?.color }}
                  />
                  <Text className="text-base text-gray-900">
                    {OPERATIONAL_STATUS_OPTIONS.find((s) => s.id === formData.operatingStatus)?.label}
                  </Text>
                </View>
                <ChevronDown size={20} color="#6b7280" />
              </Pressable>
            </View>

            {/* Seasonal Dates (if seasonal) */}
            {formData.operatingStatus === 'seasonal' && (
              <Pressable
                onPress={() => setShowSeasonalModal(true)}
                className="flex-row items-center justify-between bg-blue-50 rounded-xl px-4 py-3 border border-blue-200 mb-4"
              >
                <View className="flex-row items-center">
                  <Calendar size={18} color="#3b82f6" />
                  <Text className="text-blue-700 font-medium ml-2">
                    {formData.seasonalStart && formData.seasonalEnd
                      ? `${MONTHS[formData.seasonalStart.month - 1]} - ${MONTHS[formData.seasonalEnd.month - 1]}`
                      : 'Set seasonal dates'}
                  </Text>
                </View>
                <ChevronDown size={20} color="#3b82f6" />
              </Pressable>
            )}

            {/* Show on Map Toggle */}
            <View className="flex-row items-center justify-between pt-4 border-t border-gray-100">
              <View className="flex-1 mr-4">
                <Text className="text-sm font-medium text-gray-700">Show on Public Map</Text>
                <Text className="text-xs text-gray-500">When off, your listing is hidden from search</Text>
              </View>
              <Switch
                value={formData.showOnMap}
                onValueChange={(v) => updateField('showOnMap', v)}
                trackColor={{ false: '#d1d5db', true: '#86efac' }}
                thumbColor={formData.showOnMap ? '#16a34a' : '#9ca3af'}
              />
            </View>
          </Section>

          {/* Delete Farmstand - only show for owners */}
          {isOwner && (
            <View className="mt-6 mb-4 px-1">
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setShowDeleteModal(true);
                }}
                className="py-4 rounded-xl items-center justify-center flex-row"
                style={{ backgroundColor: '#FEE2E2' }}
              >
                <Trash2 size={18} color="#DC2626" />
                <Text className="font-semibold ml-2" style={{ color: '#DC2626' }}>
                  Delete Farmstand
                </Text>
              </Pressable>
            </View>
          )}

          <View className="h-8" />

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Sticky Save Button */}
      <View
        style={{
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 16,
        }}
      >
        <SafeAreaView edges={['bottom']}>
          <Pressable
            onPress={handleSave}
            disabled={isSaving || localVideo?.uploading === true}
            style={{
              height: 54,
              borderRadius: 14,
              backgroundColor: (isSaving || localVideo?.uploading === true) ? 'rgba(31, 107, 78, 0.6)' : '#1F6B4E',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              shadowColor: '#000',
              shadowOpacity: 0.15,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 6 },
              elevation: 4,
            }}
          >
            {isSaving ? (
              <>
                <ActivityIndicator size="small" color="white" />
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700', marginLeft: 8 }}>Saving...</Text>
              </>
            ) : (
              <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>Save Changes</Text>
            )}
          </Pressable>
        </SafeAreaView>
      </View>

      {/* Toast notification */}
      {toastMessage && (
        <Animated.View
          entering={FadeInDown.duration(200)}
          className={`absolute top-16 left-5 right-5 z-50 rounded-2xl px-5 py-4 flex-row items-center ${
            toastMessage.type === 'success' ? 'bg-green-600' : 'bg-red-600'
          }`}
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 8,
            elevation: 8,
          }}
        >
          {toastMessage.type === 'success' ? (
            <Check size={20} color="white" />
          ) : (
            <AlertCircle size={20} color="white" />
          )}
          <Text className="text-white font-medium ml-3 flex-1">{toastMessage.text}</Text>
        </Animated.View>
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <View className="flex-1 justify-center items-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View
            className="mx-6 rounded-2xl p-6"
            style={{
              backgroundColor: '#FFFFFF',
              width: '85%',
              maxWidth: 340,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.25,
              shadowRadius: 16,
              elevation: 10,
            }}
          >
            <View className="items-center mb-4">
              <View className="w-14 h-14 rounded-full items-center justify-center mb-3" style={{ backgroundColor: '#FEE2E2' }}>
                <Trash2 size={28} color="#DC2626" />
              </View>
              <Text className="text-xl font-bold text-center" style={{ color: '#1C1917' }}>
                Delete Farmstand?
              </Text>
              <Text className="text-center mt-2" style={{ color: '#78716C' }}>
                This will remove your farmstand from the map and search. This action cannot be undone.
              </Text>
            </View>

            <View style={{ gap: 12 }}>
              <Pressable
                onPress={handleDeleteFarmstand}
                disabled={isDeleting}
                className="py-3.5 rounded-xl items-center justify-center"
                style={{ backgroundColor: '#DC2626', opacity: isDeleting ? 0.6 : 1 }}
              >
                {isDeleting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text className="text-white font-semibold">Delete</Text>
                )}
              </Pressable>
              <Pressable
                onPress={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                className="py-3.5 rounded-xl items-center justify-center"
                style={{ backgroundColor: '#F5F5F4' }}
              >
                <Text className="font-semibold" style={{ color: '#44403C' }}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Photo Options Modal */}
      <Modal visible={showPhotoOptions} transparent animationType="fade" onRequestClose={() => setShowPhotoOptions(false)}>
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setShowPhotoOptions(false)}>
          <Animated.View entering={FadeInDown.duration(200)} className="bg-white rounded-t-3xl pt-2 pb-8">
            <View className="w-10 h-1 bg-gray-300 rounded-full self-center mb-4" />
            <Text className="text-gray-900 font-bold text-lg px-5 mb-4">Add Photo</Text>

            <Pressable onPress={takePhoto} className="flex-row items-center px-5 py-4 active:bg-gray-50">
              <View className="w-10 h-10 bg-green-100 rounded-full items-center justify-center">
                <Camera size={20} color="#16a34a" />
              </View>
              <View className="ml-4">
                <Text className="text-gray-900 font-semibold">Take Photo</Text>
                <Text className="text-gray-500 text-sm">Use your camera</Text>
              </View>
            </Pressable>

            <Pressable onPress={pickImageFromLibrary} className="flex-row items-center px-5 py-4 active:bg-gray-50">
              <View className="w-10 h-10 bg-green-100 rounded-full items-center justify-center">
                <ImagePlus size={20} color="#16a34a" />
              </View>
              <View className="ml-4">
                <Text className="text-gray-900 font-semibold">Choose from Library</Text>
                <Text className="text-gray-500 text-sm">Select an existing photo</Text>
              </View>
            </Pressable>

            <Pressable onPress={() => setShowPhotoOptions(false)} className="mx-5 mt-4 py-3 bg-gray-100 rounded-xl items-center">
              <Text className="text-gray-600 font-semibold">Cancel</Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>

      {/* Status Selection Modal */}
      <Modal visible={showStatusModal} transparent animationType="fade" onRequestClose={() => setShowStatusModal(false)}>
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setShowStatusModal(false)}>
          <Animated.View entering={FadeInDown.duration(200)} className="bg-white rounded-t-3xl pt-2 pb-8">
            <View className="w-10 h-1 bg-gray-300 rounded-full self-center mb-4" />
            <Text className="text-lg font-semibold text-gray-900 px-5 mb-3">Operating Status</Text>

            {OPERATIONAL_STATUS_OPTIONS.map((option) => (
              <Pressable
                key={option.id}
                onPress={() => {
                  updateField('operatingStatus', option.id);
                  setShowStatusModal(false);
                }}
                className="flex-row items-center px-5 py-4 active:bg-gray-50"
              >
                <View className="w-4 h-4 rounded-full mr-4" style={{ backgroundColor: option.color }} />
                <Text className="text-base text-gray-700 flex-1">{option.label}</Text>
                {formData.operatingStatus === option.id && (
                  <View className="w-6 h-6 bg-[#2D5A3D] rounded-full items-center justify-center">
                    <CheckCircle size={14} color="white" />
                  </View>
                )}
              </Pressable>
            ))}

            <Pressable onPress={() => setShowStatusModal(false)} className="mx-5 mt-2 py-3 bg-gray-100 rounded-xl items-center">
              <Text className="text-base font-medium text-gray-600">Cancel</Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>

      {/* Seasonal Dates Modal */}
      <Modal visible={showSeasonalModal} transparent animationType="fade" onRequestClose={() => setShowSeasonalModal(false)}>
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setShowSeasonalModal(false)}>
          <Animated.View entering={FadeInDown.duration(200)} className="bg-white rounded-t-3xl pt-2 pb-8">
            <View className="w-10 h-1 bg-gray-300 rounded-full self-center mb-4" />
            <Text className="text-lg font-semibold text-gray-900 px-5 mb-4">Seasonal Operating Dates</Text>

            <View className="px-5 mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-2">Season Opens</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
                {MONTHS.map((month, index) => (
                  <Pressable
                    key={month}
                    onPress={() => updateField('seasonalStart', { month: index + 1, day: formData.seasonalStart?.day || 1 })}
                    className={`px-3 py-2 mr-2 rounded-full ${
                      formData.seasonalStart?.month === index + 1 ? 'bg-[#2D5A3D]' : 'bg-gray-100'
                    }`}
                  >
                    <Text className={formData.seasonalStart?.month === index + 1 ? 'text-white font-medium' : 'text-gray-600'}>
                      {month.slice(0, 3)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>

            <View className="px-5 mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-2">Season Closes</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
                {MONTHS.map((month, index) => (
                  <Pressable
                    key={month}
                    onPress={() => updateField('seasonalEnd', { month: index + 1, day: formData.seasonalEnd?.day || 1 })}
                    className={`px-3 py-2 mr-2 rounded-full ${
                      formData.seasonalEnd?.month === index + 1 ? 'bg-[#2D5A3D]' : 'bg-gray-100'
                    }`}
                  >
                    <Text className={formData.seasonalEnd?.month === index + 1 ? 'text-white font-medium' : 'text-gray-600'}>
                      {month.slice(0, 3)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>

            <Pressable
              onPress={() => setShowSeasonalModal(false)}
              className="mx-5 mt-2 py-3 bg-[#2D5A3D] rounded-xl items-center"
            >
              <Text className="text-white font-semibold">Done</Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>
    </View>
  );
}
