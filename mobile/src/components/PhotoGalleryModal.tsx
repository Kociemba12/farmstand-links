import React, { useState, useCallback, useEffect, useMemo, memo, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  StatusBar,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, X, Play } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import Animated, { FadeInDown } from 'react-native-reanimated';
import ImageViewing from 'react-native-image-viewing';
import * as Haptics from 'expo-haptics';
import { WebView } from 'react-native-webview';
import { Product } from '@/lib/products-store';
import { VideoPlayerContent } from '@/components/VideoPlayerContent';

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
  videoUrl?: string;
  videoDurationSeconds?: number | null;
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

  // Pressable is OUTERMOST so taps register immediately — Animated.View is inside,
  // not around, the pressable (reanimated v3 entering blocks pointerEvents on the animated node)
  return (
    <Pressable
      onPress={onPress}
      style={[styles.masonryTile, { height: tileHeight }]}
    >
      <Animated.View
        entering={FadeInDown.delay(Math.min(index * 20, 200)).duration(200)}
        style={StyleSheet.absoluteFillObject}
      >
        <Image
          source={{ uri: photo.url }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          transition={150}
          cachePolicy="memory-disk"
          recyclingKey={photo.url}
          contentPosition="center"
        />
      </Animated.View>
    </Pressable>
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
    <Pressable onPress={onPress} style={styles.heroContainer}>
      <Image
        source={{ uri: photo.url }}
        style={StyleSheet.absoluteFillObject}
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
    </Pressable>
  );
});

// Video hero tile — shown when a video exists (first gallery item).
// A hidden 1×1 WebView seeks the video to the first frame via canvas and posts
// back the JPEG data-URI, which is then shown as the tile thumbnail.
// The full video never loads — only metadata + one frame is fetched.
// Pressable is outermost so taps are instant; the WebView unmounts once captured.
const VideoHero = memo(function VideoHero({
  videoUrl,
  durationSeconds,
  totalCount,
  onPress,
}: {
  videoUrl: string;
  durationSeconds: number | null;
  totalCount: number;
  onPress: () => void;
}) {
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(null);

  // HTML that seeks the video to 0.1 s, draws one frame to canvas, and posts
  // the JPEG data-URI back to React Native. The video element is hidden and
  // never plays — only metadata + the seek chunk is downloaded.
  const thumbnailHtml = useMemo(() => `<!DOCTYPE html>
<html><head><style>*{margin:0;padding:0;overflow:hidden;background:transparent}</style></head>
<body>
<canvas id="c"></canvas>
<video id="v" src="${videoUrl}" preload="metadata" muted playsinline
  crossorigin="anonymous" style="position:absolute;left:-9999px;width:1px;height:1px"></video>
<script>
var v=document.getElementById('v'),c=document.getElementById('c'),done=false;
v.addEventListener('loadedmetadata',function(){
  c.width=v.videoWidth||320;c.height=v.videoHeight||240;v.currentTime=0.1;
});
v.addEventListener('seeked',function(){
  if(done)return;done=true;
  try{
    var ctx=c.getContext('2d');
    ctx.drawImage(v,0,0,c.width,c.height);
    window.ReactNativeWebView.postMessage(c.toDataURL('image/jpeg',0.75));
  }catch(e){
    window.ReactNativeWebView.postMessage('error');
  }
});
v.addEventListener('error',function(){window.ReactNativeWebView.postMessage('error')});
<\/script>
</body></html>`, [videoUrl]);

  const handleMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    const data = event.nativeEvent.data;
    if (data && data.startsWith('data:image')) {
      setThumbnailUri(data);
    }
    // On error the fallback dark bg stays — no action needed
  }, []);

  return (
    <Pressable onPress={onPress} style={[styles.heroContainer, { overflow: 'hidden' }]}>
      {/* Hidden 1×1 WebView — generates thumbnail then is replaced by the image */}
      {!thumbnailUri && (
        <View style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} pointerEvents="none">
          <WebView
            source={{ html: thumbnailHtml }}
            style={{ flex: 1 }}
            onMessage={handleMessage}
            javaScriptEnabled
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            scrollEnabled={false}
          />
        </View>
      )}

      {/* Thumbnail once captured; dark fallback while loading */}
      {thumbnailUri ? (
        <Image
          source={{ uri: thumbnailUri }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
        />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#111827' }]} />
      )}

      {/* Subtle scrim for readability over any thumbnail */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.45)']}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Centered play button */}
      <View style={styles.videoPlayOverlay}>
        <View style={styles.videoPlayButton}>
          <Play size={26} color="#1A1A1A" fill="#1A1A1A" />
        </View>
      </View>

      {/* Duration + count badge */}
      <View style={styles.heroPhotoCount}>
        <Text style={styles.heroPhotoCountText}>
          {durationSeconds ? `▶ ${durationSeconds}s  ·  1 of ${totalCount}` : `▶ Video  ·  1 of ${totalCount}`}
        </Text>
      </View>
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
  videoUrl,
  videoDurationSeconds,
}: PhotoGalleryModalProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerInitialIndex, setViewerInitialIndex] = useState(0);
  const currentIndexRef = useRef(0);
  // Track current index in state for passing to header
  const [currentViewerIndex, setCurrentViewerIndex] = useState(0);
  // In-modal video player (avoids nested Modal — iOS only allows one modal at a time)
  const [videoPlayerVisible, setVideoPlayerVisible] = useState(false);
  const videoTapTimeRef = useRef<number>(0);

  // Derived layout values — reactive to orientation changes
  const columnWidth = (screenWidth - MASONRY_PADDING * 2 - MASONRY_GAP) / 2;

  const hasVideo = !!videoUrl;

  // Convert photos to PhotoItem format - stable reference
  const photoItems: PhotoItem[] = useMemo(() => {
    return photos.map((url, idx) => ({ url, index: idx }));
  }, [photos]);

  // Total count includes video + photos
  const totalMediaCount = photoItems.length + (hasVideo ? 1 : 0);

  // Hero image: first photo (only used when no video)
  const heroPhoto = !hasVideo ? (photoItems[0] ?? null) : null;

  // Masonry grid: when video exists show ALL photos; otherwise skip first (it's the hero)
  const masonryPhotos = useMemo(
    () => (hasVideo ? photoItems : photoItems.slice(1)),
    [hasVideo, photoItems]
  );

  // Split photos into independent left/right columns for uniform spacing
  const leftPhotos = useMemo(() => masonryPhotos.filter((_, i) => i % 2 === 0), [masonryPhotos]);
  const rightPhotos = useMemo(() => masonryPhotos.filter((_, i) => i % 2 === 1), [masonryPhotos]);

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

  // Reset when modal opens or closes — ensures video player never persists across sessions
  useEffect(() => {
    if (visible) {
      setViewerVisible(false);
      setVideoPlayerVisible(false);
      if (initialIndex > 0) {
        setViewerInitialIndex(initialIndex);
        setCurrentViewerIndex(initialIndex);
        currentIndexRef.current = initialIndex;
        setTimeout(() => setViewerVisible(true), 100);
      }
    } else {
      // Gallery closing — tear down any open video player immediately
      setVideoPlayerVisible(false);
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


  const headerTopOffset = insets.top + 8;

  // Header component for FlatList (contains hero image)
  const ListHeader = useMemo(() => {
    if (totalMediaCount === 0) {
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
          <Text style={styles.photosCount}>· {totalMediaCount}</Text>
        </View>

        {/* Video hero — shown as first item when video exists */}
        {hasVideo && videoUrl && (
          <VideoHero
            videoUrl={videoUrl}
            durationSeconds={videoDurationSeconds ?? null}
            totalCount={totalMediaCount}
            onPress={() => {
              videoTapTimeRef.current = Date.now();
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setVideoPlayerVisible(true);
            }}
          />
        )}

        {/* Photo hero — only shown when no video */}
        {!hasVideo && heroPhoto && (
          <HeroImage
            photo={heroPhoto}
            totalCount={totalMediaCount}
            onPress={() => handlePhotoPress(heroPhoto)}
          />
        )}
      </>
    );
  }, [totalMediaCount, hasVideo, videoUrl, photoItems, videoDurationSeconds, heroPhoto, handlePhotoPress, videoTapTimeRef]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => {
        // Back press: dismiss video player first if open, otherwise close gallery
        if (videoPlayerVisible) {
          setVideoPlayerVisible(false);
        } else {
          handleClose();
        }
      }}
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

        {/* Two-column masonry grid — each column is independent so tile heights never affect the other column */}
        <ScrollView
          contentContainerStyle={[
            styles.listContent,
            { paddingTop: headerTopOffset + HEADER_HEIGHT + 8 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {ListHeader}
          <View style={styles.twoColumnContainer}>
            <View style={styles.gridColumn}>
              {leftPhotos.map((photo, i) => (
                <MasonryTile
                  key={photo.url}
                  photo={photo}
                  index={i * 2}
                  onPress={() => handlePhotoPress(photo)}
                  columnWidth={columnWidth}
                />
              ))}
            </View>
            <View style={styles.gridColumn}>
              {rightPhotos.map((photo, i) => (
                <MasonryTile
                  key={photo.url}
                  photo={photo}
                  index={i * 2 + 1}
                  onPress={() => handlePhotoPress(photo)}
                  columnWidth={columnWidth}
                />
              ))}
            </View>
          </View>
        </ScrollView>

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

      {/* In-modal video player overlay — avoids nested Modal (iOS only allows one at a time).
          Rendered as an absolute-fill View inside this Modal so the native player works correctly.
          zIndex must exceed the header's zIndex:100 so it captures all touches. */}
      {videoPlayerVisible && videoUrl && (
        <View style={[StyleSheet.absoluteFillObject, { zIndex: 200 }]}>
          <VideoPlayerContent
            videoUrl={videoUrl}
            tapTimestamp={videoTapTimeRef.current}
            onClose={() => setVideoPlayerVisible(false)}
          />
        </View>
      )}
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
  twoColumnContainer: {
    flexDirection: 'row',
    paddingHorizontal: MASONRY_PADDING,
    gap: MASONRY_GAP,
  },
  gridColumn: {
    flex: 1,
    gap: MASONRY_GAP,
  },
  masonryTile: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#F0EDE8',
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
  videoPlayOverlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  videoPlayButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingLeft: 4,
  },
});
