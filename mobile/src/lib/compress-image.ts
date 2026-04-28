import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Compress and resize an image before uploading.
 * - Resizes to max 1200px wide (preserves aspect ratio)
 * - Converts to JPEG at 70% quality
 * - Falls back to original URI if compression fails
 */
export async function compressImage(uri: string): Promise<string> {
  console.log('[compress-image] Compressing:', uri);
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1200 } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
    );
    console.log('[compress-image] Done:', result.uri);
    return result.uri;
  } catch (err) {
    console.warn('[compress-image] Compression failed, using original:', err);
    return uri;
  }
}
