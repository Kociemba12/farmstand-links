const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM = 'Farmstand <noreply@farmstand.online>';
const TO = ['contact@farmstand.online'];
const REPLY_TO = 'contact@farmstand.online';

type EventData = Record<string, unknown>;

function str(v: unknown): string {
  return v ? String(v) : '';
}

function tableRow(label: string, value: unknown): string {
  const val = str(value);
  if (!val) return '';
  return `<tr>
    <td style="padding:10px 20px;background:#f9fafb;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;vertical-align:top;border-bottom:1px solid #f3f4f6;">${label}</td>
    <td style="padding:10px 20px;font-size:14px;color:#111827;border-bottom:1px solid #f3f4f6;word-break:break-word;">${val}</td>
  </tr>`;
}

function emailLayout(
  title: string,
  badge: string,
  accentColor: string,
  tableRows: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:40px auto 40px;padding:0 16px;">
    <!-- Header -->
    <div style="background:${accentColor};border-radius:12px 12px 0 0;padding:28px 32px 24px;">
      <div style="display:inline-block;background:rgba(255,255,255,0.25);color:#ffffff;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:4px 12px;border-radius:100px;margin-bottom:12px;">${badge}</div>
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;line-height:1.3;">${title}</h1>
    </div>
    <!-- Body -->
    <div style="background:#ffffff;border-radius:0 0 12px 12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        ${tableRows}
      </table>
      <!-- Footer -->
      <div style="padding:20px 24px;background:#f9fafb;border-top:1px solid #f3f4f6;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">
          Farmstand Admin Notification &mdash;
          <a href="https://farmstand.online" style="color:#6b7280;text-decoration:none;">farmstand.online</a>
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function buildEmail(type: string, data: EventData): { subject: string; html: string } | null {
  switch (type) {
    case 'farmstand_submitted': {
      const name = str(data.name) || 'Not provided';
      const id = str(data.id);
      const address = str(data.address) || 'Not provided';
      const submitterEmail = str(data.submitter_email) || 'Not provided';
      const products = str(data.products) || 'Not provided';
      const photos = str(data.photos);
      const submittedAt = str(data.submitted_at) || 'Not provided';

      const rows = [
        tableRow('Farmstand', name),
        tableRow('Submitted by', submitterEmail),
        tableRow('Location', address),
        tableRow('Products', products),
        tableRow('Photos', photos),
        tableRow('Submitted', submittedAt),
        tableRow('Farmstand ID', id),
        tableRow('Next Step', 'Review this submission in the Farmstand admin dashboard.'),
      ].join('');

      return {
        subject: `New Farmstand Submitted: ${name}`,
        html: emailLayout(`New Farmstand Submitted: ${name}`, 'New Submission', '#16a34a', rows),
      };
    }

    case 'claim_requested': {
      const farmstandName = str(data.farmstand_name) || 'Not provided';
      const farmstandId = str(data.farmstand_id);
      const requesterName = str(data.requester_name);
      const requesterEmail = str(data.requester_email) || 'Not provided';
      const notes = str(data.notes);
      const attachmentInfo = str(data.attachment_info);
      const submittedAt = str(data.submitted_at) || 'Not provided';

      const rows = [
        tableRow('Farmstand', farmstandName),
        tableRow('Claimant name', requesterName),
        tableRow('Claimant email', requesterEmail),
        tableRow('Claim details', notes),
        tableRow('Attachments', attachmentInfo),
        tableRow('Submitted', submittedAt),
        tableRow('Farmstand ID', farmstandId),
        tableRow('Next Step', 'Review this claim in the Farmstand admin dashboard.'),
      ].join('');

      return {
        subject: `New Farmstand Claim: ${farmstandName}`,
        html: emailLayout(`New Farmstand Claim: ${farmstandName}`, 'Ownership Claim', '#d97706', rows),
      };
    }

    case 'support_ticket_submitted': {
      const ticketId = str(data.ticket_id);
      const subject = str(data.subject) || str(data.category) || 'No subject provided.';
      const message = str(data.message) || 'No message provided.';
      const userId = str(data.user_id);
      const userEmail = str(data.user_email) || 'Unknown user.';
      const attachmentInfo = str(data.attachment_info);
      const sourceScreen = str(data.source_screen);
      const submittedAt = str(data.submitted_at);

      const rows = [
        tableRow('User Email', userEmail),
        tableRow('Category', subject),
        tableRow('Source', sourceScreen),
        tableRow('Message', message),
        tableRow('Attachments', attachmentInfo),
        tableRow('Submitted', submittedAt),
        tableRow('User ID', userId),
        tableRow('Ticket ID', ticketId),
        tableRow('Next Step', 'Respond from the Feedback &amp; Support section in the admin dashboard.'),
      ].join('');

      return {
        subject: `New Support Ticket: ${subject}`,
        html: emailLayout(`New Support Ticket: ${subject}`, 'Support Ticket', '#2563eb', rows),
      };
    }

    default:
      return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as { type?: string; data?: EventData };
    const { type, data = {} } = body;

    if (!type) {
      return new Response(JSON.stringify({ error: 'Missing type' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const email = buildEmail(type, data);
    if (!email) {
      return new Response(JSON.stringify({ error: `Unknown event type: ${type}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!RESEND_API_KEY) {
      console.error('[hyper-worker] RESEND_API_KEY is not set in Supabase secrets');
      return new Response(JSON.stringify({ error: 'Email service not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM,
        to: TO,
        reply_to: REPLY_TO,
        subject: email.subject,
        html: email.html,
      }),
    });

    const sendData = await sendResp.json();
    console.log(`[hyper-worker] type=${type} resend_status=${sendResp.status}`, sendData);

    return new Response(JSON.stringify(sendData), {
      status: sendResp.ok ? 200 : 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[hyper-worker] Unexpected error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
