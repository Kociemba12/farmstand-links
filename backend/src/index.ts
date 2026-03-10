import "@vibecodeapp/proxy"; // DO NOT REMOVE OTHERWISE VIBECODE PROXY WILL NOT WORK
import { Hono } from "hono";
import { cors } from "hono/cors";
import "./env";
import { sampleRouter } from "./routes/sample";
import { aiImageRouter } from "./routes/ai-image";
import { deleteAccountRouter } from "./routes/delete-account";
import { updateFarmstandRouter } from "./routes/update-farmstand";
import { deleteFarmstandRouter } from "./routes/delete-farmstand";
import { submitClaimRouter } from "./routes/submit-claim";
import { sendAlertRouter } from "./routes/send-alert";
import { adminClaimsRouter } from "./routes/admin-claims";
import { feedbackRouter } from "./routes/feedback";
import { sendChatPushRouter } from "./routes/send-chat-push";
import { sendSavedStandPushRouter } from "./routes/send-saved-stand-push";
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
app.route("/api/send-alert", sendAlertRouter);
app.route("/api/admin", adminClaimsRouter);
app.route("/api/update-farmstand", updateFarmstandRouter);
app.route("/api/delete-farmstand", deleteFarmstandRouter);
app.route("/api/feedback", feedbackRouter);
app.route("/api/send-chat-push", sendChatPushRouter);
app.route("/api/send-saved-stand-push", sendSavedStandPushRouter);

const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
};
