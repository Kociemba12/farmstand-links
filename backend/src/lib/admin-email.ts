const ADMIN_EMAIL = "contact@farmstand.online";
const FROM_EMAIL = "Farmstand Alerts <alerts@farmstand.online>";
const FROM_NOREPLY = "Farmstand <noreply@farmstand.online>";

export async function sendAdminEmail(subject: string, body: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[AdminEmail] RESEND_API_KEY not set — skipping admin email");
    return;
  }
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: [ADMIN_EMAIL], subject, text: body }),
    });
    if (!resp.ok) {
      console.error("[AdminEmail] Resend error:", resp.status, await resp.text());
    } else {
      console.log("[AdminEmail] Sent:", subject);
    }
  } catch (err) {
    console.error("[AdminEmail] Failed to send:", err);
  }
}

function str(v: unknown): string {
  return v ? String(v) : '';
}

function tableRow(label: string, value: string): string {
  if (!value) return '';
  return `<tr>
    <td style="padding:10px 20px;background:#f9fafb;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;vertical-align:top;border-bottom:1px solid #f3f4f6;">${label}</td>
    <td style="padding:10px 20px;font-size:14px;color:#111827;border-bottom:1px solid #f3f4f6;word-break:break-word;">${value}</td>
  </tr>`;
}

export async function sendSupportTicketEmail(params: {
  ticketId: string;
  category: string | null;
  message: string | null;
  userEmail: string | null;
  userId: string | null;
  screenshotUrls: string[] | null;
  submittedAt: string | null;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  console.log("[AdminEmail] sendSupportTicketEmail called — RESEND_API_KEY present:", !!apiKey);
  if (!apiKey) {
    console.warn("[AdminEmail] RESEND_API_KEY not set — skipping support ticket email");
    return;
  }

  const subject = str(params.category) ? `New Support Request: ${params.category}` : 'New Support Request';
  const photoUrls = params.screenshotUrls ?? [];

  const rows = [
    tableRow('User', str(params.userEmail) || 'Not provided'),
    tableRow('Category', str(params.category) || 'Not provided'),
    tableRow('Message', str(params.message) || 'Not provided'),
    ...photoUrls.map((url, i) => tableRow(photoUrls.length > 1 ? `Photo ${i + 1}` : 'Photo', `<a href="${url}" style="color:#2563eb;">${url}</a>`)),
    tableRow('Submitted', str(params.submittedAt) || new Date().toISOString()),
    tableRow('Ticket ID', str(params.ticketId)),
    tableRow('User ID', str(params.userId) || 'Not provided'),
    tableRow('Next Step', 'Respond from the Feedback &amp; Support section in the admin dashboard.'),
  ].join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:40px auto;padding:0 16px;">
    <div style="background:#2563eb;border-radius:12px 12px 0 0;padding:28px 32px 24px;">
      <div style="display:inline-block;background:rgba(255,255,255,0.25);color:#fff;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:4px 12px;border-radius:100px;margin-bottom:12px;">Support Ticket</div>
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;line-height:1.3;">${subject}</h1>
    </div>
    <div style="background:#fff;border-radius:0 0 12px 12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows}</table>
      <div style="padding:20px 24px;background:#f9fafb;border-top:1px solid #f3f4f6;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">Farmstand Admin Notification &mdash; <a href="https://farmstand.online" style="color:#6b7280;text-decoration:none;">farmstand.online</a></p>
      </div>
    </div>
  </div>
</body>
</html>`;

  try {
    console.log("[AdminEmail] Sending support ticket email via Resend to:", ADMIN_EMAIL);
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_NOREPLY,
        to: [ADMIN_EMAIL],
        reply_to: ADMIN_EMAIL,
        subject,
        html,
      }),
    });
    if (!resp.ok) {
      console.error("[AdminEmail] Support ticket email Resend error:", resp.status, await resp.text());
    } else {
      console.log("[AdminEmail] Support ticket email sent:", subject);
    }
  } catch (err) {
    console.error("[AdminEmail] Failed to send support ticket email:", err);
  }
}
