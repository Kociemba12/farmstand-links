import React, { useState, useCallback, useEffect, useMemo, memo, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  StatusBar,
  FlatList,
  StyleSheet,
  Platform,
  ListRenderItemInfo,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, X } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import ImageViewing from 'react-native-image-viewing';
import * as Haptics from 'expo-haptics';
import { Product } from '@/lib/products-store';

const HEADER_HEIGHT = 56;
const MASONRY_GAP = 8;
const MASONRY_PADDING = 12;
const HERO_HEIGHT = 280;

// Photo data for display
interface PhotoItem {
  url: string;
  index: number;
}

interface PhotoGalleryModalProps {
  visible: boolean;
  photos: string[];
  initialIndex?: number;
  onClose: () => void;
  farmstandName?: string;
  farmstandId?: string;
  photoCategories?: (string | null)[];
  products?: Product[];
  offerings?: string[];
}

// Height variations for masonry effect
type HeightVariant = 'short' | 'medium' | 'tall';

function getHeightVariant(index: number): HeightVariant {
  const pattern: HeightVariant[] = ['medium', 'tall', 'short', 'medium', 'short', 'tall', 'medium', 'short'];
  return pattern[index % pattern.length];
}

function getHeightForVariant(variant: HeightVariant, columnWidth: number): number {
  switch (variant) {
    case 'short':
      return columnWidth * 0.9;
    case 'medium':
      return columnWidth * 1.2;
    case 'tall':
      return columnWidth * 1.5;
  }
}

// Memoized masonry tile component for performance
const MasonryTile = memo(function MasonryTile({
  photo,
  index,
  onPress,
  columnWidth,
}: {
  photo: PhotoItem;
  index: number;
  onPress: () => void;
  columnWidth: number;
}) {
  const heightVariant = getHeightVariant(index);
  const tileHeight = getHeightForVariant(heightVariant, columnWidth);

  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index * 20, 200)).duration(200)}>
      <Pressable
        onPress={onPress}
        style={[styles.masonryTile, { height: tileHeight }]}
      >
        <Image
          source={{ uri: photo.url }}
          style={styles.tileImage}
          contentFit="cover"
          transition={150}
          cachePolicy="memory-disk"
          recyclingKey={photo.url}
          contentPosition="center"
        />
      </Pressable>
    </Animated.View>
  );
});

// Memoized hero image component
const HeroImage = memo(function HeroImage({
  photo,
  totalCount,
  onPress,
}: {
  photo: PhotoItem;
  totalCount: number;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress}>
      <Animated.View entering={FadeIn.duration(250)} style={styles.heroContainer}>
        <Image
          source={{ uri: photo.url }}
          style={styles.heroImage}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
          priority="high"
        />
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.3)']}
          style={styles.heroGradient}
        />
        <View style={styles.heroPhotoCount}>
          <Text style={styles.heroPhotoCountText}>
            1 of {totalCount}
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  );
});

// Grid row for FlatList (contains 2 tiles)
interface GridRow {
  id: string;
  left: PhotoItem | null;
  right: PhotoItem | null;
}

// Viewer header — orientation-aware safe area positioning
const ViewerHeader = memo(function ViewerHeader({
  imageIndex,
  totalCount,
  onClose,
}: {
  imageIndex: number;
  totalCount: number;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // In landscape the safe area left/right insets handle the notch
  const paddingTop = insets.top + (isLandscape ? 8 : 12);
  const paddingLeft = insets.left + 16;
  const paddingRight = insets.right + 16;

  return (
    <View
      style={[
        styles.viewerHeader,
        { paddingTop, paddingLeft, paddingRight },
      ]}
    >
      {/* Close button */}
      <Pressable
        onPress={onClose}
        style={styles.viewerCloseButton}
        hitSlop={12}
      >
        <X size={22} color="#FFFFFF" />
      </Pressable>

      {/* Photo index badge */}
      <View style={styles.viewerIndexBadge}>
        <Text style={styles.viewerIndexText}>
          {imageIndex + 1} / {totalCount}
        </Text>
      </View>

      {/* Balance spacer */}
      <View style={{ width: 40 }} />
    </View>
  );
});

// Viewer footer — orientation-aware
const ViewerFooter = memo(function ViewerFooter() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // In landscape, shrink the footer hint or hide it to reclaim vertical space
  const paddingBottom = insets.bottom + (isLandscape ? 8 : 20);

  if (isLandscape) {
    // In landscape just show minimal footer — the extra height is precious
    return (
      <View style={[styles.viewerFooter, { paddingBottom, paddingLeft: insets.left, paddingRight: insets.right }]}>
        <Text style={[styles.viewerHint, { fontSize: 11 }]}>
          Swipe to navigate • Double-tap to zoom
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.viewerFooter, { paddingBottom }]}>
      <Text style={styles.viewerHint}>
        Swipe to navigate • Double-tap to zoom • Swipe down to close
      </Text>
    </View>
  );
});

export function PhotoGalleryModal({
  visible,
  photos,
  initialIndex = 0,
  onClose,
  farmstandName = 'Photo Album',
}: PhotoGalleryModalProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerInitialIndex, setViewerInitialIndex] = useState(0);
  const currentIndexRef = useRef(0);
  // Track current index in state for passing to header
  const [currentViewerIndex, setCurrentViewerIndex] = useState(0);

  // Derived layout values — reactive to orientation changes
  const columnWidth = (screenWidth - MASONRY_PADDING * 2 - MASONRY_GAP) / 2;

  // Convert photos to PhotoItem format - stable reference
  const photoItems: PhotoItem[] = useMemo(() => {
    return photos.map((url, idx) => ({ url, index: idx }));
  }, [photos]);

  // Hero image is the first photo
  const heroPhoto = photoItems[0] ?? null;

  // Masonry grid shows all photos after the first
  const masonryPhotos = useMemo(() => photoItems.slice(1), [photoItems]);

  // Convert to rows for FlatList (2 items per row)
  const gridRows: GridRow[] = useMemo(() => {
    const rows: GridRow[] = [];
    for (let i = 0; i < masonryPhotos.length; i += 2) {
      rows.push({
        id: `row-${i}`,
        left: masonryPhotos[i] || null,
        right: masonryPhotos[i + 1] || null,
      });
    }
    return rows;
  }, [masonryPhotos]);

  // Images for the viewer (react-native-image-viewing format)
  const viewerImages = useMemo(() => {
    return photoItems.map(p => ({ uri: p.url }));
  }, [photoItems]);

  // Preload adjacent images when viewer opens
  useEffect(() => {
    if (viewerVisible && photoItems.length > 0) {
      const idx = viewerInitialIndex;
      const preloadIndices = [idx - 2, idx - 1, idx + 1, idx + 2].filter(
        i => i >= 0 && i < photoItems.length
      );
      Image.prefetch(preloadIndices.map(i => photoItems[i].url));
    }
  }, [viewerVisible, viewerInitialIndex, photoItems]);

  // Reset when modal opens
  useEffect(() => {
    if (visible) {
      setViewerVisible(false);
      if (initialIndex > 0) {
        setViewerInitialIndex(initialIndex);
        setCurrentViewerIndex(initialIndex);
        currentIndexRef.current = initialIndex;
        setTimeout(() => setViewerVisible(true), 100);
      }
    }
  }, [visible, initialIndex]);

  const handleClose = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  }, [onClose]);

  const handlePhotoPress = useCallback((photo: PhotoItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setViewerInitialIndex(photo.index);
    setCurrentViewerIndex(photo.index);
    currentIndexRef.current = photo.index;
    setViewerVisible(true);
  }, []);

  const handleViewerClose = useCallback(() => {
    setViewerVisible(false);
  }, []);

  const handleViewerIndexChange = useCallback((newIndex: number) => {
    currentIndexRef.current = newIndex;
    setCurrentViewerIndex(newIndex);
  }, []);

  // Render grid row
  const renderGridRow = useCallback(({ item }: ListRenderItemInfo<GridRow>) => {
    return (
      <View style={styles.gridRow}>
        <View style={styles.gridColumn}>
          {item.left && (
            <MasonryTile
              photo={item.left}
              index={item.left.index - 1}
              onPress={() => handlePhotoPress(item.left!)}
              columnWidth={columnWidth}
            />
          )}
        </View>
        <View style={styles.gridColumn}>
          {item.right && (
            <MasonryTile
              photo={item.right}
              index={item.right.index - 1}
              onPress={() => handlePhotoPress(item.right!)}
              columnWidth={columnWidth}
            />
          )}
        </View>
      </View>
    );
  }, [handlePhotoPress, columnWidth]);

  const keyExtractor = useCallback((item: GridRow) => item.id, []);

  const headerTopOffset = insets.top + 8;

  // Header component for FlatList (contains hero image)
  const ListHeader = useMemo(() => {
    if (photoItems.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No photos available</Text>
        </View>
      );
    }

    return (
      <>
        {/* Photos label with count */}
        <View style={styles.photosLabelContainer}>
          <Text style={styles.photosLabel}>Photos</Text>
          <Text style={styles.photosCount}>· {photoItems.length}</Text>
        </View>

        {/* Featured Hero Image */}
        {heroPhoto && (
          <HeroImage
            photo={heroPhoto}
            totalCount={photoItems.length}
            onPress={() => handlePhotoPress(heroPhoto)}
          />
        )}
      </>
    );
  }, [photoItems.length, heroPhoto, handlePhotoPress]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
      statusBarTranslucent
      // Allow the modal to rotate with the device
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}
    >
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <View style={styles.container}>
        {/* Fixed Header */}
        <View style={[styles.header, { paddingTop: headerTopOffset }]}>
          <View style={[styles.headerRow, { paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }]}>
            <Pressable onPress={handleClose} style={styles.backButton} hitSlop={12}>
              <ArrowLeft size={24} color="#1A1A1A" />
            </Pressable>
            <View style={styles.titleContainer}>
              <Text numberOfLines={1} style={styles.titleText}>
                {farmstandName}
              </Text>
            </View>
            <View style={{ width: 40 }} />
          </View>
        </View>

        {/* Optimized FlatList for masonry grid */}
        <FlatList
          data={gridRows}
          renderItem={renderGridRow}
          keyExtractor={keyExtractor}
          ListHeaderComponent={ListHeader}
          contentContainerStyle={[
            styles.listContent,
            { paddingTop: headerTopOffset + HEADER_HEIGHT + 8 },
          ]}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={Platform.OS === 'android'}
          maxToRenderPerBatch={6}
          windowSize={7}
          initialNumToRender={4}
          updateCellsBatchingPeriod={50}
          getItemLayout={(_, index) => ({
            length: columnWidth * 1.2 + MASONRY_GAP,
            offset: (columnWidth * 1.2 + MASONRY_GAP) * index,
            index,
          })}
        />

        {/* Full-screen Image Viewer with orientation support */}
        <ImageViewing
          images={viewerImages}
          imageIndex={viewerInitialIndex}
          visible={viewerVisible}
          onRequestClose={handleViewerClose}
          onImageIndexChange={handleViewerIndexChange}
          swipeToCloseEnabled
          doubleTapToZoomEnabled
          presentationStyle="fullScreen"
          animationType="fade"
          backgroundColor="#000000"
          HeaderComponent={({ imageIndex }) => (
            <ViewerHeader
              imageIndex={imageIndex}
              totalCount={photoItems.length}
              onClose={handleViewerClose}
            />
          )}
          FooterComponent={() => (
            <ViewerFooter />
          )}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAF8',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: HEADER_HEIGHT,
    backgroundColor: '#FFFFFF',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 32,
  },
  titleText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1A1A1A',
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: 40,
  },
  photosLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: MASONRY_PADDING,
    marginBottom: 12,
  },
  photosLabel: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
    letterSpacing: -0.3,
  },
  photosCount: {
    fontSize: 20,
    fontWeight: '500',
    color: '#8B6F4E',
    marginLeft: 6,
  },
  heroContainer: {
    marginHorizontal: MASONRY_PADDING,
    marginBottom: MASONRY_GAP,
    height: HERO_HEIGHT,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#F0EDE8',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '40%',
  },
  heroPhotoCount: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  heroPhotoCountText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  gridRow: {
    flexDirection: 'row',
    paddingHorizontal: MASONRY_PADDING,
    gap: MASONRY_GAP,
  },
  gridColumn: {
    flex: 1,
  },
  masonryTile: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: MASONRY_GAP,
    backgroundColor: '#F0EDE8',
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
  },
  emptyText: {
    fontSize: 16,
    color: '#8B6F4E',
  },
  // Viewer styles
  viewerHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
  },
  viewerCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerIndexBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  viewerIndexText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  viewerFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  viewerHint: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    textAlign: 'center',
  },
});
