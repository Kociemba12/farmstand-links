import { Hono } from "hono";
import { getOriginalFetch } from "@vibecodeapp/proxy";

/**
 * Upload Route
 *
 * POST /api/upload — Upload a file and return a public URL
 *
 * Accepts multipart/form-data with a `file` field.
 * Stores in Supabase Storage bucket `support-screenshots`.
 *
 * Uses the pre-proxy fetch so Supabase calls are not rerouted through the
 * Vibecode proxy (which requires VIBECODE_PROJECT_ID to work and would fail
 * without it when running locally).
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BUCKET = "support-screenshots";

// Use the un-patched fetch for all Supabase calls so the Vibecode proxy
// (which requires VIBECODE_PROJECT_ID) does not intercept them.
const supabaseFetch = getOriginalFetch();

// Log env var presence (never log values) at module load time.
console.log(
  "[upload] Config check — SUPABASE_URL set:", !!SUPABASE_URL,
  "| SUPABASE_SERVICE_ROLE_KEY set:", !!SUPABASE_SERVICE_KEY,
);

// Lazy bucket-creation guard — only runs once per process lifetime.
let bucketEnsured = false;
async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("[upload] ensureBucket skipped — missing env vars");
    return;
  }
  try {
    const resp = await supabaseFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        apikey: SUPABASE_SERVICE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
    });
    const text = await resp.text();
    if (resp.ok) {
      console.log("[upload] Bucket created:", BUCKET);
      bucketEnsured = true;
    } else if (text.includes("already exist") || text.includes("Duplicate")) {
      console.log("[upload] Bucket already exists:", BUCKET);
      bucketEnsured = true;
    } else {
      console.error("[upload] Bucket creation failed:", resp.status, text);
      // Don't set bucketEnsured — will retry on next request
    }
  } catch (err) {
    console.error("[upload] Bucket creation network error:", err);
  }
}

export const uploadRouter = new Hono();

uploadRouter.post("/", async (c) => {
  console.log("[upload] POST /api/upload — route hit");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("[upload] Aborting — SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
    return c.json({ success: false, error: "Storage not configured" }, 500);
  }

  // Ensure destination bucket exists.
  await ensureBucket();

  // Parse multipart body.
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch (err) {
    console.error("[upload] Failed to parse multipart body:", err);
    return c.json({ success: false, error: "Expected multipart/form-data" }, 400);
  }

  // Log all field names received (helps diagnose wrong field name from client).
  const fieldNames = [...formData.keys()];
  console.log("[upload] formData fields received:", fieldNames);

  const file = formData.get("file");
  console.log(
    "[upload] file field — present:", !!file,
    "| typeof:", typeof file,
    "| constructor:", (file as File)?.constructor?.name ?? "none",
    "| name:", (file as File)?.name ?? "n/a",
    "| type:", (file as File)?.type ?? "n/a",
    "| size:", (file as File)?.size ?? "n/a",
  );

  if (!file || typeof file === "string") {
    return c.json({ success: false, error: "No file provided" }, 400);
  }

  const fileName = file instanceof File ? file.name : `upload-${Date.now()}.jpg`;
  const contentType = file instanceof File ? (file.type || "image/jpeg") : "image/jpeg";
  const storagePath = `${Date.now()}-${fileName}`;

  let buffer: ArrayBuffer;
  try {
    buffer = await (file as Blob).arrayBuffer();
  } catch (err) {
    console.error("[upload] Failed to read file buffer:", err);
    return c.json({ success: false, error: "Failed to read uploaded file" }, 500);
  }

  console.log(
    "[upload] Uploading to Supabase Storage — bucket:", BUCKET,
    "| path:", storagePath,
    "| contentType:", contentType,
    "| bytes:", buffer.byteLength,
  );

  let response: Response;
  try {
    response = await supabaseFetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          apikey: SUPABASE_SERVICE_KEY,
          "Content-Type": contentType,
          "x-upsert": "true",
        },
        body: buffer,
      },
    );
  } catch (err) {
    console.error("[upload] Supabase Storage network error:", err);
    return c.json({ success: false, error: "Failed to reach storage service" }, 502);
  }

  if (!response.ok) {
    const errText = await response.text();
    console.error("[upload] Supabase Storage upload failed — HTTP:", response.status, "| body:", errText);
    return c.json({ success: false, error: "Upload failed" }, 500);
  }

  const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
  console.log("[upload] Upload success — public URL:", url);

  return c.json({
    success: true,
    data: {
      id: storagePath,
      url,
      filename: fileName,
      contentType,
      sizeBytes: buffer.byteLength,
    },
  });
});
