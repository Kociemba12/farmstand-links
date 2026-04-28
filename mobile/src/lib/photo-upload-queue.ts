import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = '@photo_upload_queue_v1';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface PendingUpload {
  /** Matches the tempId / PhotoItem.id used in UI state */
  tempId: string;
  /** Local device URI used for preview and retry */
  localUri: string;
  /** Real or temp farmstand ID */
  farmstandId: string;
  /** Pre-computed Supabase storage path — reused on retry to avoid duplicates */
  storagePath: string;
  bucket: string;
  addedAt: number;
  attempts: number;
}

async function readQueue(): Promise<PendingUpload[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as PendingUpload[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: PendingUpload[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.error('[photo-upload-queue] Write failed:', err);
  }
}

/** Returns all non-stale items (< 7 days old) */
export async function getQueue(): Promise<PendingUpload[]> {
  const queue = await readQueue();
  const cutoff = Date.now() - MAX_AGE_MS;
  return queue.filter((q) => q.addedAt > cutoff);
}

/** Returns pending items for a specific farmstand */
export async function getQueueForFarmstand(farmstandId: string): Promise<PendingUpload[]> {
  const queue = await getQueue();
  return queue.filter((q) => q.farmstandId === farmstandId);
}

/** Add or replace an item in the queue */
export async function addToQueue(item: PendingUpload): Promise<void> {
  const queue = await readQueue();
  const filtered = queue.filter((q) => q.tempId !== item.tempId);
  await writeQueue([...filtered, item]);
  console.log('[photo-upload-queue] Queued for retry:', item.tempId);
}

/** Remove a successfully uploaded item from the queue */
export async function removeFromQueue(tempId: string): Promise<void> {
  const queue = await readQueue();
  const next = queue.filter((q) => q.tempId !== tempId);
  if (next.length !== queue.length) {
    await writeQueue(next);
    console.log('[photo-upload-queue] Removed from queue:', tempId);
  }
}

/** Increment retry attempt count */
export async function incrementAttempts(tempId: string): Promise<void> {
  const queue = await readQueue();
  const updated = queue.map((q) =>
    q.tempId === tempId ? { ...q, attempts: q.attempts + 1 } : q
  );
  await writeQueue(updated);
}
