# Farmstand Links (Next.js)

## Favorites / Hearts — Full Fix History

### Latest fix: flash-and-revert race condition (loadFavorites stale read)

**Root cause**: `loadFavorites()` is called once on app mount. It starts a GET request to Supabase. If the user taps a heart before that GET completes, the toggle fires, the backend confirms the write, and the store is updated correctly. But then the still-in-flight `loadFavorites` GET completes — it started *before* the toggle, so Supabase returns a pre-toggle snapshot — and it overwrites the correct store state with stale data, causing the flash-and-revert.

**Fix (`favorites-store.ts`)**: Added a `_toggleVersion` counter. When `toggleFavorite` writes the server-confirmed state it bumps this counter. `loadFavorites` captures the counter *before* its GET, and after the GET it checks: if the counter advanced (meaning a toggle completed while the GET was in-flight), it discards the stale result entirely. Both the `inFlight` guard (toggle in progress) and the `_toggleVersion` guard (toggle completed) must pass before `loadFavorites` is allowed to write.

### Backend true toggle (DB-state check)

`/api/favorites/toggle` no longer trusts the client's `action` field. It queries the DB first: if the row exists → DELETE; if not → INSERT. This means the backend is always correct regardless of whether the client's `action` hint is stale.

### Backend route
- `POST /api/favorites/toggle` — `backend/src/routes/favorites.ts`
- Verifies JWT via Supabase `/auth/v1/user`, uses service-role key for DB writes (bypasses RLS FK issue)
- Returns `{ success, favorites: string[] }` — full refreshed list for the user



### What was fixed
- **`favorites-store.ts`**: Heart taps now write to Supabase `saved_farmstands` table (insert on save, delete on unsave). Guest users fall back to AsyncStorage. After each toggle, `loadAdminData()` is called so `saved_count` reflects the DB trigger update.
- **`explore-store.ts` `getMostSaved`**: Removed the strict `operatingStatus === 'open'` gate that blocked seasonal/null-status farmstands. Now only excludes `permanently_closed` stands. Added detailed console logging for debugging.
- **`index.tsx` mostSaved memo**: Enhanced logs showing exactly why the section is hidden or what it contains.

### Most Saved row rules
- 25-mile hard cap from `anchorLocation`
- `saved_count > 0` (from Supabase trigger on `saved_farmstands`)
- Excludes `permanently_closed` only
- Sorted by `saved_count DESC`, then distance ASC
- Hidden cleanly when zero results



### Problem
TestFlight builds showed "Session Expired" on Admin Dashboard and were missing the admin profile avatar. The root cause needed to be diagnosed via structured logs visible in Xcode console.

### Findings

| # | Finding | Severity |
|---|---------|----------|
| 1 | `app.json` has `"projectId": "YOUR_EAS_PROJECT_ID"` — a placeholder never replaced with a real EAS project ID | **CRITICAL** — OTA updates non-functional |
| 2 | `eas.json` production env vars (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_VIBECODE_BACKEND_URL`) are all correctly set and match dev | OK |
| 3 | Admin Guard had a one-frame race condition: when `isAdmin` transitions from false→true, a stale `sessionChecked=true, hasValidSession=false` state from the previous run could briefly render "Session Expired" | **Fixed** |
| 4 | `fetchProfileAvatarUrl` had minimal logging — couldn't diagnose missing avatar in TestFlight | **Fixed** (enhanced logging) |
| 5 | No startup log block showing EAS project ID, build profile (`__DEV__`), bundle ID, or backend URL | **Fixed** (added `[BUILD_DIAG]` block) |

### What was NOT the cause
- Production Supabase URL/key: correct in `eas.json`
- Admin Guard session logic: multiple fallbacks already existed (forceReloadSession, explicit refresh)
- Admin email check: `contact@farmstand.online` hardcoded correctly
- Backend URL: `EXPO_PUBLIC_VIBECODE_BACKEND_URL` correctly prefixed, visible to client bundle

### Action Required from You
To fix the EAS project ID (`app.json` is in forbidden_files — must be updated manually):
1. Run `eas project:info` to see your current EAS project ID
2. Replace `"YOUR_EAS_PROJECT_ID"` in `mobile/app.json → extra.eas.projectId` with your real project ID
3. Rebuild and re-submit to TestFlight

### After next rebuild
Look for `[BUILD_DIAG]` in Xcode console on device (Window → Devices and Simulators → select device → logs). These lines confirm:
- Which EAS project the build is linked to
- Whether `__DEV__` is false (production mode confirmed)
- Whether Supabase is pointing to `khngqgjabrmgtbbnpiax.supabase.co`
- Whether the admin guard sees the correct email/session

### Files Changed
| File | Change |
|------|--------|
| `mobile/src/lib/supabase.ts` | Added `Constants` import; added `[BUILD_DIAG]` startup block logging EAS project ID, slug, version, bundle ID, `__DEV__`, backend URL, Supabase URL/host/key prefix; enhanced `fetchProfileAvatarUrl` to log userId, Supabase host, row count, and truncated URL |
| `mobile/src/components/AdminGuard.tsx` | Added `Constants` import; expanded mount log to show EAS project ID, `__DEV__`, version, backend URL, authUser/userStore email, computed isAdmin; added explicit `setSessionChecked(false)` + `setHasValidSession(false)` synchronously before calling `checkSession()` to prevent one-frame "Session Expired" flash on cold load |



Fixed a production-only issue where hero images and card images appeared grainy/soft for some farmstands in TestFlight, while the same photos looked sharp in the photo album/lightbox.

### Root Cause
The database has two image columns:
- `hero_photo_url` → `heroPhotoUrl` — the actual user-uploaded photo
- `hero_image_url` → `heroImageUrl` — a legacy field that may contain stale/AI-generated URLs

All hero/card rendering code was passing `heroImageUrl` (the legacy field) to `getFarmstandDisplayImage()`, completely bypassing `heroPhotoUrl` (the actual uploaded photo). Older farmstands may only have data in `hero_photo_url`, causing hero images to fall back to the branded placeholder or use a stale low-res URL. The photo gallery/lightbox reads `photos[]` directly — always sharp.

### Fix
Updated `getFarmstandDisplayImage()` to accept `heroPhotoUrl`/`hero_photo_url` as the **highest-priority** field (before `heroImageUrl`/`hero_image_url`). Updated all 6 call sites to pass `heroPhotoUrl` from the farmstand object.

### Files Changed
| File | Change |
|------|--------|
| `mobile/src/lib/farmstand-image.ts` | Added `heroPhotoUrl` / `hero_photo_url` as highest-priority input; falls back to `heroImageUrl` / `hero_image_url`, then branded fallback |
| `mobile/src/app/farm/[id].tsx` | Pass `heroPhotoUrl` to `getFarmstandDisplayImage()` |
| `mobile/src/app/(tabs)/index.tsx` | Pass `heroPhotoUrl` at both card/carousel call sites |
| `mobile/src/app/(tabs)/map.tsx` | Pass `heroPhotoUrl` for map/bottom-tray cards |
| `mobile/src/app/(tabs)/favorites.tsx` | Pass `heroPhotoUrl` for favorites cards |
| `mobile/src/app/profile/visited.tsx` | Pass `heroPhotoUrl` for visited cards |

## Review Management Overhaul

Owner review management now uses real Supabase data end-to-end. Replies no longer disappear.

### Where owners manage reviews
Profile → **Manage Reviews** card (appears below the owner's farmstand card). Tapping opens a full review list showing all reviews for the owner's farmstand(s), sorted newest first. Owners with multiple farmstands see all reviews merged together with the farmstand name shown on each card.

### Where replies appear publicly
The farmstand's public Reviews screen (`/farm/reviews`) already renders an owner response block under each review when `owner_response` is populated in Supabase. This continues to work correctly for all users.

### What happens when a new review is submitted
1. Review is written to `farmstand_reviews` in Supabase.
2. A `review_new` inbox alert fires to the farmstand owner.
3. The owner sees the alert in Inbox and can tap to open the Reviews list.
4. Owner taps a review → opens `/review/[id]` which shows the full reply UI (Reply / Edit Reply / Delete Reply).
5. On reply: `owner_response` and `owner_response_at` are written to Supabase; the reply appears immediately on screen.
6. A `review_reply` inbox alert fires to the reviewer.
7. Public users see the "Response from owner" block on the farmstand's Reviews page.

### Files changed

| File | Change |
|------|--------|
| `mobile/src/lib/reviews-store.ts` | Added `createdAt` (raw ISO) to `Review` type and `mapRowToReview` for reliable date sorting |
| `mobile/src/app/farmer/reviews/index.tsx` | Full rewrite: now uses `useReviewsStore` (real Supabase), loads via `useFocusEffect`, merges multiple farmstands, navigates to `/review/[id]` for detail/reply |
| `mobile/src/app/(tabs)/profile.tsx` | Added "Manage Reviews" card below owned farmstand cards for all farmstand owners |

## Products Persistence Fix

Two bugs were fixed in the products system to ensure products persist across app reloads, updates, and reinstalls.

| File | Bug | Fix |
|------|-----|-----|
| `mobile/src/lib/products-store.ts` | `fetchProductsForFarmstand` merge logic wiped locally-created products on every Supabase refetch. Products with temp IDs (insert failed/offline) disappeared the moment the screen fetched from Supabase. | Preserve local-only (non-UUID) products for the current farmstand when merging Supabase results. |
| `mobile/src/app/owner/products.tsx` | `useFocusEffect` stale closure — `isLoading` was not in `useCallback` deps so it always evaluated as `true`, meaning the focus-based Supabase refetch never fired. | Removed the `!isLoading` guard; refetch always runs on screen focus. |
| `mobile/src/lib/products-store.ts` | If Supabase insert returned a 204 (no body), the product stayed with a temp ID indefinitely with no recovery path. | Added a 500ms deferred `fetchProductsForFarmstand` to pick up the real UUID from Supabase. |
| `mobile/src/app/owner/products.tsx` | After saving a product, no Supabase refetch was triggered, so the UI could lag behind the DB. | Added explicit refetch after every save. |

**Logging added:** Full Supabase insert payload, insert response, farmstand_id used for each query — visible in the LOGS tab.

This is a standalone Next.js 15 app that lives in `/links` inside the monorepo. It powers share links and universal links for the Farmstand mobile app.

## Admin > Manage Users (Production)

The Admin → Manage Users screen now uses **real Supabase data** only. No mock users.

### What was changed

| Component | Change |
|-----------|--------|
| `supabase-admin-users.sql` | New migration: adds `role` + `status` columns to `profiles`, backfills all existing auth users, updates signup trigger |
| `backend/src/routes/admin-users.ts` | New route module: GET /api/admin/users, POST /api/admin/broadcast-alert, PATCH role/status |
| `backend/src/index.ts` | Mounts `adminUsersRouter` at `/api/admin` |
| `mobile/src/app/admin/users.tsx` | Complete rewrite: live data, search, role filter, multi-select, Email (BCC), Send Alert modal |
| `mobile/src/lib/admin-store.ts` | Removed mock user seed data from `loadAdminData` |

### New backend endpoints

- `GET /api/admin/users` — Returns all users (auth + profiles + farmstand counts). Admin JWT required.
- `POST /api/admin/broadcast-alert` — Inserts `inbox_alerts` for each recipient + fires push notifications. Admin JWT required.
- `PATCH /api/admin/users/:id/role` — Updates profile role. Admin JWT required.
- `PATCH /api/admin/users/:id/status` — Updates profile status (active/suspended). Admin JWT required.

### How to run the SQL migration

1. Open your Supabase project dashboard
2. Go to SQL Editor
3. Paste and run `supabase-admin-users.sql` from the project root

### How to test

1. Sign in as admin → go to Admin → Manage Users
2. Verify real accounts appear (no "Sarah Farmer" / "Mike Consumer")
3. Select users → tap **Email** → verify mail app opens with BCC
4. Select users → tap **Alert** → enter title + message → Send → verify Inbox > Alerts shows the new alert



Every push notification sent to a user is now also saved as a persistent alert in the `inbox_alerts` Supabase table. Users can view all past notifications in **Inbox → Alerts**.

### How it works

All backend push routes call `insertAlert()` (or `insertAlertForUsers()`) from `backend/src/lib/alert-inserter.ts` after sending the push. This is non-blocking — a DB write failure never blocks the push.

| Route | Alert type | When triggered |
|-------|-----------|----------------|
| `send-alert.ts` | any (`type` param) | Admin/system alerts |
| `approve-claim-push.ts` | `claim_approved` | Admin approves claim |
| `send-chat-push.ts` | `message` | User sends a chat message |
| `send-saved-stand-push.ts` | `farmstand_update` | Stand owner posts an update |

### Alert types and colors in Inbox → Alerts

- `message` — forest green, MessageSquare icon
- `farmstand_update` — warm brown, Store icon
- `claim_approved` — green, CheckCircle icon
- `claim_denied` — red, XCircle icon
- `platform_announcement` / `app_notice` — blue

### Read/unread

Alerts start unread (`read_at = null`). Tapping an alert marks it read. "Mark all read" button appears when there are unread alerts.

## Favicon

The Farmstand brand icon is served from `links/public/farmstand-icon.png` and referenced in `links/app/layout.tsx`. It appears as the favicon for `links.farmstand.online` in browser tabs and iOS share sheets.

## Premium Trial System

When an admin approves a farmstand claim, the owner automatically receives a 6-month Premium trial. The system is implemented as follows:

### Database (Supabase)
Run `/mobile/supabase-premium-trial.sql` in the Supabase SQL editor to:
- Add `premium_status`, `premium_trial_started_at`, `premium_trial_expires_at` columns to `farmstands`
- Update the `approve_claim` RPC to set trial dates on approval

### Premium Status Values
- `free` — default, no trial or subscription
- `trial` — 6-month free trial after claim approval
- `active` — paid subscription (future RevenueCat integration)
- `expired` — trial or subscription ended

### Premium Features (trial/active)
- Unlimited photos
- Customer messaging
- Push notifications
- Product cards
- Farmstand manager
- Analytics & insights

### New Screens
- `owner/claim-success` — Shown after claim approval, explains the free trial
- `owner/premium` — Owner dashboard Premium status page with trial countdown
- `owner/free-vs-premium` — Feature comparison page (Free vs Premium)

### Trial Expiring Banner
The `owner/my-farmstand` screen shows an amber banner when the trial expires within 30 days.

### Pricing
- $4.99/month after trial (no auto-charge — future RevenueCat integration)
- Promotions are separate paid boosts, not part of Premium

## Supabase Backend Audit — Schema Gaps & Missing Tables

Full audit of the Supabase schema against real app usage. Three critical tables were missing.

### COMPLETE (no action needed)

| Table | Used by | Status |
|-------|---------|--------|
| `farmstands` | Core listing, claiming, ownership, premium columns | Complete |
| `farmstand_inventory` | Farmstand Manager - inventory | Complete |
| `farmstand_sales` | Farmstand Manager - sales | Complete |
| `farmstand_expenses` | Farmstand Manager - expenses | Complete |
| `claim_requests` | Claim workflow | Complete |
| `chat_threads` | Messaging | Complete |
| `chat_messages` | Messaging | Complete |
| `chat_thread_states` | Unread counts | Complete |
| `user_push_tokens` | Push notifications | Complete |
| `user_notification_prefs` | Notification settings | Complete |

### CRITICAL GAPS — SQL files created, must be run in Supabase

#### 1. `inbox_alerts` — Blocking: app will fail without this
- **File:** `mobile/supabase-inbox-alerts.sql`
- `alerts-store.ts` reads/writes `inbox_alerts` exclusively for the user notification inbox
- `admin_deny_farmstand_and_alert()` RPC inserts into `inbox_alerts`
- The old `alerts` table (from `supabase-alerts.sql`) is NOT used by the app — `inbox_alerts` is
- Columns: `id`, `user_id`, `title`, `body`, `related_farmstand_id`, `type`, `action_route`, `action_params`, `created_at`, `read_at`, `deleted_at`

#### 2. `profiles` — Avatar persistence fails without this
- **File:** `mobile/supabase-profiles.sql`
- `uploadAvatarAndPersist()` PATCHes `profiles` using `uid` column
- `fetchProfileAvatarUrl()` reads `profiles.avatar_url`
- Columns: `uid` (PK, FK to auth.users), `avatar_url`, `full_name`, `bio`, `created_at`, `updated_at`
- Includes auto-create trigger on new user sign-up + back-fill for existing users

#### 3. `farmstand_products` — Product search silently broken without this
- **File:** `mobile/supabase-farmstand-products.sql`
- `search-store.ts` queries `farmstand_products` for product name matching (ILIKE)
- Gracefully falls back if table missing, but product-name search never returns results
- Columns: `id`, `farmstand_id`, `name`, `category`, `description`, `price`, `unit`, `is_active`, `in_season`, timestamps

### NOT MISSING (confirmed local-only by design)

| Feature | Storage | Notes |
|---------|---------|-------|
| Reviews | AsyncStorage only | `reviews-store.ts` never calls Supabase |
| Favorites/Saves | AsyncStorage only | No `user_saves` table referenced anywhere |
| Analytics events | AsyncStorage only | `analytics-store.ts` is local-only |

### HOW TO APPLY

Run each SQL file in your **Supabase SQL Editor** (Dashboard → SQL Editor → New Query):

```
1. supabase-inbox-alerts.sql       ← CRITICAL, run first
2. supabase-profiles.sql           ← CRITICAL, run second
3. supabase-farmstand-products.sql ← Run when ready for product search
```

All files use `IF NOT EXISTS` and `DROP POLICY IF EXISTS` — safe to re-run.

## Farmstand Chat — public.messages Fix

### Root Cause
Push notifications were firing but no rows were written to `public.messages`. The Inbox tab reads from `public.conversations` which is populated by triggers on `public.messages` — so empty `public.messages` = empty Inbox.

The legacy `sendMessage` path (opened from the farmstand detail screen chat button) was only inserting into `chat_messages`, not `public.messages`. The direct mode path (`sendDirectMessage`) was writing to `public.messages` correctly.

### Fix
`sendMessage` (in `chat-store.ts`) now also inserts into `public.messages` immediately after the `chat_messages` insert, using:
- `sender_id = senderUserId`
- `receiver_id = recipientId` (NOT `recipient_id`)
- `farmstand_id = farmstandId`
- `body = text`
- `created_at = now`

Push notification is untouched — it fires after both inserts, same as before.

### Debug Panel
Both send paths (direct and legacy) now show a temporary on-screen debug panel above the input bar with:
- Auth user id, receiver id, farmstand id, body, Supabase URL, table name, payload
- Green/red status line: "message insert success" or the exact error text
- Matching console logs: `[sendMessage]` and `[sendDirectMessage]` prefix

### Chat Mode Detection
- **Direct mode**: `isDirectMode = !!otherUserId && !!farmstandId` — navigated from Inbox with `/chat/direct?...` params including `otherUserId`
- **Legacy mode**: navigated from farmstand detail `/chat/<threadId>` or `/chat/new` — no `otherUserId`, uses thread

---

## Farmstand Manager — Persistence & Readback Audit (Full Fix)

All Farmstand Manager data (sales, expenses, inventory) is fully persisted to and read back from Supabase. The following issues were audited and fixed:

### Layout Fix
- Removed the outer `<ScrollView>` in `FarmstandManager.tsx` that was wrapping all tab content. Each tab (Overview, Sales, Expenses, Inventory, Reports) manages its own scroll internally. The outer wrapper was preventing inner lists from filling the available height and made scrolling broken.

### Inventory Deduction on Sale
- Implemented the "Deduct from Inventory" toggle in `SalesTab`. When a sale is linked to an inventory item and has a quantity, `createSale` in `manager-service.ts` now fetches the current inventory quantity and decrements it by the sold amount (floored at 0). This is non-fatal — the sale is recorded regardless of whether the deduction succeeds.

### Per-Section Refresh Keys
- Replaced the single global `refreshKey` in `FarmstandManager.tsx` with three targeted keys: `inventoryKey`, `overviewKey`, `reportsKey`.
- After a sale: Overview, Reports, and Inventory all remount on next visit (to reflect deducted stock and new revenue).
- After an expense: Overview and Reports remount.
- After an inventory change: Overview and Reports remount.
- Sales and Expenses tabs call `load()` internally after each save, so they don't need a remount.

### InventoryTab `onInventoryChanged` Callback
- Added `onInventoryChanged?: () => void` prop to `InventoryTab`.
- Called after successful create, update, and delete so Overview/Reports reflect the latest inventory value.

### Enhanced Error Logging
- All three `create*` functions (`createSale`, `createExpense`, `createInventoryItem`) now log `farmstand_id` in their error context alongside message, status, code, details, and hint.

### Supabase Schema & RLS
- Verified `farmstand_sales`, `farmstand_expenses`, `farmstand_inventory` tables and RLS policies match the insert payloads exactly.
- All rows are scoped to `farmstand_id IN (SELECT id FROM farmstands WHERE owner_user_id = auth.uid())`.
- No cross-farmstand data leakage possible.

## Farmstand Manager — Record Sale Fix

### Bug Fixed
`createSale`, `createExpense`, and `createInventoryItem` in `mobile/src/lib/manager-service.ts` were returning `null` whenever Supabase's `return=representation` insert returned an empty array `[]`. This caused "Failed to record sale" even when the insert itself succeeded.

**Root cause:** Supabase REST POST with `Prefer: return=representation` returns `[]` when the server cannot read back the newly inserted row (common with strict RLS INSERT-only policies that don't grant SELECT on the inserted row itself). The code incorrectly treated an empty array as failure.

**Fix:** When the insert returns no error but an empty array, reconstruct the entity from the insert payload and return it — treating the insert as a success. Full error details (message, status, code, details, hint) are now logged to expo.log for diagnosis if a real Supabase error occurs.

### Supabase Table Setup
The `farmstand_sales`, `farmstand_inventory`, and `farmstand_expenses` tables must be created in Supabase. Run `mobile/supabase-farmstand-manager.sql` in the Supabase SQL editor. This is safe to re-run — all statements use `CREATE TABLE IF NOT EXISTS` and `DROP POLICY IF EXISTS`.

## Promotion Ranking System

### Overview
Promoted farmstands rotate through high-visibility positions multiple times per day using a stable 2-hour window rotation. Only promoted farmstands within the shopper's selected radius compete for promoted slots.

### Rotation Model
- Window duration: **2 hours** (12 rotations per day)
- Rotation seed is derived from: `windowIndex + category + farmstandId`
- Ordering is stable within each window — no reshuffling on re-renders or scrolls
- When the window changes, promoted winners recompute on next memoized call

### Slot Counts
| Surface | Promoted slots | Auto-fill to top |
|---|---|---|
| Explore homepage row | 1 per category row | Up to 10 total |
| Category results page | Up to 3 | Up to 10 total |
| Map boost | Up to 5 | Up to 10 total |

### Radius Competition Rules
- Promotions only compete against other promotions **within the shopper's radius**
- Non-promoted auto-featured farmstands are not radius-restricted here (Explore screen handles display radius separately)
- Radius is passed explicitly: `getPromotedForExploreRow(farmstands, category, anchorLocation, radiusMiles)`

### Fairness Logic
- Each promoted farmstand gets a **selection score** per window:
  - `priorityScore = promoPriority × 100`
  - `rotationBonus = promoRotationWeight × windowRandom × 250`
  - `fairnessPenalty` — applied if the farmstand was served in the last 2 windows
- Farmstands served recently are penalized to encourage rotation across all eligible promos
- `markServedInWindow(ids, category)` records which promos were shown, enabling fairness tracking

### Key Methods (promotions-store.ts)
| Method | Use |
|---|---|
| `getPromotedForExploreRow(farmstands, category, location, radius)` | Explore homepage category rows (1 promo slot) |
| `getPromotedForCategoryResults(farmstands, category, location, radius)` | Category results screens (up to 3 promo slots) |
| `getPromotedForCategory(farmstands, category)` | Legacy — no radius filter, 1 promo slot |
| `getBoostedForMap(farmstands, bounds)` | Map view boosted pins |
| `markServedInWindow(ids, category)` | Record served promos for fairness history |

### Promotion Eligibility
- `promoActive: true`
- `promoStatus === 'active'` (not scheduled, not expired)
- Within shopper's radius (for promoted competition)
- Matches the category (`promoExploreCategories` includes category, or array is empty = general promo)

### Farmstand Promotion Fields
| Field | Type | Description |
|---|---|---|
| `promoActive` | boolean | Promotion enabled |
| `promoExploreCategories` | string[] | Categories to appear in (empty = all) |
| `promoMapBoost` | boolean | Boost on map |
| `promoPriority` | number (0–100) | Higher = more likely to win slot |
| `promoRotationWeight` | number (1–10) | Higher = more variance across windows |
| `promoStartAt` | string\|null | ISO datetime start |
| `promoEndAt` | string\|null | ISO datetime end |
| `promoStatus` | PromoStatus | active / scheduled / expired / none |



- Serves `https://links.farmstand.online/farmstand/[slug]` pages with Open Graph metadata for link previews
- Hosts `/.well-known/apple-app-site-association` for iOS universal links
- Deployed independently to Vercel

## Structure

```
links/
├── app/
│   ├── layout.tsx                    # Root layout
│   ├── page.tsx                      # Home page (download CTA)
│   └── farmstand/[slug]/page.tsx     # Farmstand share page (OG metadata + fallback UI)
├── public/
│   └── .well-known/
│       └── apple-app-site-association
├── next.config.mjs
├── package.json
├── tsconfig.json
└── vercel.json                       # Headers for AASA content-type
```

## Environment Variables (set in Vercel dashboard)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only) |

## Address Autocomplete (Exact Address Mode)

**File:** `mobile/src/utils/addressAutocomplete.ts`

### Bias Strategy (in order)
1. **80 km strict radius** around user GPS — hyper-local (Beavercreek/Clackamas area)
2. **250 km strict radius** around GPS — covers all of Oregon
3. **400 km loose** + `", Oregon"` hint appended to query
4. **400 km loose** — last resort broadest fallback

### Hard Filters (after Google returns results)
- **Distance filter:** Drop any result > 250 km from user GPS (when GPS available)
- **State filter:** If any OR/WA/ID/CA/NV/MT result exists, drop all Midwest/East states (DC, KS, MO, etc.)

### GPS Proximity Caching
`mobile/src/components/LocationInput.tsx` fires `getLastKnownPositionAsync` (instant) followed by a background `getCurrentPositionAsync` on mount. This ensures autocomplete always has a fresh GPS anchor rather than falling back to Oregon center.

## Deploying

1. Create a new Vercel project pointed at this repo
2. Set the **Root Directory** to `links`
3. Add the two env vars above
4. Assign the custom domain `links.farmstand.online`

## Share Link Format

```
https://links.farmstand.online/farmstand/ek-farms
```

The page fetches the farmstand by `slug` from Supabase and returns:
- `og:title` — farmstand name
- `og:description` — city, state + description
- `og:image` — cover photo
- `twitter:card` — `summary_large_image`
- Fallback webpage with photo, name, location, description, and deep-link CTA

## Universal Links (iOS)

Universal links allow iMessage rich preview cards to open the app directly without an intermediate web page.

### How it works

1. The `/.well-known/apple-app-site-association` file at `links.farmstand.online` lists the app's bundle ID and path patterns
2. The mobile app's `app.json` includes `applinks:links.farmstand.online` in `associatedDomains` via the `expo-build-properties` plugin
3. iOS downloads and caches the AASA file when the app is installed
4. When a user taps `https://links.farmstand.online/farmstand/slug` in iMessage, iOS opens the app directly

### Critical requirement: Apple Team ID in AASA

The `appIDs` field in `links/public/.well-known/apple-app-site-association` **must** use the format `TEAMID.online.farmstand.app`.

Find your Apple Team ID at: https://developer.apple.com/account → Membership → Team ID

Then update both AASA files:
- `links/public/.well-known/apple-app-site-association`
- `public/.well-known/apple-app-site-association`

Replace `REPLACE_WITH_TEAM_ID` with the actual 10-character Team ID (e.g., `AB12CD34EF`).

After updating, redeploy to Vercel for the change to take effect.

### Deep link flow

```
iMessage tap → iOS checks AASA → app installed? → open app at /farmstand/[slug]
                                                → not installed → open web page
```

The `/farmstand/[slug]` screen in the app resolves the slug to a farmstand ID via Supabase and navigates to `/farm/[id]`.

