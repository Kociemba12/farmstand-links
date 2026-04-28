import React, { useState, useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { VideoView, useVideoPlayer } from 'expo-video';

interface VideoPlayerContentProps {
  videoUrl: string;
  tapTimestamp: number;
  onClose: () => void;
}

export function VideoPlayerContent({ videoUrl, tapTimestamp, onClose }: VideoPlayerContentProps) {
  const [isError, setIsError] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [firstFrameReady, setFirstFrameReady] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const paddingTop = Math.max(0, insets.top - 12);
  const paddingLeft = insets.left + 16;

  useEffect(() => {
    const mountMs = Date.now() - tapTimestamp;
    console.log(`[VideoPlayer] mounted | tap→mount: ${mountMs}ms | uri: ${videoUrl?.slice(0, 100)}`);

    timeoutRef.current = setTimeout(() => {
      setIsError((prev) => {
        if (!prev) {
          console.warn('[VideoPlayer] timeout — no first frame after 5s');
          setErrorMsg('Video took too long to load. Please try again.');
          return true;
        }
        return prev;
      });
    }, 5000);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const player = useVideoPlayer(videoUrl ? { uri: videoUrl } : null, (p) => {
    p.muted = false;
    p.play();
    console.log(`[VideoPlayer] player init + play() | tap+${Date.now() - tapTimestamp}ms`);
  });

  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status, error }) => {
      console.log(`[VideoPlayer] status → ${status} | tap+${Date.now() - tapTimestamp}ms`);
      if (status === 'error') {
        const msg = (error as { message?: string } | undefined)?.message ?? 'Unknown error';
        setErrorMsg(msg);
        setIsError(true);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        console.error(`[VideoPlayer] error: ${msg}`);
      }
    });
    return () => sub.remove();
  }, [player]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={styles.fill}>
      {/* Video fills the entire space */}
      {videoUrl ? (
        <VideoView
          player={player}
          style={styles.fill}
          contentFit="contain"
          nativeControls
          onFirstFrameRender={() => {
            console.log(`[VideoPlayer] first frame | tap+${Date.now() - tapTimestamp}ms`);
            setFirstFrameReady(true);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
          }}
        />
      ) : (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>No video available</Text>
        </View>
      )}

      {/* Loading overlay */}
      {videoUrl && !firstFrameReady && !isError && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      )}

      {/* Error overlay */}
      {isError && (
        <View style={styles.overlay}>
          <Text style={styles.errorTitle}>Unable to load video</Text>
          <Text style={styles.errorSub}>
            {errorMsg ?? 'An error occurred. Please try again.'}
          </Text>
        </View>
      )}

      {/* Header row — identical container structure to ViewerHeader in PhotoGalleryModal */}
      <View style={[styles.header, { paddingTop, paddingLeft }]}>
        <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={12}>
          <X size={22} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  // Matches viewerHeader in PhotoGalleryModal exactly
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 300,
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
  },
  // Matches viewerCloseButton in PhotoGalleryModal exactly
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorSub: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
