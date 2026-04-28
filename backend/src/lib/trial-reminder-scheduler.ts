/**
 * Trial Reminder Scheduler
 *
 * Runs on a daily interval and sends in-app alerts + push notifications
 * to farmstand owners before their Premium trial expires.
 *
 * Reminder milestones (days before expiry): 14, 7, 3, 1, 0
 *
 * Each milestone is sent at most once per farmstand, tracked via the
 * `trial_reminder_log` table.  If that table doesn't exist yet, run
 * supabase-trial-reminders.sql in the Supabase SQL Editor first.
 */

import { insertAlert } from "./alert-inserter";
import { sendPushToUser } from "./push-sender";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Milestones (in days before expiry) to send reminders at.
const REMINDER_MILESTONES = [14, 7, 3, 1, 0] as const;

// How often to run the check (24 hours)
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

// ── Content helpers ───────────────────────────────────────────

function getReminderContent(daysBefore: number): { title: string; body: string } {
  if (daysBefore === 0) {
    return {
      title: "Your Premium trial has ended",
      body: "Your Premium trial has ended. Continue Premium for $4.99/month.",
    };
  }
  if (daysBefore === 1) {
    return {
      title: "Your Premium trial ends tomorrow",
      body: "Your Premium trial ends tomorrow.",
    };
  }
  return {
    title: `Your Premium trial ends in ${daysBefore} days`,
    body: `Your Premium trial ends in ${daysBefore} days.`,
  };
}

// ── Supabase helpers ──────────────────────────────────────────

interface TrialFarmstand {
  id: string;
  owner_id: string;
  premium_trial_expires_at: string;
}

async function fetchActiveTrials(): Promise<TrialFarmstand[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return [];

  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/farmstands`);
    url.searchParams.set("select", "id,owner_id,premium_trial_expires_at");
    url.searchParams.set("premium_status", "eq.trial");
    url.searchParams.set("premium_trial_expires_at", "not.is.null");
    url.searchParams.set("owner_id", "not.is.null");

    const response = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const err = await response.text();
      console.log("[TrialReminder] Failed to fetch active trials:", response.status, err);
      return [];
    }

    const rows = (await response.json()) as TrialFarmstand[];
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.log("[TrialReminder] Exception fetching active trials:", err);
    return [];
  }
}

/**
 * Returns true if this reminder milestone has already been sent for the farmstand.
 * Returns true on error (table missing / unknown) to prevent spam.
 */
async function hasReminderBeenSent(
  farmstandId: string,
  daysBefore: number
): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return true;

  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/trial_reminder_log`);
    url.searchParams.set("select", "id");
    url.searchParams.set("farmstand_id", `eq.${farmstandId}`);
    url.searchParams.set("days_before", `eq.${daysBefore}`);
    url.searchParams.set("limit", "1");

    const response = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      if (errText.includes("does not exist")) {
        console.log(
          "[TrialReminder] trial_reminder_log table not found. " +
            "Run supabase-trial-reminders.sql in the Supabase SQL Editor to enable reminders."
        );
      } else {
        console.log("[TrialReminder] Error checking reminder log:", response.status, errText);
      }
      // Treat as "already sent" to prevent untracked spam
      return true;
    }

    const rows = (await response.json()) as unknown[];
    return Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    console.log("[TrialReminder] Exception checking reminder log:", err);
    return true;
  }
}

async function logReminderSent(
  farmstandId: string,
  userId: string,
  daysBefore: number
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/trial_reminder_log`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        farmstand_id: farmstandId,
        user_id: userId,
        days_before: daysBefore,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      // Ignore duplicate-key errors (unique constraint) — reminder was already logged
      if (!err.includes("duplicate key") && !err.includes("23505")) {
        console.log("[TrialReminder] Failed to log reminder:", response.status, err);
      }
    } else {
      console.log(
        `[TrialReminder] Logged ${daysBefore}d reminder for farmstand ${farmstandId}`
      );
    }
  } catch (err) {
    console.log("[TrialReminder] Exception logging reminder:", err);
  }
}

// ── Core check ────────────────────────────────────────────────

async function runTrialReminderCheck(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.log("[TrialReminder] Supabase not configured — skipping check");
    return;
  }

  console.log("[TrialReminder] Running trial expiry check…");

  const farmstands = await fetchActiveTrials();
  if (farmstands.length === 0) {
    console.log("[TrialReminder] No active trials found");
    return;
  }

  console.log(`[TrialReminder] Checking ${farmstands.length} active trial(s)`);

  const now = Date.now();

  for (const farmstand of farmstands) {
    const { id: farmstandId, owner_id: userId, premium_trial_expires_at: expiresAt } = farmstand;
    if (!userId || !expiresAt) continue;

    const expiryMs = new Date(expiresAt).getTime();
    if (isNaN(expiryMs)) {
      console.log(`[TrialReminder] Invalid expiry date for farmstand ${farmstandId}: ${expiresAt}`);
      continue;
    }

    const diffMs = expiryMs - now;
    // daysRemaining: positive = future, negative = past
    const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    for (const milestone of REMINDER_MILESTONES) {
      // Only fire when we're at or past this milestone (daysRemaining <= milestone)
      // but not more than 2 days past it (avoids catch-up spam for very old milestones)
      if (daysRemaining > milestone) continue;
      if (daysRemaining < milestone - 2) continue;

      // Special case: 0-day milestone requires trial to actually be expired (daysRemaining <= 0)
      if (milestone === 0 && daysRemaining > 0) continue;

      const alreadySent = await hasReminderBeenSent(farmstandId, milestone);
      if (alreadySent) continue;

      const { title, body } = getReminderContent(milestone);
      const actionParams: Record<string, unknown> = { farmstandId };

      // 1. Create in-app alert
      await insertAlert({
        user_id: userId,
        title,
        body,
        related_farmstand_id: farmstandId,
        action_route: "owner/premium",
        action_params: actionParams,
      });

      // 2. Send push notification
      await sendPushToUser(userId, title, body, {
        route: "owner/premium",
        farmstandId,
      });

      // 3. Log so we never send this milestone again
      await logReminderSent(farmstandId, userId, milestone);

      console.log(
        `[TrialReminder] Sent ${milestone}d reminder to user ${userId} for farmstand ${farmstandId}`
      );
    }
  }

  console.log("[TrialReminder] Check complete");
}

// ── Public API ────────────────────────────────────────────────

/**
 * Start the daily trial reminder scheduler.
 * Runs immediately on startup, then every 24 hours.
 */
export function startTrialReminderScheduler(): void {
  console.log(
    `[TrialReminder] Scheduler started — milestones: ${REMINDER_MILESTONES.join(", ")} days before expiry`
  );

  // Run once on startup so we don't miss anything during a server restart
  runTrialReminderCheck().catch((err) => {
    console.log("[TrialReminder] Error during startup check:", err);
  });

  // Then run every 24 hours
  setInterval(() => {
    runTrialReminderCheck().catch((err) => {
      console.log("[TrialReminder] Error during scheduled check:", err);
    });
  }, CHECK_INTERVAL_MS);
}
