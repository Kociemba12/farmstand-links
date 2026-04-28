import React, { useCallback, useState, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Alert,
  Modal,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import MapView, { Marker, Region, MapPressEvent } from 'react-native-maps';
import {
  ArrowLeft,
  MapPin,
  Check,
  X,
  MessageSquare,
  MapPinned,
  Navigation,
  Crosshair,
  Move,
  ZoomIn,
  Locate,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { AdminGuard } from '@/components/AdminGuard';
import { useAdminStore } from '@/lib/admin-store';
import { Farmstand } from '@/lib/farmer-store';
import { FarmstandPinMarker } from '@/components/FarmstandPinMarker';

const BG_COLOR = '#FAF7F2';
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Oregon default region
const DEFAULT_REGION: Region = {
  latitude: 44.0,
  longitude: -120.5,
  latitudeDelta: 4,
  longitudeDelta: 4,
};

interface ApproxLocationCardProps {
  farmstand: Farmstand;
  onConfirm: () => void;
  onKeepApprox: () => void;
  onRequestInfo: () => void;
  onReject: () => void;
  onAdjustPin: () => void;
}

function ApproxLocationCard({
  farmstand,
  onConfirm,
  onKeepApprox,
  onRequestInfo,
  onReject,
  onAdjustPin,
}: ApproxLocationCardProps) {
  const mapRef = useRef<MapView>(null);
  const [isMapExpanded, setIsMapExpanded] = useState(false);

  const mapRegion: Region = {
    latitude: farmstand.latitude ?? 44.0,
    longitude: farmstand.longitude ?? -120.5,
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  };

  const handleRecenter = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (mapRef.current && farmstand.latitude && farmstand.longitude) {
      mapRef.current.animateToRegion({
        latitude: farmstand.latitude,
        longitude: farmstand.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      }, 500);
    }
  };

  return (
    <Animated.View entering={FadeInDown.duration(400)} style={styles.card}>
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderIcon}>
          <MapPinned size={20} color="#0891b2" />
        </View>
        <View style={styles.cardHeaderContent}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {farmstand.name}
          </Text>
          <Text style={styles.cardSubtitle}>
            {farmstand.locationPrecision === 'approximate_manual'
              ? 'Manual pin placement'
              : 'Auto-geocoded location'}
          </Text>
        </View>
      </View>

      {/* Approximate Location Text */}
      {farmstand.approxLocationText && (
        <View style={styles.approxTextContainer}>
          <Text style={styles.approxTextLabel}>Location description:</Text>
          <Text style={styles.approxTextValue}>{farmstand.approxLocationText}</Text>
        </View>
      )}

      {/* City/State */}
      {farmstand.optionalNearestCityState && (
        <View style={styles.approxTextContainer}>
          <Text style={styles.approxTextLabel}>Nearest city:</Text>
          <Text style={styles.approxTextValue}>{farmstand.optionalNearestCityState}</Text>
        </View>
      )}

      {/* Confidence Score */}
      {farmstand.geocodeConfidence !== null && (
        <View style={styles.confidenceRow}>
          <Text style={styles.confidenceLabel}>Geocode confidence:</Text>
          <View
            style={[
              styles.confidenceBadge,
              {
                backgroundColor:
                  farmstand.geocodeConfidence > 0.6
                    ? '#DCFCE7'
                    : farmstand.geocodeConfidence > 0.3
                      ? '#FEF3C7'
                      : '#FEE2E2',
              },
            ]}
          >
            <Text
              style={[
                styles.confidenceValue,
                {
                  color:
                    farmstand.geocodeConfidence > 0.6
                      ? '#16a34a'
                      : farmstand.geocodeConfidence > 0.3
                        ? '#d97706'
                        : '#dc2626',
                },
              ]}
            >
              {Math.round(farmstand.geocodeConfidence * 100)}%
            </Text>
          </View>
          {farmstand.pinAdjustedByUser && (
            <View style={styles.adjustedBadge}>
              <Text style={styles.adjustedText}>User adjusted</Text>
            </View>
          )}
        </View>
      )}

      {/* Interactive Map Preview */}
      {farmstand.latitude && farmstand.longitude && (
        <View style={[styles.mapContainer, isMapExpanded && styles.mapContainerExpanded]}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFillObject}
            initialRegion={mapRegion}
            scrollEnabled={true}
            zoomEnabled={true}
            rotateEnabled={false}
            pitchEnabled={false}
            showsUserLocation={false}
            showsCompass={true}
            showsScale={true}
          >
            <Marker
              coordinate={{
                latitude: farmstand.latitude,
                longitude: farmstand.longitude,
              }}
            >
              <FarmstandPinMarker />
            </Marker>
          </MapView>

          {/* Map Controls Overlay */}
          <View style={styles.mapControlsOverlay}>
            {/* Recenter Button */}
            <Pressable
              onPress={handleRecenter}
              style={styles.mapControlButton}
            >
              <Locate size={18} color="#3D3D3D" />
            </Pressable>

            {/* Expand/Collapse Button */}
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setIsMapExpanded(!isMapExpanded);
              }}
              style={styles.mapControlButton}
            >
              <ZoomIn size={18} color="#3D3D3D" />
            </Pressable>
          </View>

          {/* Coordinates Overlay */}
          <View style={styles.mapOverlay}>
            <Navigation size={14} color="#6B7280" />
            <Text style={styles.mapCoords}>
              {farmstand.latitude.toFixed(5)}, {farmstand.longitude.toFixed(5)}
            </Text>
          </View>

          {/* Zoom/Pan Hint */}
          <View style={styles.mapHintOverlay}>
            <Move size={12} color="#6B7280" />
            <Text style={styles.mapHintText}>Pinch to zoom, drag to pan</Text>
          </View>
        </View>
      )}

      {/* Action Buttons - Row 1: Adjust Pin + Confirm */}
      <View style={styles.actionsContainer}>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onAdjustPin();
          }}
          style={[styles.actionButton, styles.adjustButton]}
        >
          <Crosshair size={16} color="#4338ca" />
          <Text style={styles.adjustButtonText}>Adjust Pin</Text>
        </Pressable>

        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onConfirm();
          }}
          style={[styles.actionButton, styles.confirmButton]}
        >
          <Check size={16} color="#FFFFFF" />
          <Text style={styles.confirmButtonText}>Confirm Exact</Text>
        </Pressable>
      </View>

      {/* Action Buttons - Row 2 */}
      <View style={styles.actionsContainer}>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onKeepApprox();
          }}
          style={[styles.actionButton, styles.keepButton]}
        >
          <MapPinned size={16} color="#0891b2" />
          <Text style={styles.keepButtonText}>Keep Approx</Text>
        </Pressable>

        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onRequestInfo();
          }}
          style={[styles.actionButton, styles.infoButton]}
        >
          <MessageSquare size={16} color="#8B6F4E" />
          <Text style={styles.infoButtonText}>Request Info</Text>
        </Pressable>
      </View>

      {/* Reject Button - Full Width */}
      <View style={styles.actionsContainer}>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onReject();
          }}
          style={[styles.actionButton, styles.rejectButton, { flex: 1 }]}
        >
          <X size={16} color="#dc2626" />
          <Text style={styles.rejectButtonText}>Reject</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

// Full-screen Map Picker Modal
interface MapPickerModalProps {
  visible: boolean;
  farmstand: Farmstand | null;
  onClose: () => void;
  onSave: (lat: number, lng: number) => void;
}

function MapPickerModal({ visible, farmstand, onClose, onSave }: MapPickerModalProps) {
  const mapRef = useRef<MapView>(null);
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Reset selected coords when modal opens
  React.useEffect(() => {
    if (visible && farmstand) {
      setSelectedCoords({
        lat: farmstand.latitude ?? 44.0,
        lng: farmstand.longitude ?? -120.5,
      });
    }
  }, [visible, farmstand]);

  const initialRegion: Region = {
    latitude: farmstand?.latitude ?? 44.0,
    longitude: farmstand?.longitude ?? -120.5,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  };

  const handleMapPress = (event: MapPressEvent) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedCoords({ lat: latitude, lng: longitude });
  };

  const handleRecenter = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (mapRef.current && farmstand?.latitude && farmstand?.longitude) {
      mapRef.current.animateToRegion({
        latitude: farmstand.latitude,
        longitude: farmstand.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 500);
    }
  };

  const handleSavePin = () => {
    if (selectedCoords) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSave(selectedCoords.lat, selectedCoords.lng);
    }
  };

  if (!farmstand) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        {/* Header */}
        <SafeAreaView edges={['top']} style={styles.modalHeader}>
          <Pressable onPress={onClose} style={styles.modalBackButton}>
            <ArrowLeft size={24} color="#3D3D3D" />
          </Pressable>
          <View style={styles.modalHeaderContent}>
            <Text style={styles.modalTitle}>Adjust Pin Location</Text>
            <Text style={styles.modalSubtitle} numberOfLines={1}>
              {farmstand.name}
            </Text>
          </View>
          <View style={{ width: 40 }} />
        </SafeAreaView>

        {/* Map */}
        <View style={styles.fullMapContainer}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFillObject}
            initialRegion={initialRegion}
            onPress={handleMapPress}
            scrollEnabled={true}
            zoomEnabled={true}
            rotateEnabled={true}
            pitchEnabled={false}
            showsUserLocation={true}
            showsMyLocationButton={false}
            showsCompass={true}
            showsScale={true}
          >
            {/* Original Pin (gray/faded) */}
            {farmstand.latitude && farmstand.longitude && (
              <Marker
                coordinate={{
                  latitude: farmstand.latitude,
                  longitude: farmstand.longitude,
                }}
                opacity={0.4}
              >
                <View style={styles.originalPinMarker}>
                  <MapPin size={24} color="#9CA3AF" />
                </View>
              </Marker>
            )}

            {/* New Selected Pin */}
            {selectedCoords && (
              <Marker
                coordinate={{
                  latitude: selectedCoords.lat,
                  longitude: selectedCoords.lng,
                }}
                draggable
                onDragEnd={(e) => {
                  const { latitude, longitude } = e.nativeEvent.coordinate;
                  setSelectedCoords({ lat: latitude, lng: longitude });
                }}
              >
                <FarmstandPinMarker />
              </Marker>
            )}
          </MapView>

          {/* Center Crosshair */}
          <View style={styles.crosshairContainer} pointerEvents="none">
            <View style={styles.crosshairVertical} />
            <View style={styles.crosshairHorizontal} />
          </View>

          {/* Map Controls */}
          <View style={styles.fullMapControls}>
            <Pressable onPress={handleRecenter} style={styles.fullMapControlButton}>
              <Locate size={22} color="#3D3D3D" />
            </Pressable>
          </View>

          {/* Instructions */}
          <View style={styles.instructionsOverlay}>
            <Text style={styles.instructionsText}>
              Tap on the map or drag the pin to set the exact location
            </Text>
          </View>
        </View>

        {/* Coordinates Display */}
        {selectedCoords && (
          <View style={styles.coordsDisplay}>
            <Navigation size={16} color="#2D5A3D" />
            <Text style={styles.coordsText}>
              {selectedCoords.lat.toFixed(6)}, {selectedCoords.lng.toFixed(6)}
            </Text>
          </View>
        )}

        {/* Bottom Actions */}
        <SafeAreaView edges={['bottom']} style={styles.modalFooter}>
          <Pressable onPress={onClose} style={styles.cancelButton}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleSavePin}
            style={[styles.saveButton, !selectedCoords && styles.saveButtonDisabled]}
            disabled={!selectedCoords}
          >
            <Check size={18} color="#FFFFFF" />
            <Text style={styles.saveButtonText}>Save New Pin</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function ApproxLocationsContent() {
  const router = useRouter();
  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const allFarmstands = useAdminStore((s) => s.allFarmstands);
  const updateFarmstand = useAdminStore((s) => s.updateFarmstand);

  const [mapPickerVisible, setMapPickerVisible] = useState(false);
  const [selectedFarmstand, setSelectedFarmstand] = useState<Farmstand | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadAdminData();
    }, [loadAdminData])
  );

  // Filter farmstands with approximate locations needing review
  const approxFarmstands = allFarmstands.filter(
    (f) =>
      f.locationPrecision?.startsWith('approximate') &&
      (f.adminReviewReason === 'approx_location' || f.approvalStatus === 'pending')
  );

  const handleConfirmExact = async (farmstand: Farmstand) => {
    Alert.alert(
      'Confirm as Exact Location',
      'This will mark the location as verified and exact. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            await updateFarmstand(farmstand.id, {
              locationPrecision: 'exact',
              adminReviewReason: null,
              approvalStatus: 'approved',
              verificationStatus: 'VERIFIED',
              pinSource: 'geocode_exact',
            });
            loadAdminData();
          },
        },
      ]
    );
  };

  const handleKeepApprox = async (farmstand: Farmstand) => {
    Alert.alert(
      'Keep as Approximate',
      'This will approve the listing but keep it marked as approximate. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            await updateFarmstand(farmstand.id, {
              adminReviewReason: null,
              approvalStatus: 'approved',
            });
            loadAdminData();
          },
        },
      ]
    );
  };

  const handleRequestInfo = async (farmstand: Farmstand) => {
    Alert.alert(
      'Request Better Address',
      'This will mark the listing as needing more information from the submitter.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Request Info',
          onPress: async () => {
            await updateFarmstand(farmstand.id, {
              verificationStatus: 'NEEDS_INFO',
              submissionAdminNotes: 'Please provide a more precise address or location description.',
            });
            loadAdminData();
          },
        },
      ]
    );
  };

  const handleReject = async (farmstand: Farmstand) => {
    Alert.alert(
      'Reject Listing',
      'Are you sure you want to reject this listing? It will be hidden from the map.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            await updateFarmstand(farmstand.id, {
              approvalStatus: 'rejected',
              status: 'hidden',
              showOnMap: false,
              adminReviewReason: null,
              rejectionReason: 'Location could not be verified',
              verificationStatus: 'REJECTED',
            });
            loadAdminData();
          },
        },
      ]
    );
  };

  const handleAdjustPin = (farmstand: Farmstand) => {
    setSelectedFarmstand(farmstand);
    setMapPickerVisible(true);
  };

  const handleSaveAdjustedPin = async (lat: number, lng: number) => {
    if (!selectedFarmstand) return;

    await updateFarmstand(selectedFarmstand.id, {
      latitude: lat,
      longitude: lng,
      pinSource: 'manual_map_tap',
      pinAdjustedByUser: false, // Admin adjusted, not user
      geocodeConfidence: 1.0, // Admin confirmed = 100% confidence
      locationPrecision: 'exact',
      adminReviewReason: null,
      approvalStatus: 'approved',
      verificationStatus: 'VERIFIED',
    });

    setMapPickerVisible(false);
    setSelectedFarmstand(null);
    loadAdminData();

    Alert.alert('Pin Updated', 'The farmstand location has been updated and verified.');
  };

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.back();
          }}
          style={styles.backButton}
        >
          <ArrowLeft size={22} color="#3D3D3D" />
        </Pressable>
        <Text style={styles.headerTitle}>Approximate Locations</Text>
        <View style={styles.headerRight} />
      </SafeAreaView>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {approxFarmstands.length === 0 ? (
          <View style={styles.emptyState}>
            <MapPinned size={48} color="#E8DDD4" />
            <Text style={styles.emptyTitle}>No Approximate Locations</Text>
            <Text style={styles.emptySubtitle}>
              All farmstand locations have been verified
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionHeader}>
              {approxFarmstands.length} farmstand{approxFarmstands.length !== 1 ? 's' : ''} with
              approximate locations
            </Text>
            {approxFarmstands.map((farmstand) => (
              <ApproxLocationCard
                key={farmstand.id}
                farmstand={farmstand}
                onConfirm={() => handleConfirmExact(farmstand)}
                onKeepApprox={() => handleKeepApprox(farmstand)}
                onRequestInfo={() => handleRequestInfo(farmstand)}
                onReject={() => handleReject(farmstand)}
                onAdjustPin={() => handleAdjustPin(farmstand)}
              />
            ))}
          </>
        )}
      </ScrollView>

      {/* Map Picker Modal */}
      <MapPickerModal
        visible={mapPickerVisible}
        farmstand={selectedFarmstand}
        onClose={() => {
          setMapPickerVisible(false);
          setSelectedFarmstand(null);
        }}
        onSave={handleSaveAdjustedPin}
      />
    </View>
  );
}

export default function ApproxLocationsScreen() {
  return (
    <AdminGuard>
      <ApproxLocationsContent />
    </AdminGuard>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG_COLOR,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: BG_COLOR,
    borderBottomWidth: 1,
    borderBottomColor: '#E8DDD4',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#3D3D3D',
  },
  headerRight: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '500',
    color: '#8B6F4E',
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardHeaderIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#CFFAFE',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cardHeaderContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#3D3D3D',
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#8B6F4E',
    marginTop: 2,
  },
  approxTextContainer: {
    marginBottom: 8,
  },
  approxTextLabel: {
    fontSize: 12,
    color: '#8B6F4E',
    marginBottom: 2,
  },
  approxTextValue: {
    fontSize: 14,
    color: '#3D3D3D',
    fontWeight: '500',
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  confidenceLabel: {
    fontSize: 12,
    color: '#8B6F4E',
    marginRight: 8,
  },
  confidenceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  confidenceValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  adjustedBadge: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#E0E7FF',
  },
  adjustedText: {
    fontSize: 12,
    color: '#4338ca',
    fontWeight: '500',
  },
  mapContainer: {
    height: 180,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
  },
  mapContainerExpanded: {
    height: 300,
  },
  mapControlsOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    gap: 8,
  },
  mapControlButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  mapOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  mapCoords: {
    fontSize: 11,
    color: '#6B7280',
    marginLeft: 4,
  },
  mapHintOverlay: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  mapHintText: {
    fontSize: 10,
    color: '#6B7280',
    marginLeft: 4,
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
  },
  adjustButton: {
    backgroundColor: '#E0E7FF',
    borderWidth: 1,
    borderColor: '#A5B4FC',
  },
  adjustButtonText: {
    color: '#4338ca',
    fontSize: 13,
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: '#2D5A3D',
  },
  confirmButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  keepButton: {
    backgroundColor: '#CFFAFE',
    borderWidth: 1,
    borderColor: '#0891b2',
  },
  keepButtonText: {
    color: '#0891b2',
    fontSize: 13,
    fontWeight: '600',
  },
  infoButton: {
    backgroundColor: '#F5F0EB',
    borderWidth: 1,
    borderColor: '#E8DDD4',
  },
  infoButtonText: {
    color: '#8B6F4E',
    fontSize: 13,
    fontWeight: '600',
  },
  rejectButton: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  rejectButtonText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#8B6F4E',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#A89080',
    marginTop: 4,
  },
  // Modal Styles
  modalContainer: {
    flex: 1,
    backgroundColor: BG_COLOR,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E8DDD4',
  },
  modalBackButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F5F0EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalHeaderContent: {
    flex: 1,
    marginLeft: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#3D3D3D',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#8B6F4E',
    marginTop: 2,
  },
  fullMapContainer: {
    flex: 1,
    position: 'relative',
  },
  crosshairContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 40,
    height: 40,
    marginLeft: -20,
    marginTop: -20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crosshairVertical: {
    position: 'absolute',
    width: 2,
    height: 40,
    backgroundColor: 'rgba(45, 90, 61, 0.4)',
    borderRadius: 1,
  },
  crosshairHorizontal: {
    position: 'absolute',
    width: 40,
    height: 2,
    backgroundColor: 'rgba(45, 90, 61, 0.4)',
    borderRadius: 1,
  },
  fullMapControls: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
  fullMapControlButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  instructionsOverlay: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 76,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  instructionsText: {
    fontSize: 13,
    color: '#3D3D3D',
    textAlign: 'center',
  },
  originalPinMarker: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  coordsDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E8DDD4',
    gap: 8,
  },
  coordsText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#2D5A3D',
  },
  modalFooter: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E8DDD4',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#F5F0EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#8B6F4E',
  },
  saveButton: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#2D5A3D',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveButtonDisabled: {
    backgroundColor: '#A8A29E',
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
