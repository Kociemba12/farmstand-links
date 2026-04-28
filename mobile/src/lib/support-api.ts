import { getValidSession } from './supabase';

const BACKEND_URL = (process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL ?? '').replace(/\/$/, '');

export type TicketStatus =
  | 'open'
  | 'waiting_on_admin'
  | 'waiting_on_farmer'
  | 'resolved'
  | 'reopened';

export interface SupportTicket {
  id: string;
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

/** Fetch all non-deleted tickets for the current user. */
export async function fetchSupportTickets(): Promise<SupportTicket[]> {
  const headers = await authHeaders();
  const resp = await fetch(`${BACKEND_URL}/api/support-tickets`, { headers });
  const ct1 = resp.headers.get('content-type') ?? '';
  if (!ct1.includes('application/json')) {
    console.log('[SupportAPI] fetchSupportTickets non-JSON response (HTTP', resp.status, '), content-type:', ct1);
    throw new Error(`Unexpected response from server (HTTP ${resp.status})`);
  }
  const json = (await resp.json()) as { success: boolean; data?: SupportTicket[]; error?: string };
  if (!json.success) throw new Error(json.error ?? 'Failed to fetch tickets');
  return json.data ?? [];
}

/** Fetch a single ticket by id. */
export async function fetchSupportTicket(id: string): Promise<SupportTicket> {
  const headers = await authHeaders();
  const resp = await fetch(`${BACKEND_URL}/api/support-tickets/${id}`, { headers });
  const ct2 = resp.headers.get('content-type') ?? '';
  if (!ct2.includes('application/json')) {
    console.log('[SupportAPI] fetchSupportTicket non-JSON response (HTTP', resp.status, '), content-type:', ct2);
    throw new Error(`Unexpected response from server (HTTP ${resp.status})`);
  }
  const json = (await resp.json()) as { success: boolean; data?: SupportTicket; error?: string };
  if (!json.success || !json.data) throw new Error(json.error ?? 'Ticket not found');
  return json.data;
}

/** Soft-delete a ticket. Throws if the backend returns an error. */
export async function deleteSupportTicket(id: string): Promise<void> {
  const headers = await authHeaders();
  const resp = await fetch(`${BACKEND_URL}/api/support-tickets/${id}`, {
    method: 'DELETE',
    headers,
  });
  const ct3 = resp.headers.get('content-type') ?? '';
  if (!ct3.includes('application/json')) {
    console.log('[SupportAPI] deleteSupportTicket non-JSON response (HTTP', resp.status, '), content-type:', ct3);
    throw new Error(`Unexpected response from server (HTTP ${resp.status})`);
  }
  const json = (await resp.json()) as { success: boolean; error?: string };
  if (!json.success) throw new Error(json.error ?? 'Failed to delete ticket');
}

/** Fetch all visible messages for a ticket. */
export async function fetchTicketMessages(ticketId: string): Promise<SupportMessage[]> {
  const headers = await authHeaders();
  const resp = await fetch(`${BACKEND_URL}/api/support-tickets/${ticketId}/messages`, { headers });
  const ct4 = resp.headers.get('content-type') ?? '';
  if (!ct4.includes('application/json')) {
    console.log('[SupportAPI] fetchTicketMessages non-JSON response (HTTP', resp.status, '), content-type:', ct4);
    throw new Error(`Unexpected response from server (HTTP ${resp.status})`);
  }
  const json = (await resp.json()) as { success: boolean; data?: SupportMessage[]; error?: string };
  if (!json.success) throw new Error(json.error ?? 'Failed to fetch messages');
  return json.data ?? [];
}

/** Send a farmer reply on a ticket, optionally with photo URLs. */
export async function sendTicketMessage(
  ticketId: string,
  messageText: string,
  attachmentUrls?: string[] | null,
): Promise<SupportMessage> {
  const headers = await authHeaders();
  const resp = await fetch(`${BACKEND_URL}/api/support-tickets/${ticketId}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message_text: messageText,
      attachment_urls: attachmentUrls ?? null,
    }),
  });
  const ct5 = resp.headers.get('content-type') ?? '';
  if (!ct5.includes('application/json')) {
    console.log('[SupportAPI] sendTicketMessage non-JSON response (HTTP', resp.status, '), content-type:', ct5);
    throw new Error(`Unexpected response from server (HTTP ${resp.status})`);
  }
  const json = (await resp.json()) as { success: boolean; data?: SupportMessage; error?: string };
  if (!json.success || !json.data) throw new Error(json.error ?? 'Failed to send message');
  return json.data;
}

/** Get the count of unread admin replies across all the user's tickets. */
export async function fetchUnreadSupportCount(): Promise<number> {
  try {
    const headers = await authHeaders();
    const resp = await fetch(`${BACKEND_URL}/api/support-tickets/unread-count`, { headers });
    const ct6 = resp.headers.get('content-type') ?? '';
    if (!ct6.includes('application/json')) {
      console.log('[SupportAPI] fetchUnreadSupportCount non-JSON response (HTTP', resp.status, '), content-type:', ct6);
      return 0;
    }
    const json = (await resp.json()) as { success: boolean; count?: number; error?: string };
    return json.success ? (json.count ?? 0) : 0;
  } catch {
    return 0;
  }
}

/** Mark all admin messages in a ticket as read by the user. */
export async function markSupportTicketRead(ticketId: string): Promise<void> {
  try {
    const headers = await authHeaders();
    await fetch(`${BACKEND_URL}/api/support-tickets/${ticketId}/mark-read`, {
      method: 'POST',
      headers,
    });
  } catch {
    // Non-fatal — badge will self-correct on next fetch
  }
}
