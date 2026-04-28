import 'dotenv/config';
import "@vibecodeapp/proxy"; // DO NOT REMOVE OTHERWISE VIBECODE PROXY WILL NOT WORK
import { serve } from '@hono/node-server';
import { Hono } from "hono";
import { cors } from "hono/cors";
import "./env";
import { sampleRouter } from "./routes/sample";
import { aiImageRouter } from "./routes/ai-image";
import { deleteAccountRouter } from "./routes/delete-account";
import { updateFarmstandRouter } from "./routes/update-farmstand";
import { deleteFarmstandRouter } from "./routes/delete-farmstand";
import { submitClaimRouter } from "./routes/submit-claim";
import { resubmitClaimRouter } from "./routes/resubmit-claim";
import { myClaimRouter } from "./routes/my-claim";
import { sendAlertRouter } from "./routes/send-alert";
import { adminClaimsRouter } from "./routes/admin-claims";
import { adminUsersRouter } from "./routes/admin-users";
import { approveClaimPushRouter } from "./routes/approve-claim-push";
import { claimPushDebugRouter } from "./routes/claim-push-debug";
import { feedbackRouter } from "./routes/feedback";
import { sendChatPushRouter } from "./routes/send-chat-push";
import { sendSavedStandPushRouter } from "./routes/send-saved-stand-push";
import { notifyStandUpdateRouter } from "./routes/notify-stand-update";
import { messagesRouter } from "./routes/messages";
import { ownerResponseRouter } from "./routes/owner-response";
import { favoritesRouter } from "./routes/favorites";
import { farmstandVisibilityRouter } from "./routes/farmstand-visibility";
import { uploadRouter } from "./routes/upload";
import { startTrialReminderScheduler } from "./lib/trial-reminder-scheduler";
import { supportRouter } from "./routes/support";
import { pushTokenRouter } from "./routes/push-token";
import { stockAlertRouter } from "./routes/stock-alert";
import { manualStockAlertRouter } from "./routes/manual-stock-alert";
import { activatePremiumRouter } from "./routes/activate-premium";
import { myPendingClaimsRouter } from "./routes/my-pending-claims";
import { notifyNewFarmstandRouter } from "./routes/notify-new-farmstand";
import { logger } from "hono/logger";

const app = new Hono();

// CORS middleware - validates origin against allowlist
const allowed = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.dev\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.run$/,
];

app.use(
  "*",
  cors({
    origin: (origin) => (origin && allowed.some((re) => re.test(origin)) ? origin : null),
    credentials: true,
  })
);

// Logging
app.use("*", logger());

// Health check endpoint
app.get("/health", (c) => c.json({ status: "ok" }));

// Apple Universal Links - App Site Association
app.get("/.well-known/apple-app-site-association", (c) => {
  return c.json({
    applinks: {
      apps: [],
      details: [
        {
          appID: "6W553F55SF.online.farmstand.app",
          paths: ["/stands/*", "/share/*", "*"],
        },
      ],
    },
  });
});

// Routes
app.route("/api/sample", sampleRouter);
app.route("/api/ai-image", aiImageRouter);
app.route("/api/delete-account", deleteAccountRouter);
app.route("/api/submit-claim", submitClaimRouter);
app.route("/api/resubmit-claim", resubmitClaimRouter);
app.route("/api/my-claim", myClaimRouter);
app.route("/api/send-alert", sendAlertRouter);
app.route("/api/admin", adminClaimsRouter);
app.route("/api/admin", adminUsersRouter);
app.route("/api/admin/approve-claim-push", approveClaimPushRouter);
app.route("/api/admin/claim-push-debug", claimPushDebugRouter);
app.route("/api/update-farmstand", updateFarmstandRouter);
app.route("/api/delete-farmstand", deleteFarmstandRouter);
app.route("/api/feedback", feedbackRouter);
app.route("/api/send-chat-push", sendChatPushRouter);
app.route("/api/send-saved-stand-push", sendSavedStandPushRouter);
app.route("/api/notify-stand-update", notifyStandUpdateRouter);
app.route("/api/messages", messagesRouter);
app.route("/api/owner-response", ownerResponseRouter);
app.route("/api/favorites", favoritesRouter);
app.route("/api/farmstand-visibility", farmstandVisibilityRouter);
app.route("/api/upload", uploadRouter);
app.route("/api/support-tickets", supportRouter);
app.route("/api/push", pushTokenRouter);
app.route("/api/stock-alert", stockAlertRouter);
app.route("/api/manual-stock-alert", manualStockAlertRouter);
app.route("/api/activate-premium", activatePremiumRouter);
app.route("/api/my-pending-claims", myPendingClaimsRouter);
app.route("/api/notify-new-farmstand", notifyNewFarmstandRouter);

const port = Number(process.env.PORT) || 3000;

// Start background schedulers
startTrialReminderScheduler();

serve({ fetch: app.fetch, port });
console.log(`Backend running on http://localhost:${port}`);
