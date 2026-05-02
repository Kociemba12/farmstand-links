import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { getValidSession, supabase, uploadToSupabaseStorage, SupabaseQueryBuilder, type SupabaseError } from './supabase';
import { useUserStore } from './user-store';

const BACKEND_URL = (process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL ?? '').replace(/\/$/, '');
export const SUPPORT_BUCKET = 'support-screenshots';

/**
 * Upload one feedback screenshot to Supabase Storage.
 * Converts HEIC/HEIF and other formats to JPEG before upload (same pattern as claim photos).
 * Returns the public URL. Throws on failure.
 */
export async function uploadFeedbackPhoto(
  userId: string,
  photoIndex: number,
  uri: string,
  mimeType: string,
): Promise<string> {
  // Convert and compress to JPEG — handles HEIC/HEIF and oversized files
  if (__DEV__) console.log('[SupportAPI] uploadFeedbackPhoto', photoIndex, '— converting to JPEG (max 1600px, quality 0.82) | originalMime:', mimeType, '| uri:', uri.slice(0, 60));
  const compressed = await manipulateAsync(
    uri,
    [{ resize: { width: 1600 } }],
    { compress: 0.82, format: SaveFormat.JPEG },
  );
  if (__DEV__) console.log('[SupportAPI] uploadFeedbackPhoto', photoIndex, '— converted | dims:', compressed.width, 'x', compressed.height, '| uri:', compressed.uri.slice(0, 60));

  const filePath = `support/${userId}/${Date.now()}-${photoIndex}.jpg`;
  if (__DEV__) console.log('[SupportAPI] uploadFeedbackPhoto', photoIndex, '— bucket:', SUPPORT_BUCKET, '| path:', filePath, '| mime: image/jpeg');

  const { url, error } = await uploadToSupabaseStorage(SUPPORT_BUCKET, filePath, compressed.uri, 'image/jpeg');
  if (error || !url) {
    if (__DEV__) {
      const sbErr = error as (SupabaseError & { code?: string; details?: string }) | null;
      console.warn(
        '[SupportAPI] uploadFeedbackPhoto storage error',
        '| bucket:', SUPPORT_BUCKET,
        '| path:', filePath,
        '| mime: image/jpeg',
        '| code:', sbErr?.code ?? 'N/A',
        '| message:', sbErr?.message ?? 'no URL returned',
        '| details:', sbErr?.details ?? 'N/A',
      );
    }
    throw error ?? new Error('Upload returned no URL');
  }
  return url;
}

/**
 * Submit a support/feedback ticket directly via Supabase RPC.
 * Does NOT use the backend service. Requires the submit_feedback RPC to be
 * deployed (see mobile/supabase-submit-feedback-rpc.sql).
 */
export async function submitFeedback(data: {
  userId: string;
  userEmail: string;
  userName?: string | null;
  rating?: number | null;
  category: string;
  message: string;
  sourceScreen?: string;
  screenshotUrls?: string[];
}): Promise<{ success: boolean; id?: string; error?: string }> {
  if (__DEV__) {
    console.log('[SupportAPI] submitFeedback — userId:', data.userId ?? 'MISSING');
    console.log('[SupportAPI] submitFeedback — category:', data.category);
    console.log('[SupportAPI] submitFeedback — messageLength:', data.message.length);
    console.log('[SupportAPI] submitFeedback — photoCount:', data.screenshotUrls?.length ?? 0);
    console.log('[SupportAPI] submitFeedback — path: submit_feedback RPC');
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc<{ success: boolean; id?: string; error?: string }>(
    'submit_feedback',
    {
      p_user_id:         data.userId,
      p_user_email:      data.userEmail,
      p_user_name:       data.userName ?? null,
      p_rating:          data.rating ?? null,
      p_category:        data.category,
      p_message:         data.message,
      p_source_screen:   data.sourceScreen ?? 'support',
      p_screenshot_urls: data.screenshotUrls ?? [],
    },
  );

  if (rpcError) {
    if (__DEV__) console.warn('[SupportAPI] submitFeedback RPC error:', rpcError);
    return { success: false, error: rpcError.message };
  }

  if (__DEV__) {
    console.log('[SupportAPI] submitFeedback — inserted id:', rpcData?.id ?? 'none');
    console.log('[SupportAPI] submitFeedback — p_user_id sent:', data.userId ?? 'MISSING');
    console.log('[SupportAPI] submitFeedback result:', rpcData);
  }
  return rpcData ?? { success: false, error: 'No response from server' };
}

export type TicketStatus =
  | 'open'
  | 'waiting_on_admin'
  | 'waiting_on_farmer'
  | 'resolved'
  | 'reopened';

export interface SupportTicket {
  id: string;
  feedbackId: string; // same as id — explicit alias for the Supabase feedback.id UUID
  user_id: string;
  user_email: string;
  subject: string;
  category: string;
  message: string;
  status: TicketStatus;
  rating: number | null;
  screenshot_urls: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface SupportMessage {
  id: string;
  ticket_id: string;
  sender_role: 'farmer' | 'admin';
  sender_user_id: string;
  sender_email: string;
  message_text: string;
  created_at: string;
  is_visible_to_farmer: number;
  attachment_urls?: string[] | null;
}

async function authHeaders(): Promise<Record<string, string>> {
  const session = await getValidSession();
  if (!session) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

/** Create a new support ticket. */
export async function createSupportTicket(data: {
  subject: string;
  category: string;
  message: string;
  rating?: number | null;
  screenshot_urls?: string[] | null;
}): Promise<SupportTicket> {
  const headers = await authHeaders();
  const resp = await fetch(`${BACKEND_URL}/api/support-tickets`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  const ct0 = resp.headers.get('content-type') ?? '';
  if (!ct0.includes('application/json')) {
    console.log('[SupportAPI] createSupportTicket non-JSON response (HTTP', resp.status, '), content-type:', ct0);
    throw new Error(`Unexpected response from server (HTTP ${resp.status})`);
  }
  const json = (await resp.json()) as { success: boolean; data?: SupportTicket; error?: string };
  if (!json.success || !json.data) throw new Error(json.error ?? 'Failed to create ticket');
  return json.data;
}

/** Fetch all tickets for the current user via SECURITY DEFINER RPC. */
export async function fetchSupportTickets(): Promise<SupportTicket[]> {
  if (__DEV__) console.log('[SupportAPI] fetchSupportTickets — path: get_my_tickets RPC');

  const { data: rpcData, error } = await supabase.rpc<{ success: boolean; data?: Array<Record<string, unknown>>; error?: string }>(
    'get_my_tickets',
  );

  console.log('[SupportAPI] get_my_tickets rpc error:', error);
  console.log('[SupportAPI] get_my_tickets rpc data:', JSON.stringify(rpcData));

  if (error) {
    if (__DEV__) console.warn('[SupportAPI] fetchSupportTickets RPC error:', error.message, error);
    throw error;
  }

  if (!rpcData?.success) {
    if (__DEV__) console.warn('[SupportAPI] fetchSupportTickets RPC returned failure:', rpcData?.error);
    if (rpcData?.error === 'Unauthorized') return [];
    throw new Error(rpcData?.error ?? 'Failed to fetch tickets');
  }

  const rows = rpcData.data ?? [];
  if (__DEV__) {
    console.log('[SupportAPI] fetchSupportTickets — raw rows returned:', rows.length);
    rows.forEach(row => console.log('[SupportAPI] raw row — id:', row.id, '| source_screen:', row.source_screen ?? 'N/A', '| status:', row.status));
  }

  // Client-side guard: get_my_tickets does not filter by source_screen, so exclude dismissed rows here.
  const activeRows = rows.filter(row => row.source_screen !== 'support_dismissed');
  if (__DEV__ && activeRows.length !== rows.length) {
    console.log('[SupportAPI] fetchSupportTickets — filtered out', rows.length - activeRows.length, 'dismissed ticket(s)');
  }

  return activeRows.map((row): SupportTicket => {
    const msg = (row.message as string) ?? '';
    return {
      id:              row.id as string,
      feedbackId:      row.id as string,
      user_id:         row.user_id as string,
      user_email:      row.user_email as string,
      subject:         msg.length > 60 ? msg.slice(0, 60) + '…' : msg,
      category:        (row.category as string) ?? 'General Feedback',
      message:         msg,
      status:          ((row.status as string) === 'new' ? 'open' : (row.status as string)) as TicketStatus,
      rating:          (row.rating as number | null) ?? null,
      screenshot_urls: Array.isArray(row.screenshot_urls) && (row.screenshot_urls as string[]).length > 0
        ? (row.screenshot_urls as string[]).join(', ')
        : null,
      created_at:  row.created_at as string,
      updated_at:  ((row.updated_at as string | undefined) ?? (row.created_at as string)),
      deleted_at:  (row.deleted_at as string | null | undefined) ?? null,
    };
  });
}

/** Fetch a single ticket by id via the already-deployed get_my_tickets RPC. */
export async function fetchSupportTicket(id: string): Promise<SupportTicket> {
  if (__DEV__) console.log('[SupportAPI] fetchSupportTicket — id:', id);
  const tickets = await fetchSupportTickets();
  const ticket = tickets.find(t => t.id === id);
  if (!ticket) throw new Error('Ticket not found');
  return ticket;
}

/** Soft-delete a ticket (sets source_screen = 'support_dismissed' on the feedback table). */
export async function deleteSupportTicket(id: string): Promise<void> {
  if (__DEV__) console.log('[SupportAPI] deleteSupportTicket — id:', id, '| table: feedback');

  // Primary: backend API — in its own try/catch so network errors fall through to Supabase
  if (BACKEND_URL) {
    try {
      const headers = await authHeaders();
      const resp = await fetch(`${BACKEND_URL}/api/support-tickets/${id}`, {
        method: 'DELETE',
        headers,
      });
      if (__DEV__) console.log('[SupportAPI] deleteSupportTicket backend response:', resp.status);
      const ct3 = resp.headers.get('content-type') ?? '';
      if (resp.ok && ct3.includes('application/json')) {
        const json = (await resp.json()) as { success: boolean; error?: string };
        if (__DEV__) console.log('[SupportAPI] deleteSupportTicket backend body:', JSON.stringify(json));
        if (json.success) return;
        if (__DEV__) console.warn('[SupportAPI] deleteSupportTicket backend returned failure:', json.error);
      } else {
        if (__DEV__) console.warn('[SupportAPI] deleteSupportTicket backend non-JSON or error status:', resp.status);
      }
    } catch (backendErr) {
      if (__DEV__) console.warn('[SupportAPI] deleteSupportTicket backend exception (falling back to Supabase):', backendErr);
    }
  } else {
    if (__DEV__) console.log('[SupportAPI] deleteSupportTicket — no BACKEND_URL, using Supabase directly');
  }

  // Fallback: authenticated Supabase soft-delete (source_screen → 'support_dismissed').
  // NOTE: get_my_tickets RPC does NOT filter by source_screen — fetchSupportTickets
  // applies a client-side filter to exclude dismissed rows after refresh.
  if (__DEV__) console.log('[SupportAPI] deleteSupportTicket — Supabase fallback for id:', id);
  const { data, error } = await supabase
    .from<Record<string, unknown>>('feedback')
    .update({ source_screen: 'support_dismissed' })
    .eq('id', id)
    .select('id, source_screen')
    .requireAuth()
    .execute();
  if (__DEV__) {
    console.log('[SupportAPI] deleteSupportTicket Supabase error:', error?.message ?? 'none', '| code:', (error as SupabaseError | null)?.code ?? 'none', '| details:', (error as SupabaseError | null)?.details ?? 'none');
    console.log('[SupportAPI] deleteSupportTicket Supabase rows updated:', data?.length ?? 0, '| data:', JSON.stringify(data));
  }
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(`Delete failed: 0 rows updated for feedback id=${id} — RLS may have blocked the update or row not found`);
  }
}

/** Fetch messages for a ticket. Synthesises the initial farmer message, then appends admin replies from feedback_messages. */
export async function fetchTicketMessages(ticketId: string): Promise<SupportMessage[]> {
  if (__DEV__) console.log('[SupportAPI] fetchTicketMessages — ticketId:', ticketId);
  const ticket = await fetchSupportTicket(ticketId);
  // Reconstruct attachment URLs from the comma-joined string stored in SupportTicket
  const attachmentUrls = ticket.screenshot_urls
    ? ticket.screenshot_urls.split(', ').filter(Boolean)
    : null;
  const initialMessage: SupportMessage = {
    id:                 `${ticketId}-0`,
    ticket_id:          ticketId,
    sender_role:        'farmer',
    sender_user_id:     ticket.user_id,
    sender_email:       ticket.user_email,
    message_text:       ticket.message,
    created_at:         ticket.created_at,
    is_visible_to_farmer: 1,
    attachment_urls:    attachmentUrls && attachmentUrls.length > 0 ? attachmentUrls : null,
  };
  if (__DEV__) console.log('[SupportAPI] fetchTicketMessages — synthesised initial message from ticket row');

  // Fetch admin (and farmer) replies from feedback_messages table.
  // RLS allows authenticated users to read messages for tickets they own.
  let replyMessages: SupportMessage[] = [];
  try {
    if (__DEV__) console.log('[SupportAPI] fetchTicketMessages — fetching replies from feedback_messages | feedback_id:', ticketId);
    const { data: replies, error: repliesError } = await supabase
      .from<{
        id: string;
        feedback_id: string;
        sender_role: 'admin' | 'farmer';
        sender_user_id: string | null;
        sender_email: string | null;
        message_text: string;
        attachment_urls: string[] | null;
        is_visible_to_farmer: boolean;
        created_at: string;
      }>('feedback_messages')
      .select('*')
      .eq('feedback_id', ticketId)
      .order('created_at', { ascending: true })
      .requireAuth()
      .execute();

    if (repliesError) {
      const sbErr = repliesError as SupabaseError;
      if (__DEV__) console.warn('[SupportAPI] fetchTicketMessages replies error | code:', sbErr.code ?? 'N/A', '| message:', sbErr.message, '| details:', sbErr.details ?? 'N/A');
    } else {
      if (__DEV__) console.log('[SupportAPI] fetchTicketMessages — reply count:', replies?.length ?? 0);
      replyMessages = (replies ?? [])
        .filter(r => r.is_visible_to_farmer)
        .map(r => ({
          id:                   r.id,
          ticket_id:            ticketId,
          sender_role:          r.sender_role,
          sender_user_id:       r.sender_user_id ?? '',
          sender_email:         r.sender_email ?? '',
          message_text:         r.message_text,
          created_at:           r.created_at,
          is_visible_to_farmer: 1,
          attachment_urls:      (r.attachment_urls?.length ?? 0) > 0 ? r.attachment_urls : null,
        }));
    }
  } catch (err) {
    if (__DEV__) console.warn('[SupportAPI] fetchTicketMessages replies fetch exception:', err instanceof Error ? err.message : String(err));
  }

  return [initialMessage, ...replyMessages];
}

/** Send a farmer reply on a ticket, optionally with photo URLs. */
export async function sendTicketMessage(
  ticketId: string,
  messageText: string,
  attachmentUrls?: string[] | null,
): Promise<SupportMessage> {
  if (__DEV__) {
    const uid = useUserStore.getState().user?.id ?? '(unknown)';
    console.log('[SupportAPI] sendTicketMessage — ticketId:', ticketId, '| userId:', uid, '| hasText:', !!messageText.trim(), '| attachments:', attachmentUrls?.length ?? 0);
  }

  // Primary: backend API — in its own try/catch so network errors fall through
  if (BACKEND_URL) {
    try {
      const headers = await authHeaders();
      const resp = await fetch(`${BACKEND_URL}/api/support-tickets/${ticketId}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message_text: messageText,
          attachment_urls: attachmentUrls ?? null,
        }),
      });
      if (__DEV__) console.log('[SupportAPI] sendTicketMessage backend response:', resp.status);
      const ct5 = resp.headers.get('content-type') ?? '';
      if (resp.ok && ct5.includes('application/json')) {
        const json = (await resp.json()) as { success: boolean; data?: SupportMessage; error?: string };
        if (__DEV__) console.log('[SupportAPI] sendTicketMessage backend body:', JSON.stringify(json));
        if (json.success && json.data) return json.data;
        if (__DEV__) console.warn('[SupportAPI] sendTicketMessage backend returned failure:', json.error);
      } else {
        if (__DEV__) console.warn('[SupportAPI] sendTicketMessage backend non-JSON or error status:', resp.status);
      }
    } catch (backendErr) {
      if (__DEV__) console.warn('[SupportAPI] sendTicketMessage backend exception (falling back to Supabase):', backendErr);
    }
  } else {
    if (__DEV__) console.log('[SupportAPI] sendTicketMessage — no BACKEND_URL, using Supabase directly');
  }

  // Fallback: update the feedback row status in Supabase + return a synthetic message.
  // The backend stores reply text in SQLite (unreachable from iOS); we update the ticket
  // status to 'read' (= waiting_on_admin) and handled_at, matching the backend's own update.
  // The returned message is a synthetic object for the current session UI — it is not persisted.
  if (__DEV__) console.log('[SupportAPI] sendTicketMessage — Supabase fallback, table: feedback, ticketId:', ticketId);

  const session = await getValidSession();
  if (!session?.access_token) throw new Error('Not authenticated');

  const user = useUserStore.getState().user;
  const userId = user?.id ?? '';
  const userEmail = user?.email ?? '';
  if (__DEV__) console.log('[SupportAPI] sendTicketMessage — fallback userId:', userId || '(unknown)');

  const now = new Date().toISOString();
  const { data: updateData, error: updateError } = await supabase
    .from<Record<string, unknown>>('feedback')
    .update({ status: 'read', handled_at: now })
    .eq('id', ticketId)
    .requireAuth()
    .execute();

  if (__DEV__) {
    console.log('[SupportAPI] sendTicketMessage Supabase error:', updateError?.message ?? 'none', '| code:', (updateError as SupabaseError | null)?.code ?? 'none', '| details:', (updateError as SupabaseError | null)?.details ?? 'none');
    console.log('[SupportAPI] sendTicketMessage Supabase rows updated:', updateData?.length ?? 0, '| data:', JSON.stringify(updateData));
  }

  if (updateError) throw updateError;

  // Return a synthetic SupportMessage so the UI shows the reply immediately.
  return {
    id: `${ticketId}-${Date.now()}`,
    ticket_id: ticketId,
    sender_role: 'farmer',
    sender_user_id: userId,
    sender_email: userEmail,
    message_text: messageText,
    created_at: now,
    is_visible_to_farmer: 1,
    attachment_urls: attachmentUrls ?? null,
  };
}

/** Get the count of unread admin replies and the affected ticket IDs. */
export async function fetchUnreadSupportCount(): Promise<{ count: number; ticketIds: string[] }> {
  try {
    const { data, error } = await supabase.rpc<{ count: number; ticket_ids: string[] }>(
      'get_unread_support_info',
    );
    if (error) {
      if (__DEV__) console.warn('[SupportAPI] fetchUnreadSupportCount RPC error | code:', (error as SupabaseError).code ?? 'N/A', '| message:', error.message);
      return { count: 0, ticketIds: [] };
    }
    const count = data?.count ?? 0;
    const ticketIds = data?.ticket_ids ?? [];
    if (__DEV__) console.log('[SupportAPI] fetchUnreadSupportCount — count:', count, '| ticketIds:', ticketIds);
    return { count, ticketIds };
  } catch (err) {
    if (__DEV__) console.warn('[SupportAPI] fetchUnreadSupportCount exception:', err instanceof Error ? err.message : String(err));
    return { count: 0, ticketIds: [] };
  }
}

/** Stamp last_user_read_at = now() on the ticket so the badge clears. */
export async function markSupportTicketRead(ticketId: string): Promise<void> {
  try {
    const { data, error } = await supabase.rpc<{ success: boolean; error?: string }>(
      'mark_support_ticket_read',
      { p_ticket_id: ticketId },
    );
    if (error) {
      if (__DEV__) console.warn('[SupportAPI] markSupportTicketRead RPC error | ticketId:', ticketId, '| code:', (error as SupabaseError).code ?? 'N/A', '| message:', error.message);
    } else if (data && !data.success) {
      if (__DEV__) console.warn('[SupportAPI] markSupportTicketRead — ticketId:', ticketId, '| error:', data.error ?? 'unknown');
    } else {
      if (__DEV__) console.log('[SupportAPI] markSupportTicketRead — ticketId:', ticketId, '— ok');
    }
  } catch (err) {
    if (__DEV__) console.warn('[SupportAPI] markSupportTicketRead exception:', err instanceof Error ? err.message : String(err));
    // Non-fatal — badge self-corrects on next fetch
  }
}
