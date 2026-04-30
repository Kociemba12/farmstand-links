import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Image,
  TouchableOpacity,
  ActionSheetIOS,
} from 'react-native';
import ImageViewing from 'react-native-image-viewing';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { ChevronLeft, Clock, CheckCircle, Star, ImagePlus, X } from 'lucide-react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { uploadToSupabaseStorage } from '@/lib/supabase';
import { useUserStore } from '@/lib/user-store';
import {
  SupportTicket,
  SupportMessage,
  TicketStatus,
  SUPPORT_BUCKET,
  fetchSupportTicket,
  fetchTicketMessages,
  sendTicketMessage,
  markSupportTicketRead,
} from '@/lib/support-api';
import { useSupportUnreadStore } from '@/lib/support-unread-store';

// ── Constants ────────────────────────────────────────────────────────────────
const CREAM = '#FDF8F3';
const FOREST = '#2D5A3D';
const MAX_PHOTOS = 5;

// ── Types ────────────────────────────────────────────────────────────────────
type PhotoAttachment = { uri: string; mime: string };

// ── Helpers ──────────────────────────────────────────────────────────────────
function getStatusColor(status: TicketStatus): string {
  switch (status) {
    case 'open': return '#3B82F6';
    case 'waiting_on_farmer': return '#F59E0B';
    case 'waiting_on_admin': return '#3B82F6';
    case 'resolved': return '#16A34A';
    case 'reopened': return '#8B5CF6';
    default: return '#6B7280';
  }
}

function getStatusLabel(status: TicketStatus): string {
  switch (status) {
    case 'open': return 'Open';
    case 'waiting_on_farmer': return 'Your Reply Needed';
    case 'waiting_on_admin': return 'Awaiting Response';
    case 'resolved': return 'Resolved';
    case 'reopened': return 'Reopened';
    default: return status;
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (diffMins < 1) return 'Just now';
  if (diffHours < 24) return timeStr;
  if (diffDays === 1) return `Yesterday ${timeStr}`;
  if (diffDays < 7) return `${date.toLocaleDateString('en-US', { weekday: 'short' })} ${timeStr}`;
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${timeStr}`;
}

// Converts photo to JPEG and uploads to Supabase Storage.
// Uses the same bucket (support-screenshots) as support ticket submission photos.
async function uploadSupportPhoto(
  uri: string,
  ticketId: string,
  index: number,
  userId: string,
): Promise<string> {
  if (__DEV__) console.log('[SupportThread] uploadSupportPhoto — uri:', uri.slice(0, 80), '| ticketId:', ticketId, '| index:', index, '| bucket:', SUPPORT_BUCKET);

  // Convert to JPEG to handle HEIC/HEIF and normalize format (same pattern as claim photos)
  const compressed = await manipulateAsync(
    uri,
    [{ resize: { width: 1600 } }],
    { compress: 0.82, format: SaveFormat.JPEG },
  );
  if (__DEV__) console.log('[SupportThread] uploadSupportPhoto — converted:', compressed.width, 'x', compressed.height, '| uri:', compressed.uri.slice(0, 80));

  const storagePath = `support-ticket-attachments/${userId}/${ticketId}/${Date.now()}-${index}.jpg`;
  if (__DEV__) console.log('[SupportThread] uploadSupportPhoto — storagePath:', storagePath);

  const { url, error } = await uploadToSupabaseStorage(SUPPORT_BUCKET, storagePath, compressed.uri, 'image/jpeg');
  if (__DEV__) {
    console.log('[SupportThread] uploadSupportPhoto — error:', error?.message ?? 'none');
    console.log('[SupportThread] uploadSupportPhoto — url:', url ?? 'none');
  }
  if (error || !url) throw error ?? new Error('Upload returned no URL');
  return url;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MessageBubble({
  message,
  onImagePress,
}: {
  message: SupportMessage;
  onImagePress: (urls: string[], index: number) => void;
}) {
  const isFromAdmin = message.sender_role === 'admin';
  const imageUrls: string[] = Array.isArray(message.attachment_urls)
    ? message.attachment_urls.filter((u): u is string => typeof u === 'string')
    : [];
  const hasText = message.message_text.trim().length > 0;

  return (
    <View style={{ marginBottom: 10, alignItems: isFromAdmin ? 'flex-start' : 'flex-end' }}>
      {/* Bubble */}
      <View
        style={{
          maxWidth: '78%',
          backgroundColor: isFromAdmin ? '#FFFFFF' : FOREST,
          borderRadius: 18,
          borderTopLeftRadius: isFromAdmin ? 4 : 18,
          borderTopRightRadius: isFromAdmin ? 18 : 4,
          paddingHorizontal: imageUrls.length > 0 || hasText ? 14 : 0,
          paddingVertical: imageUrls.length > 0 || hasText ? 10 : 0,
          borderWidth: isFromAdmin ? 1 : 0,
          borderColor: '#EDE8E0',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.05,
          shadowRadius: 3,
          elevation: 1,
          overflow: 'hidden',
        }}
      >
        {hasText && (
          <Text style={{ fontSize: 15, color: isFromAdmin ? '#1C1917' : '#FFFFFF', lineHeight: 22 }}>
            {message.message_text}
          </Text>
        )}
        {imageUrls.map((url, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => onImagePress(imageUrls, i)}
            activeOpacity={0.85}
          >
            <Image
              source={{ uri: url }}
              style={{
                width: 200,
                aspectRatio: 4 / 3,
                borderRadius: hasText ? 10 : 0,
                marginTop: hasText ? 8 : 0,
              }}
              resizeMode="cover"
            />
          </TouchableOpacity>
        ))}
      </View>
      {/* Timestamp below bubble */}
      <Text style={{ fontSize: 11, color: '#C0B8AE', marginTop: 4, paddingHorizontal: 4 }}>
        {formatTimestamp(message.created_at)}
      </Text>
    </View>
  );
}

function MetaDivider({ ticket }: { ticket: SupportTicket }) {
  return (
    <View style={{ marginBottom: 24 }}>
      <View style={{ height: 1, backgroundColor: '#EDE8E0' }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10, gap: 6 }}>
        <Clock size={11} color="#C0B8AE" />
        <Text style={{ fontSize: 11, color: '#C0B8AE', fontWeight: '500', letterSpacing: 0.3 }}>
          Opened {formatDate(ticket.created_at)}
        </Text>
        {ticket.rating != null && (
          <>
            <Text style={{ fontSize: 11, color: '#D4C4B8' }}>·</Text>
            <Star size={11} color="#D4943A" fill="#D4943A" />
            <Text style={{ fontSize: 11, color: '#C0B8AE', fontWeight: '500' }}>
              {ticket.rating}/5
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function SupportThreadScreen() {
  const router = useRouter();
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();
  const scrollViewRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();

  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [replyText, setReplyText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [viewerImages, setViewerImages] = useState<{ uri: string }[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerVisible, setViewerVisible] = useState(false);

  // Photo attachment state
  const [photos, setPhotos] = useState<PhotoAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const fetchUnreadCount = useSupportUnreadStore(s => s.fetchUnreadCount);
  const markTicketReadInStore = useSupportUnreadStore(s => s.markTicketRead);

  const loadData = useCallback(async () => {
    if (!ticketId) return;
    setIsLoading(true);
    try {
      const [ticketData, messagesData] = await Promise.all([
        fetchSupportTicket(ticketId),
        fetchTicketMessages(ticketId),
      ]);
      setTicket(ticketData);
      setMessages(messagesData);
      // Optimistically clear badge before server round-trip
      markTicketReadInStore(ticketId);
      await markSupportTicketRead(ticketId);
      void fetchUnreadCount();
    } catch (err) {
      if (__DEV__) console.warn('[thread] Load error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [ticketId, fetchUnreadCount, markTicketReadInStore]);

  useEffect(() => { loadData(); }, [loadData]);

  useFocusEffect(
    useCallback(() => { loadData(); }, [loadData])
  );

  // ── Photo picker ────────────────────────────────────────────────────────────
  const handleTakePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Camera Access', 'Please allow camera access in your settings.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const mime = asset.mimeType ?? 'image/jpeg';
      setPhotos(prev => [...prev, { uri: asset.uri, mime }].slice(0, MAX_PHOTOS));
    }
  };

  const handlePickFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Photo Access', 'Please allow photo library access in your settings.');
      return;
    }
    const remaining = MAX_PHOTOS - photos.length;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
    });
    if (!result.canceled && result.assets.length > 0) {
      const newPhotos = result.assets.map(a => ({ uri: a.uri, mime: a.mimeType ?? 'image/jpeg' }));
      setPhotos(prev => [...prev, ...newPhotos].slice(0, MAX_PHOTOS));
    }
  };

  const handleAddPhoto = async () => {
    if (photos.length >= MAX_PHOTOS) {
      Alert.alert('Photo Limit', `You can attach up to ${MAX_PHOTOS} photos per reply.`);
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Take Photo', 'Choose from Library', 'Cancel'], cancelButtonIndex: 2 },
        (idx) => {
          if (idx === 0) handleTakePhoto().catch(console.error);
          else if (idx === 1) handlePickFromLibrary().catch(console.error);
        }
      );
    } else {
      handlePickFromLibrary().catch(console.error);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  // ── Send reply ──────────────────────────────────────────────────────────────
  const handleSendReply = async () => {
    if (!replyText.trim() && photos.length === 0) return;
    if (!ticketId) return;

    setIsSending(true);
    try {
      // Upload any selected photos first
      let uploadedUrls: string[] | null = null;
      if (photos.length > 0) {
        setIsUploading(true);
        const userId = useUserStore.getState().user?.id ?? '';
        if (__DEV__) console.log('[SupportThread] uploading', photos.length, 'photo(s) — ticketId:', ticketId, '| userId:', userId || '(unknown)');

        const results = await Promise.allSettled(
          photos.map((p, index) => uploadSupportPhoto(p.uri, ticketId, index, userId))
        );
        uploadedUrls = results
          .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
          .map(r => r.value);

        if (__DEV__) {
          results.forEach((r, i) => {
            if (r.status === 'rejected') console.warn('[SupportThread] photo', i, 'upload failed:', (r as PromiseRejectedResult).reason);
          });
        }

        if (uploadedUrls.length === 0 && photos.length > 0) {
          Alert.alert('Upload Failed', 'Could not upload photos. Please try again.');
          setIsSending(false);
          setIsUploading(false);
          return;
        }
        setIsUploading(false);
      }

      const newMessage = await sendTicketMessage(
        ticketId,
        replyText.trim(),
        uploadedUrls && uploadedUrls.length > 0 ? uploadedUrls : null
      );

      setMessages(prev => [...prev, newMessage]);
      setReplyText('');
      setPhotos([]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);

      // Refresh ticket status
      const updated = await fetchSupportTicket(ticketId);
      setTicket(updated);
    } catch (err) {
      if (__DEV__) console.warn('[thread] Send error:', err);
      Alert.alert('Error', 'Could not send message. Please try again.');
    } finally {
      setIsSending(false);
      setIsUploading(false);
    }
  };

  const canSend = replyText.trim().length > 0 || photos.length > 0;
  const isResolved = ticket?.status === 'resolved';
  // Only allow photo attachments on open/active tickets (not resolved)
  const canAttach = !isResolved;

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: CREAM, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#4A7C59" />
      </View>
    );
  }

  if (!ticket) {
    return (
      <View style={{ flex: 1, backgroundColor: CREAM, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#8B6F4E' }}>Ticket not found</Text>
        <Pressable
          onPress={() => router.back()}
          style={{ marginTop: 16, backgroundColor: '#EDE8E0', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 }}
        >
          <Text style={{ color: '#44403C' }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const statusColor = getStatusColor(ticket.status as TicketStatus);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: CREAM }}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <SafeAreaView
        edges={['top']}
        style={{ backgroundColor: CREAM, borderBottomWidth: 1, borderBottomColor: '#EDE8E0' }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4 }}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={{ padding: 10, borderRadius: 20 }}>
            <ChevronLeft size={24} color="#44403C" />
          </Pressable>
          <View style={{ flex: 1, paddingHorizontal: 8 }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: '#44403C' }} numberOfLines={1}>
              {ticket.subject}
            </Text>
            <View style={{
              alignSelf: 'flex-start', marginTop: 3,
              paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20,
              backgroundColor: statusColor + '18',
            }}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: statusColor, letterSpacing: 0.2 }}>
                {getStatusLabel(ticket.status as TicketStatus)}
              </Text>
            </View>
          </View>
          <View style={{ width: 44 }} />
        </View>
      </SafeAreaView>

      {/* Message thread */}
      <ScrollView
        ref={scrollViewRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: false })}
      >
        <MetaDivider ticket={ticket} />

        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onImagePress={(urls, index) => {
              setViewerImages(urls.map(u => ({ uri: u })));
              setViewerIndex(index);
              setViewerVisible(true);
            }}
          />
        ))}

        {isResolved && (
          <View style={{
            backgroundColor: '#F0FDF4', borderRadius: 14, padding: 16, marginTop: 16,
            alignItems: 'center', borderWidth: 1, borderColor: '#BBF7D0',
          }}>
            <CheckCircle size={22} color="#16A34A" />
            <Text style={{ color: '#15803D', fontWeight: '600', marginTop: 8, fontSize: 14 }}>
              This ticket has been resolved
            </Text>
            <Text style={{ color: '#16A34A', fontSize: 13, textAlign: 'center', marginTop: 4, opacity: 0.7 }}>
              Send a message to reopen this ticket.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Composer */}
      <View style={{
        backgroundColor: CREAM,
        borderTopWidth: 1,
        borderTopColor: '#EDE8E0',
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: Math.max(insets.bottom, 10),
      }}>
        {/* Photo preview strip */}
        {photos.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, marginBottom: 10 }}
            contentContainerStyle={{ gap: 8, paddingRight: 4 }}
          >
            {photos.map((photo, i) => (
              <View key={i} style={{ position: 'relative' }}>
                <Image
                  source={{ uri: photo.uri }}
                  style={{ width: 72, height: 72, borderRadius: 10, backgroundColor: '#E8E0D5' }}
                  resizeMode="cover"
                />
                <TouchableOpacity
                  onPress={() => removePhoto(i)}
                  style={{
                    position: 'absolute', top: -6, right: -6,
                    width: 20, height: 20, borderRadius: 10,
                    backgroundColor: '#44403C',
                    alignItems: 'center', justifyContent: 'center',
                    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.2, shadowRadius: 2, elevation: 2,
                  }}
                >
                  <X size={11} color="#FFFFFF" strokeWidth={2.5} />
                </TouchableOpacity>
              </View>
            ))}
            {photos.length < MAX_PHOTOS && (
              <TouchableOpacity
                onPress={handleAddPhoto}
                style={{
                  width: 72, height: 72, borderRadius: 10,
                  backgroundColor: '#F5F0EB',
                  borderWidth: 1.5, borderColor: '#EDE8E0', borderStyle: 'dashed',
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <ImagePlus size={20} color="#A8906E" />
              </TouchableOpacity>
            )}
          </ScrollView>
        )}

        {/* Input row */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          {/* Attach button — only for open/active tickets */}
          {canAttach && (
            <TouchableOpacity
              onPress={handleAddPhoto}
              activeOpacity={0.7}
              style={{
                width: 40, height: 40, borderRadius: 20, marginRight: 8, marginBottom: 1,
                backgroundColor: '#F5F0EB',
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <ImagePlus size={18} color="#A8906E" />
            </TouchableOpacity>
          )}

          <TextInput
            style={{
              flex: 1,
              minHeight: 42,
              maxHeight: 110,
              paddingHorizontal: 18,
              paddingTop: 12,
              paddingBottom: 12,
              borderRadius: 24,
              borderWidth: 1,
              borderColor: '#EDE8E0',
              backgroundColor: '#FFFFFF',
              fontSize: 15,
              color: '#1C1917',
            }}
            placeholder={isResolved ? 'Send a message to reopen...' : 'Type your message...'}
            placeholderTextColor="#C0B8AE"
            multiline
            textAlignVertical="top"
            value={replyText}
            onChangeText={setReplyText}
            autoCorrect={true}
            spellCheck={true}
            autoCapitalize="sentences"
            autoComplete="off"
            blurOnSubmit={false}
          />

          <TouchableOpacity
            onPress={handleSendReply}
            disabled={isSending || !canSend}
            activeOpacity={0.8}
            style={{
              width: 40, height: 40, borderRadius: 20,
              marginLeft: 8, marginBottom: 1,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: canSend ? FOREST : '#E8E0D5',
              shadowColor: canSend ? FOREST : 'transparent',
              shadowOffset: { width: 0, height: 3 },
              shadowOpacity: canSend ? 0.25 : 0,
              shadowRadius: 6,
              elevation: canSend ? 4 : 0,
            }}
          >
            {(isSending || isUploading) ? (
              <ActivityIndicator color="white" size="small" />
            ) : (
              <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ImageViewing
        images={viewerImages}
        imageIndex={viewerIndex}
        visible={viewerVisible}
        onRequestClose={() => setViewerVisible(false)}
      />
    </KeyboardAvoidingView>
  );
}
