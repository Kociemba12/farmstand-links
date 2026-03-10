# Farmstand

A mobile app for discovering local farm stands - like Yelp, but for fresh, local produce.

## Oregon Launch

Farmstand is launching in Oregon first! We've curated 16 farm stands across all regions:
- Portland Metro (Sauvie Island, Hillsboro)
- Hood River Valley
- Willamette Valley (Salem, Philomath, Junction City)
- Southern Oregon (Medford, Grants Pass)
- Central Oregon (Bend, Terrebonne)
- Oregon Coast (Nehalem)
- Eastern Oregon (Milton-Freewater, Pendleton)

## Authentication

### Guest Mode
Users can browse the app without creating an account, but with restricted functionality:

**Guest Permissions:**
- View Farmstands
- Browse the map and listings
- View Farmstand details

**Guest Restrictions:**
- Cannot leave reviews
- Cannot rate Farmstands
- Cannot save Farmstands to Favorites
- Cannot access any write or save actions

When a guest attempts to use a restricted feature (Leave Review, Rate, Save to Favorites), a modal appears:
> "Please sign in or create an account to leave reviews or save Farmstands."

The guest prompt includes:
- Sign In button (navigates to login)
- Create Account button (navigates to signup)
- Clear explanation: "Guest Mode: Guests can browse Farmstands but must sign in to leave reviews or save favorites."

Guest restrictions apply consistently on:
- Farmstand detail pages (heart/favorite button, write review button)
- Favorites/Saved section (shows sign-in prompt instead of favorites list)
- Map screen (heart buttons on farm cards)
- Any review or save button throughout the app

When a user logs in or creates an account, all features are immediately enabled without restarting the app.

### Login & Sign Up
- Email and password authentication
- Create new accounts with name, email, and password
- Password must be at least 6 characters
- **Email Confirmation Required**: After signup, users must confirm their email before accessing the app
  - Successful signup routes to "Confirm Your Email" screen (not the app)
  - Users must check their email and click the verification link
  - "Go to Log In" button to navigate to login screen after confirming
  - "Resend Confirmation Email" button with 60-second cooldown to prevent spam
  - Rate limit handling: If too many requests (429 error), shows "Too many requests. Please wait about a minute and try again." with 60-second countdown
- Only successful login grants access to the app
- Profile tab shows login prompt when signed out (no redirect to Explore)
- Auto-redirect to home only when logging in from auth screens

### Admin Access
- **Single Source of Truth**: Admin access is determined ONLY by email address
- **Admin Email**: `contact@farmstand.online`
- Admin dashboard, analytics, and admin-only features are only visible if logged-in user's email === `contact@farmstand.online`
- Non-admin users who try to access admin routes via URL are automatically redirected to Profile

### Session Management (AuthProvider)
The app uses a global `AuthProvider` component that wraps the entire app to manage Supabase session state reliably across all builds (development and production/TestFlight).

**Architecture:**
- `src/providers/AuthProvider.tsx` - React Context provider for global session state
- Uses `useAuth()` hook to access session anywhere in the app
- Session is loaded from SecureStore on app startup and kept in sync with the global session state

**Why this exists:**
In TestFlight/production builds, the Supabase session was not being properly restored on cold start, causing "Please sign in to continue" errors when users tried to perform authenticated actions like deleting farmstands. The AuthProvider solves this by:
1. Loading the session from SecureStore on mount
2. Exposing session state via React Context for components to subscribe to
3. Syncing with the global session state to catch external changes (sign in/out)

**Session Dual-Storage (Fix for TestFlight "Session Missing — Cannot Approve"):**
Sessions are now persisted to BOTH `SecureStore` and `AsyncStorage` on every write (set/clear/refresh). Previously, token refreshes only updated `SecureStore`, leaving `AsyncStorage` stale. On cold boot, the bootstrap reads `AsyncStorage`, so stale tokens would cause hard-expiry on next open, followed by failed refresh attempts, resulting in "Session Missing" on the admin approve/deny screen.

**farmstand_owners is the sole ownership source (Fix for TestFlight "My Farmstand" showing denied claims):**
`fetchUserFarmstandsFromSupabase` in `bootstrap-store.ts` queries `farmstand_owners JOIN farmstands` as the exclusive authority for "My Farmstand". The legacy `farmstands.owner_id` fallback has been **completely removed** — there is no fallback path of any kind. If the query returns 0 rows, the user owns 0 farmstands. A module-level `_refreshInFlight` flag prevents concurrent `refreshUserFarmstands()` calls (focus + AppState can fire together). `profile.tsx` uses a `refreshInFlight` `useRef` as an additional component-level guard, with `useFocusEffect` deps tightened to `[user?.id, user?.email]` only. `_layout.tsx` watches `user?.id` changes and calls `useBootstrapStore.getState().reset()` immediately so stale farmstand state from a previous session never flashes on screen for the next user. On sign-out, `reset()` is also called via deferred `require()` in `user-store.ts` (to avoid the circular import with `bootstrap-store`).

The fix in `src/lib/supabase.ts`:
- `saveSessionToStorage()` now writes to both `SecureStore` (key `supabase-session`) and `AsyncStorage` (key `supabase_session`) atomically
- `getValidAuthKey()` now calls `loadSessionFromStorage()` if the in-memory session is null and hasn't been loaded yet, preventing false "anon" fallbacks in release builds where the module may re-initialize

**Auth Flow Invariants (getValidSession and deny flow):**
- `getValidSession()` ONLY does: (a) `loadSessionFromStorage()`, (b) if hard-expired → `refreshSupabaseSession()` (refresh_token grant), (c) return null if missing/refresh fails
- `getValidSession()` NEVER calls `supabaseAuthSignIn()` or issues a `grant_type=password` request
- `supabaseAuthSignIn()` (password grant) is ONLY called from `src/app/auth/login.tsx` on explicit user sign-in
- Deny flow: `handleDeny` → `getValidSession()` → if null, shows "Session Missing" alert with Sign In button; the password grant only fires when the user actually taps Sign In and submits credentials
- `supabaseAuthSignIn` logs a masked email (first 3 chars + domain) and password-length-check for diagnosing `invalid_credentials` errors

**Usage in components:**
```tsx
import { useAuth } from '@/providers/AuthProvider';

function MyComponent() {
  const { session, user, loading } = useAuth();

  if (loading) return <LoadingSpinner />;
  if (!session) {
    showToast('Please sign in to continue', 'error');
    return;
  }

  // Proceed with authenticated action
}
```
- **No database lookups**: Admin status is NOT determined by `profiles.is_admin`, `user.role`, or any other field
- Route protection via `AdminGuard` component that checks email only

## Features

### Explore Screen (Home)
Hipcamp/Airbnb-style discovery page with rich content carousels:
- **"Farmstand Fresh and Local" branding** with logo at top
- **Search bar** for farms, products, and cities
- **Filter chips** (horizontal scroll): Fresh Eggs, Produce, Baked Goods, Meat, Flowers, Honey, U-Pick, Pumpkins, Seasonal, Open Now
- **Trending Near You**: Category tiles showing top categories by farmstand count in area
  - Tapping a category tile navigates to the Map tab with that category filter applied
  - Map automatically zooms to fit all farmstands matching the category
  - Active filter shown as a chip below the search bar with X to clear
  - Example: Tap "Fresh Eggs" → Map shows only egg stands, zoomed to fit all
- **Top Spots For You**: Large horizontal carousel of nearby farmstands sorted by distance
- **Category Carousels**: Baked Goods, Egg Stands, Seasonal Stands - each filtered by category keywords
- **New This Week**: Farmstands added in the last 7 days
- **Most Saved**: Popular farmstands based on user saves
- **Open Now**: Farmstands currently open based on hours
- **Floating Map Button**: Quick access to full map view
- **Heart/Save** on every card with animated feedback
- Cards show: photo, name, categories, distance, open/closed badge, rating
- All carousels are data-driven from the farmstand database

### Category Filtering Rules
Each category section (Baked Goods Near You, Egg Stands Near You, etc.) follows strict filtering rules:

**Matching Logic:**
- Farmstands MUST have matching category tags in `categories` array OR `offerings` array
- Category terms are expanded to related keywords (e.g., "eggs" includes "eggs", "egg", "fresh eggs", "farm eggs")
- A farmstand may appear in multiple categories ONLY if it truly qualifies for each

**Distance Sorting:**
- Within each category, farmstands are sorted by distance from user (closest first)
- Uses GPS location if available, otherwise shows in popularity order

**Empty Categories:**
- If no farmstands match a category, that section is hidden entirely
- Never fills with unrelated farmstands just to show content

**Deduplication:**
- Same farmstand can appear in multiple categories if it qualifies
- Never repeats within the same category section
- **Image Deduplication**: Adjacent cards in horizontal carousels never show the same image
  - Uses `getDeduplicatedCardImages()` to compute unique images for each card
  - If two adjacent farmstands would have the same AI-generated image, the second gets an alternate variant
  - Owner-uploaded photos are always shown as-is (real photos take priority)

**Single Farmstand Handling:**
- If only ONE farmstand exists in a section, it renders as a single centered card
- No horizontal scrolling or "Show all" link when there's only one item
- Prevents awkward empty space or misleading scroll indicators

**Supported Categories:**
- Eggs (eggs, farm eggs, chicken eggs, duck eggs)
- Baked Goods (bread, pastries, sourdough, cookies, pies, cakes)
- Produce (vegetables, fruit)
- Flowers (bouquets, cut flowers, floral)
- Meat (beef, pork, chicken, lamb, sausage)
- Dairy (milk, cheese, butter, cream)
- Honey (honey, honeycomb, raw honey)
- Berries (strawberries, blueberries, raspberries)
- Seasonal (holiday, fall, spring, summer, winter)
- U-Pick (pick your own)
- Pumpkins (pumpkins, gourds, squash)

### Location Permission Flow
First-time users see a polished location permission flow:
- **Pre-Permission Modal**: Custom UI asking to enable location before the native iOS/Android prompt
  - Title: "Find Farmstands near you"
  - Explains why location is used (nearby stands, accurate distances)
  - "Enable Location" button triggers the native permission request
  - "Not Now" button skips without prompting, allowing browsing
- **One-Time Prompt**: The modal only appears once per user (tracked via AsyncStorage)
- **Permission States**: Tracks "unknown", "granted", "denied", or "blocked" status
- **Location Banner**: If permission is denied/blocked, a dismissible banner appears:
  - Shows "Turn on location to see Farmstands near you"
  - "Enable" button to request permission again (if allowed by OS)
  - "Settings" button to open system settings (if blocked)
  - "X" to dismiss for the session
- **Graceful Degradation**: App works without location - users can still browse all farmstands

### Anchor Location System (Distance Calculations)
The app uses a separate "anchor location" concept for distance calculations to ensure distances remain consistent even when the user navigates the map:

**Two Separate Location States:**
1. **anchorLocation** - The user's set location for distance calculations (rarely changes)
2. **selectedFarmstandId** - The currently selected farmstand on the map (changes frequently)

**When anchorLocation Updates:**
- User taps "Use My Location" button
- User enables location permission (initial or re-request)
- App loads with previously saved anchor location from storage

**When anchorLocation Does NOT Update:**
- Tapping a map pin (only updates selectedFarmstandId)
- Tapping a farmstand card
- Zooming or panning the map
- Filtering or searching farmstands

**Distance Display Rules:**
- All farmstand cards show distance from anchorLocation
- If no anchorLocation is set, distance pills are hidden
- Sorting by distance uses anchorLocation, not map center

**Why This Matters:**
Previously, tapping a farmstand pin would zoom the map to that location, causing all distance calculations to update from that farmstand's position. Now, selecting a farmstand only affects the UI selection state - the "anchor" for distance calculations remains at the user's original location.

### Loading Screen
- Simple "F" logo centered on cream background
- Elegant fade-in animation
- Matches brand identity

### Map Tab
- Interactive map of Oregon with farm stand pins
- Tap a pin to see only that farm stand in the bottom sheet
- Move the map to see farms in that area
- **Floating "+" Button (FAB)**:
  - Bottom-right corner of the map, above the bottom sheet
  - Tap to open the Add Farmstand flow
  - Prefills GPS coordinates with current map center location
- **First-Time User Tip**:
  - One-time dismissible banner: "Help grow Farmstand by adding local farmstands you know."
  - Includes "Add a Farmstand" button
  - Permanently dismissed when user taps X or adds a farmstand
- **No Farmstands Banner**:
  - When no farmstands are visible in the current map view (and sheet is collapsed)
  - Shows "Don't see a farmstand here? Add one." with action button
- **Search Radius Filter**:
  - Tap the filter button (sliders icon) next to the search bar
  - Adjust radius from 1-100 miles using a smooth slider
  - Slider uses logarithmic scale for better UX with small values
  - Shows live preview: "Search radius: 37 miles"
  - Toggle "No radius (Show all Farmstands)" to see nationwide results
  - Radius calculated from current map center, not user location
  - **Auto-zoom**: When radius changes, the map automatically zooms to fit the radius circle on screen
  - **Immediate filtering**: Pins and farmstand count update instantly when radius is changed
  - Filter badge shows current radius when active
- **Full-Text Search (Enhanced)**:
  - **Debounced Supabase Search**: 300ms debounce for responsive typing
  - **3-Tier Search Ranking for Names**:
    - **Tier 1 (Best Match)**: Name equals query OR name starts with query (prefix match)
    - **Tier 2**: Any word in the name starts with the query (e.g., "Ek" matches "Ek Farm" but NOT "Creek Farm")
    - **Tier 3 (Fallback)**: Contains match - only used if Tier 1 & 2 return zero results AND query is 3+ characters
  - **Minimum Query Length**: For queries under 3 characters, only Tier 1 and Tier 2 matching is used (no fuzzy "contains" matches)
  - **Result Ordering**: Tier 1 results shown first, then Tier 2, preventing accidental partial matches from appearing before exact matches
  - **Searched Fields**:
    - Farmstand name (uses 3-tier ranking)
    - City, state, zip code
    - Street address
    - Cross street 1 & 2 (for approximate locations)
    - Description/about text
    - Products/offerings array
  - **Product Search**: Also searches the farmstand_products table by product name
  - **Auto-Zoom to Results**: When search results are found, the map automatically zooms to fit all matching farmstands
  - **Loading Indicator**: Shows spinner while search is in progress
  - **Clear Button (X)**: Clears search, resets map to default region, and collapses bottom sheet
  - **No Results State**: Shows "No matches found" with the search query and a "Clear Search" button
  - **Category Expansion**: Searching for categories (e.g., "eggs", "baked goods") expands to related keywords
  - Multi-word search matches all terms (e.g., "organic berries" finds farms with both words)
- **Bottom Sheet with Cards**:
  - Square farmstand images (as tall as wide)
  - Shows farmstand count that updates as you pan/zoom the map
  - Drag the handle bar to expand/collapse
  - Visible collapse button (chevron down) always available
  - Snap points: collapsed (72px) or expanded (content-aware height)
  - Pan down from scroll top to collapse the sheet
  - Sheet never gets stuck - always draggable
  - **Content-Aware Height**: Bottom sheet height adjusts based on visible farmstand count:
    - 1 farmstand: Sheet expands only to fit the card (max 60% screen), no excessive empty space
    - 2+ farmstands: Full expanded height with scrollable list
    - 0 farmstands: Compact height for empty state message
  - **Single Card Enhancement**: When only 1 farmstand is visible:
    - Card is slightly larger with 3:4 aspect ratio image
    - Tapping the card opens the Farmstand detail page
    - Scrolling is disabled (no need to scroll single item)
  - **Count Refresh on Collapse**: When the bottom sheet is collapsed, the selected farmstand state is cleared and the count recalculates based on all visible pins in the viewport (not the previously selected pin)

### Saved Tab
- Save your favorite farm stands for quick access

### Profile Tab
- User profile with stats (Visited, Reviews, Saved)
- Tap stats to view detailed lists
- **Add a Farmstand Card**: Prominent card with title "Add a Farmstand" and subtitle "Help grow the map by adding a local farmstand." Opens the farmstand creation flow. Anyone can add farmstands - ownership/claiming is a separate admin-reviewed process.
- **My Farmstand Section**: Only shown after `userFarmstandsStatus === 'loaded'` (authoritative server data). A neutral skeleton placeholder is shown while status is `'idle'` or `'loading'` — the section never renders from stale cache. Pending-claim users (not yet admin-approved) see "Add a Farmstand" rather than an ownership card. No flicker on first load or refresh.
- **Owner Analytics skeleton gating**: `ProfileAnalyticsSkeleton` is only rendered once `userFarmstandsStatus === 'loaded' && ownedFarmstands.length > 0`. Non-owner members never see the analytics skeleton — only `ProfileFarmstandSkeleton` is shown during loading, which collapses into "Add a Farmstand" when ownership is confirmed false. If the ownership lookup fails, the analytics UI is hidden by default (defensive fallback).
- **Skeleton styling**: Both `ProfileFarmstandSkeleton` and `ProfileAnalyticsSkeleton` use warm off-white tones (`#EDE9E3` base, `rgba(255,252,248,0.65)` highlight) for a soft Airbnb-style sheen. The analytics skeleton background is `#F5F2EE` (warm taupe) instead of the previous blue-tinted `#F5F8FF`.
- Full settings and preferences
- Sign out to return to login screen

### My Farmstand Screen (owner/my-farmstand)
- On mount, always calls `refreshUserFarmstands()` unless the bootstrap store already has a `'loaded'` status with the specific farmstand present — skips the re-fetch for snappiness in that case.
- Shows a loading spinner only while the ownership fetch is in flight AND no farmstand data exists yet. Never shows a permanent/infinite spinner.
- 8-second safety timeout forces unblock if the fetch hangs for any reason.
- If the farmstand is not found after the fetch completes, shows a "Couldn't load farmstand" screen with a Retry button instead of hanging.
- Pull-to-refresh also calls `refreshUserFarmstands()` to pick up any ownership changes.
- On focus, re-fetches ownership if status is `'loaded'` (to pick up admin approvals while screen was open).
- **Delete flow**: After a successful delete, `refreshUserFarmstands()` is called immediately to sync bootstrap store state, then `router.replace('/(tabs)/profile')` navigates the user to Profile. Uses `replace` (not `back`) so the user cannot navigate back into the deleted farmstand. The Profile screen's "My Farmstand" section hides automatically when `resolvedOwned.length === 0`.

### Feedback & Support (profile/rate-us → /api/feedback → admin/feedback)
- "Get Help" on the Help screen navigates to `profile/rate-us` which POSTs to `/api/feedback` (backend)
- Backend saves to the `feedback` Supabase table (service role, bypasses RLS)
- On `feedback_table_missing` error, the user sees a real error message — no silent success
- Admin can view all submissions at `admin/feedback` (accessible via "Feedback & Support" card on Admin Dashboard)
- Admin dashboard shows a count badge for unread (`status=new`) feedback items
- The `feedback` Supabase table must be created manually via the SQL shown in the admin feedback page if missing

### Inbox Tab Badge
- The Inbox tab icon shows a red badge with the total unread count (messages + alerts)
- Alerts are stored in the `inbox_alerts` Supabase table (RLS: user can only read their own rows)
- `alerts-store.ts` queries `/rest/v1/inbox_alerts` (corrected from wrong table name `alerts`)
- Badge updates on every tab focus via `useFocusEffect` in the tab layout

### Owner Analytics (profile/analytics → components/OwnerAnalytics)
- **Farmstand lookup**: Uses `bootstrapFarmstands` (from `bootstrap-store`) as the primary source of approved ownership — NOT `allFarmstands` from the admin store. This is critical for TestFlight where `AsyncStorage` cache may not yet have the newly-approved farmstand, causing `allFarmstands` to be empty.
- Falls back to `allFarmstands` filter only if bootstrap is empty (e.g. for admin viewing other farmstands).
- On mount, calls `refreshUserFarmstands()` to ensure fresh ownership data is present before the farmstand ID is resolved.
- **Zero-state**: Shows all metric cards with 0 values when a new owner has no activity yet, plus a friendly "Analytics are live" banner. Never shows "No Activity Yet" as a replacement for the analytics UI.
- Logs: user id, bootstrap farmstand count, resolved farmstand id, and analytics fetch result are all logged with `[Analytics]` and `[OwnerAnalytics]` prefixes for TestFlight debugging.

### Reviews
- Write reviews for any farmstand (requires login)
- Select star rating (1-5)
- Write detailed text review
- Reviews are saved and visible to all users
- Farmstand owners can respond to reviews
- Mark reviews as helpful
- **Report Reviews**: Users can report inappropriate, spam, inaccurate, offensive, or other problematic reviews

### Reports & Flags
Users can report content that violates community guidelines:
- **Report Types**: Inappropriate content, Spam, Inaccurate information, Offensive language, Other
- **What can be reported**: Reviews (farmstand reports coming soon)
- **Report Flow**: Select reason, optionally add details, submit
- **Admin Review**: Reports appear in the admin dashboard for review
- **Admin Actions**: Resolve (take action) or Dismiss (no violation)
- **Status Tracking**: Reports can be Pending, Resolved, or Dismissed

### 2-Way Support Conversations
When users submit feedback or report a problem, a support ticket is automatically created enabling two-way communication between farmers/users and admins.

**How It Works:**
1. When a user submits feedback via "Rate Us" or "Report a Problem", a support ticket is automatically created
2. The ticket contains the initial message and creates a conversation thread
3. Admins can view and reply to tickets from the Admin Dashboard → Reports & Flags
4. Users can view their tickets and replies in Profile → Support

**Support Ticket Statuses:**
- **Open** - New ticket awaiting admin response
- **Waiting on Farmer** - Admin has replied, waiting for user response
- **Waiting on Admin** - User has replied, waiting for admin response
- **Resolved** - Issue has been resolved by admin
- **Reopened** - User replied to a resolved ticket

**Admin Features (`/admin/ticket-thread`):**
- View full conversation thread
- Reply to user messages
- Mark tickets as Resolved
- Reopen resolved tickets
- Edit admin messages (shows "edited" indicator)

**User Features (`/profile/support`):**
- View all their support tickets
- See ticket status and last update time
- Reply to admin messages
- Sending a message to a resolved ticket automatically reopens it

**Data Structure:**
- `SupportTickets` - Ticket header with status, subject, category, and metadata
- `SupportMessages` - Individual messages in the conversation thread

### Messenger-Style Chat (Farmstand Messaging)

Users can message any Farmstand directly from the listing page. Conversations appear in the Inbox tab (bottom navigation).

**How It Works:**
1. User taps "Message Farmstand" button on any farmstand listing page
2. If user is not logged in, they're prompted to sign in first
3. A chat thread is created (or existing one is opened) between the user and the farmstand owner
4. Both parties can send and receive messages in the same thread

**Starting a Chat:**
- Every Farmstand listing has a "Message Farmstand" button (rust-colored, below Directions/Call buttons)
- Login required to send messages
- Tapping opens existing thread or creates a new one

**Inbox Tab (Bottom Navigation):**
The app has 5 bottom tabs: Explore → Map → Saved → **Inbox** → Profile

The Inbox tab (Hipcamp-style) has two internal tabs:
- **Messages** (default) - Messenger-style inbox showing all chat threads
- **Alerts** - System alerts feed (claim requests, approvals, reviews, flags, announcements)

Messages tab displays:
- Farmstand photo thumbnail
- Farmstand name
- Last message preview
- Timestamp
- Unread badge per thread
- Swipe-to-delete functionality

Alerts tab displays:
- System alerts feed sorted by newest first
- Alert types: claim_request, claim_approved, claim_denied, review_new, listing_flagged, platform_announcement
- Unread indicator (red dot) for unread alerts
- Filter chips: All | Unread
- Tapping an alert marks it as read and navigates to the relevant screen

**Chat Thread Screen (`/chat/[threadId]`):**
- Header with farmstand photo and name (tap to view farmstand)
- Message bubbles (user on right, farmstand/farmer on left)
- Text composer with send button
- Auto-scroll to newest message
- Sender name shown when messages change sender

**Unread Badges:**
1. **Inbox Tab Badge** - Red badge on bottom nav Inbox icon showing total unread count (messages + alerts)
2. **Messages Tab Badge** - Badge on Messages tab showing unread message count
3. **Alerts Tab Badge** - Badge on Alerts tab showing unread alert count
4. **Thread Badge** - Unread dot on each thread in the inbox

**Who Receives Messages:**
- Messages sent "to a Farmstand" are delivered to the farmstand's owner (`farmstand.ownerUserId`)
- The owner sees threads in their own Inbox → Messages

**Data Model:**
- `chat_threads` - Thread header with farmstandId, participantUserIds, lastMessage info — stored in **Supabase** (`chat_threads` table)
- `chat_messages` - Individual messages with threadId, senderUserId, senderRole, text — stored in **Supabase** (`chat_messages` table)
- `chat_thread_states` - Per-user unread tracking with lastReadAt, unreadCount — stored in **Supabase** (`chat_thread_states` table)
- AsyncStorage is used as an offline cache only; Supabase is the source of truth
- Run `mobile/supabase-chat.sql` in the Supabase SQL Editor to create the required tables and RLS policies

**Alerts Data Model (Supabase):**
- `alerts` table with columns: id, user_id, farmstand_id, type, title, body, created_at, read_at, action_route, action_params
- RLS policies: users can only read/update their own alerts

**Badge Clearing:**
- Message badges clear when user opens a thread (marks it as read)
- Alert badges clear when user taps an alert (marks it as read)
- Total unread recalculates automatically

## Profile Features

### Notification Settings
- Access via Profile → Settings → Notifications
- Four toggle options stored in Supabase `user_notification_settings` table:
  - **Messages**: Get notified when someone messages you
  - **Saved Farmstand Updates**: Only Farmstands you saved can send updates
  - **Admin Critical**: Important account and policy updates
  - **Admin Promotions**: Optional promotions and announcements
- Auto-creates default settings on first access (if no row exists)
- Optimistic UI updates with Supabase sync
- Guest users see a sign-in prompt instead of toggles

### Location Settings
- Use current location or select from Oregon cities
- Adjustable search radius (5-100 miles)

### Rate Us
- Rate on App Store
- Submit feedback with star rating, category, message, and optional screenshot

### Help & Support
Single support entry point accessible from Profile → Support section. Airbnb-style consolidated help page featuring:
- **Two Big Cards**: "Get Help" (submit ticket) and "My Tickets" (view conversations)
- **Active Tickets Preview**: Shows up to 3 active tickets inline with status badges
- **Quick Actions**: Email Support
- **FAQs**: Expandable answers to common questions
- **Contact Info**: Support email with response time

The "My Support Tickets" and "Report a Problem" rows have been consolidated into this single Help & Support page for a cleaner Profile experience.

### Settings
- Edit Profile (name, email, photo)
- Change Password
- Notifications (notification preferences)
- Privacy Policy
- Terms of Service
- Delete Account

### Farmer Features
- "Are you a farmer?" CTA leads to onboarding
- 2-step Airbnb-style onboarding with clean typography and staggered animations:
  - **Step 1 - Name, Products & Location (REQUIRED)**:
    - Farmstand name (text input, required)
    - **Photo upload** (optional): Add a photo of the farmstand via camera or photo library. Photo is uploaded to Supabase Storage (`farmstand-photos` bucket) after farmstand creation.
    - Product Categories (multi-select chips): Fruits, Vegetables, Eggs, Dairy, Meat, Honey, Flowers, Baked Goods, Preserves, Herbs
    - Other Products (chip entry): Text input + "Add" button, each entry becomes a removable chip (stored as text[] in `otherProducts`)
    - Location with address autocomplete, interactive map for pin placement
    - Validation: Must have name, at least one product (category OR other product), and valid location
  - **Step 2 - Contact Info (OPTIONAL) + Submit**:
    - First Name, Last Name, Phone, Email (all optional, for verification only)
    - Helper text: "Used only for verification if needed. This information is not public."
    - Ownership disclaimer checkbox (required)
    - Submit button
- Farmer Dashboard with stats (views, rating, reviews, performance)
- Pull-to-refresh dashboard data
- Quick actions to edit listing, manage products, update hours/location
- Recent reviews section with direct navigation

### Farmstand Detail Page (Products Section)
The public farmstand detail page displays products in a unified "Products" section:
- **Category chips**: All selected product categories (Fruits, Vegetables, Eggs, etc.)
- **Other Products chips**: Individually entered items (Maple Syrup, Jam, Soap, etc.)
- Both types render with identical styling (green chip with leaf icon)
- Section labeled "Products" (not "Features" or "Available Products")
- Uses "About" label for description (not "Description")

### Admin Farmstand Management
Admin views (Manage Farmstands → Edit) display:
- Full product categories as selectable chips
- **Other Products section** (conditional display):
  - For **unclaimed/pending farmstands**: Shows read-only chips matching the Offerings style (green pills)
  - For **claimed farmstands**: Shows text input + Add button for adding/removing products
- "About" field for farmstand description (Short Description field removed)
- All product data loads from the same source as public views
- **Seasonal Notes section has been removed** from Admin Edit Farmstand

### Location Modes Feature
For farmstands, users can choose from three different ways to specify their location using a segmented control:

**Global LocationInput Component:**
A unified reusable component (`src/components/LocationInput.tsx`) handles location input across the entire app. Use this component anywhere a location/address is needed:
- Create Farmstand
- Edit Farmstand
- Claim Farmstand
- Admin Approvals
- Any form requiring an address/pin

**Address Entry with Mapbox Geocoding:**
The Street Address field uses debounced Mapbox geocoding to auto-pin locations:
- Users type their address manually (street, city, state, ZIP)
- When address fields change, debounced geocoding (700ms) automatically runs
- Mapbox geocoding is triggered when: street address >= 5 chars, city is set, state is set
- If geocode succeeds: coordinates are set, map pin moves, location shows "verified"
- If geocode fails: existing coordinates are preserved, user can drop pin manually
- **City→ZIP Auto-fill**: When user enters City + State and ZIP is empty, the app attempts to auto-fill the ZIP code from a Supabase `zip_lookup` table
  - If exactly 1 ZIP found → auto-fills
  - If multiple ZIPs for that city → shows hint: "Multiple ZIP codes for this city. Please enter ZIP."
  - If no matches or table not configured → user enters ZIP manually
  - User-entered ZIP is never overwritten
- **Location verification**: "Location verified" status ONLY shown when coordinates are set via:
  - Successful Mapbox geocode
  - Tapping "Locate on Map" button
  - Dragging the pin on the map
  - Using "Use My Location"
- Map fallback always available - users can tap to drop a pin or use GPS

**Mapbox Configuration:**
Add your Mapbox public token to `app.json`:
```json
{
  "expo": {
    "extra": {
      "MAPBOX_PUBLIC_TOKEN": "pk.eyJ1..."
    }
  }
}
```
The geocode utility at `src/utils/geocode.ts` reads this token via `expo-constants`.

**Supabase `zip_lookup` Table (Optional):**
To enable City→ZIP auto-fill, create a table in Supabase:
```sql
CREATE TABLE zip_lookup (
  id SERIAL PRIMARY KEY,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL
);
-- Add RLS policy for public read access
ALTER TABLE zip_lookup ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read" ON zip_lookup FOR SELECT USING (true);
```
Store city names in lowercase for case-insensitive matching.

**Location Mode Options (Add Farmstand - Step 2):**

**Required fields before Submit is enabled (all modes):**
- At least city + state are required in every mode
- Exact Address also requires street address + ZIP
- Use My Location also requires ZIP + confirmed coordinates
- Submit button stays disabled until all required location fields are filled
- `handleSubmit` performs a second full validation pass and blocks submission if anything is missing

1. **Exact Address** (default for farmers/admins)
   - Manual address entry (street, city, state, ZIP)
   - City→ZIP auto-fill when available
   - Map always visible for pin placement
   - "Locate on Map" button or drag pin to set GPS coordinates
   - Best for farmstands with a known street address
   - `isApproximate = false`

2. **Cross Streets / Area** (default for guests - privacy-friendly)
   - For roadside stands or rural locations without exact addresses
   - Choose between:
     - **Cross Streets**: Enter two intersecting roads (e.g., "Jacksonville Hill Rd" & "Cady Rd")
     - **Generic Area**: Enter a description (e.g., "5 miles past Camp Creek Rd on Hwy 26")
   - Specify nearest city/state for better geocoding
   - Auto-geocodes the description with intersection detection
   - Interactive map preview with draggable pin
   - `isApproximate = true`

3. **Use My Location**
   - GPS-based location with one-tap button
   - Requests device location permission
   - Drops pin at current GPS coordinates
   - Reverse geocodes to get nearest city/state
   - **Auto-populates address fields** (street, city, state, ZIP) from reverse geocode
   - Editable address fields appear after pin is placed for verification/correction
   - Optional cross streets field for additional location context
   - Draggable pin for fine-tuning
   - Falls back to Cross Streets mode if permission denied
   - `isApproximate` depends on whether street address was resolved
   - **Saves full address data to Supabase** including cross_streets column

**LocationInput Data Model:**
```typescript
interface LocationInputData {
  // Mode selected
  locationMode: 'exact_address' | 'cross_streets' | 'use_my_location';

  // Display text (what users see)
  displayLocationText: string;

  // Address fields
  addressLine1: string;
  city: string;
  state: string;
  zip: string;

  // Cross streets fields
  crossStreet1: string;
  crossStreet2: string;
  areaType: 'cross_streets' | 'generic_area';
  genericAreaText: string;
  nearestCityState: string;

  // Coordinates (required for map display)
  latitude: number | null;
  longitude: number | null;

  // Metadata
  isApproximate: boolean;
  geoSource: 'GEOCODED' | 'DEVICE_GPS' | 'ADMIN_PIN_ADJUST' | 'USER_PIN_ADJUST' | null;
  geoAccuracyMeters: number | null;
  geocodeConfidence: number | null;
  pinAdjustedByUser: boolean;

  // Optional note (for "Use My Location" mode)
  locationNote: string;
}
```

**Input Behavior (Focus/Blur Pattern):**
All text inputs in the LocationInput component use a focus/blur pattern to prevent geocode from overwriting user input while typing:
- **onFocus**: Sets editing flag (e.g., `isEditingCityRef.current = true`)
- **onChangeText**: Updates only the field value, does NOT trigger geocode
- **onBlur**: Clears editing flag, THEN triggers debounced geocode

This ensures:
- User-typed values are never overwritten while typing
- Geocode only runs after user finishes editing a field
- GPS coordinates update without affecting address fields

**Usage Example:**
```tsx
import { LocationInput, createDefaultLocationData } from '@/components/LocationInput';

const [locationData, setLocationData] = useState(
  createDefaultLocationData('cross_streets') // or 'exact_address' or 'use_my_location'
);

<LocationInput
  value={locationData}
  onChange={setLocationData}
  userRole="guest" // 'guest' | 'farmer' | 'admin'
  labels={{
    title: 'Location',
    subtitle: 'Enter the physical location of the Farmstand.',
  }}
/>
```

**User Role Defaults:**
- **Guests**: Default to "Cross Streets" mode (privacy + low friction)
- **Farmers**: Default to "Exact Address" mode (if claiming/verified)
- **Admins**: Default to "Exact Address" mode but allow all 3

**Map Pin Behavior:**
- All modes include an interactive map preview
- Users can drag the pin to adjust location
- Coordinates display in corner of map
- `pinAdjustedByUser` flag tracks manual adjustments

**Unified Map Pins (FarmstandPinMarker):**
All map markers across the app use a single unified component (`src/components/FarmstandPinMarker.tsx`):
- Green teardrop pin with white circle centered inside
- White dot: ~38% of pin width (12px), centered in the widest part of the teardrop
- Subtle shadow on white dot for better visibility
- Transparent background - NO outer circles, rings, halos, or outlines
- NO selection state visuals - pin appearance never changes
- NO animations (no pulsing, scaling, bouncing)
- Constant size at all times (32px)
- Same design for ALL farmstands everywhere

Usage:
```tsx
import { FarmstandPinMarker } from '@/components/FarmstandPinMarker';

// In a react-native-maps Marker
<Marker
  coordinate={{ latitude, longitude }}
  anchor={{ x: 0.5, y: 1 }}
  onPress={() => handleSelect(farm.id)}
>
  <FarmstandPinMarker />
</Marker>
```

**Map Display:**
- All farmstands show the same clean teardrop pin
- Tapping a pin opens the farmstand preview card (no visual change to pin)
- Clean, minimal, brand-consistent design

**Farmstand Detail Page:**
- Shows amber warning: "Approximate location — verify details before driving out"
- Warning appears under the address when `locationPrecision` starts with "approximate"

**Admin Verification:**
- All approximate listings are flagged for admin review
- Admin Dashboard shows "Approximate Locations" card with count
- Admin screen (`/admin/approx-locations`) displays:
  - Location description and nearest city
  - Geocode confidence score
  - **Interactive map preview** with zoom/pan enabled
  - Recenter button to snap back to stored pin location
  - Expand/collapse map view
  - Whether pin was adjusted by user
- Admin actions:
  - **Adjust Pin**: Opens full-screen map picker to set exact location
    - Tap map or drag pin to set new coordinates
    - Shows original pin (faded) and new pin location
    - Center crosshair for precision
    - Saves and verifies in one action
  - **Confirm Exact**: Verify location is correct, mark as `exact`
  - **Keep Approximate**: Approve but maintain `approximate` status
  - **Request Info**: Ask submitter for better address
  - **Reject**: Hide listing if location cannot be verified

**Database Fields:**
- `locationMode`: 'exact_address' | 'cross_streets' | 'use_my_location' - which mode was used
- `areaType`: 'cross_streets' | 'generic_area' | null - sub-type for cross_streets mode
- `crossStreet1`, `crossStreet2`: string | null - intersection roads
- `genericAreaText`: string | null - area description text
- `nearestCityState`: string | null - nearest city/state for geocoding
- `pinSource`: 'geocode_exact' | 'geocode_approx' | 'device_gps' | 'manual_map_tap' | null
- `useApproximateLocation`: boolean - whether approximate mode was used (derived from locationMode)
- `approxLocationText`: string - user's location description
- `optionalNearestCityState`: string - nearest city/state hint (legacy field)
- `locationPrecision`: 'exact' | 'approximate' | 'approximate_manual'
- `geocodeProvider`: 'expo' | 'google' | 'mapbox' | 'nominatim' | null
- `geocodeConfidence`: number (0-1) - geocoding confidence score
- `pinAdjustedByUser`: boolean - whether user manually moved the pin
- `adminReviewReason`: string | null - e.g., "approx_location"

### Farmer Dashboard
Full farmer management portal with the following screens:

- **Dashboard** (`/farmer/dashboard`) - Overview with stats tiles, quick actions (Manage Products, Update Hours), recent reviews, and tips
- **Settings** (`/farmer/settings`) - Notification preferences, account settings, deactivate listing
- **Edit Listing** (`/farmer/listing/edit`) - Update name, description, categories, photos, contact info
  - **Photo Management**: Upload photos via camera, photo library, or URL
  - **Main Photo Selection**: Tap any photo to set it as the main display image
  - Photos show a "Main" badge and highlighted border when selected
  - **Photo Storage**: Photos are uploaded to Supabase Storage (`farmstand-photos` bucket) and public URLs are saved to the database
    - **CRITICAL**: Only valid Storage URLs (https://...) are stored - local file:// URIs are never saved to the database
    - All photo URL columns are updated: `hero_photo_url`, `hero_image_url`, `photo_url`, `image_url`, and `photos[]` array
    - Card images and hero images validate URLs before display - invalid URIs fall back to AI-generated images
- **Manage Products** (`/farmer/products`) - Add/edit/delete products, toggle stock status
- **Update Hours** (`/farmer/hours`) - Weekly schedule editor with open/close times
- **Update Location** (`/farmer/location`) - Address form with GPS "use current location"
  - **Address Autocomplete**: Select from iOS keyboard suggestions to auto-fill all address fields
  - **Auto GPS Coordinates**: Coordinates are automatically generated when address is complete
  - **ZIP Code Lookup**: If ZIP is missing from autocomplete, it's fetched via reverse geocoding
- **Reviews** (`/farmer/reviews`) - List all reviews with filters (all, unreplied, 5-star, low, flagged)
- **Review Detail** (`/farmer/reviews/detail`) - View full review, post reply, flag inappropriate
- **Views Analytics** (`/farmer/analytics/views`) - Views over time, by source (map, search, etc.)
- **Ratings Analytics** (`/farmer/analytics/ratings`) - Rating distribution, trends
- **Performance** (`/farmer/performance`) - Checklist to optimize listing (photos, description, hours, etc.)

### Farmstand Photo Gallery
When viewing a farmstand:
- **Clickable Main Photo**: Tap the hero image to open the full photo album
- **Photo Count Badge**: Shows number of photos when more than one exists

**Photo Album Screen** (Hipcamp/Airbnb-style layout):
- **Fixed Header Bar**: Back arrow (left) and farmstand name (centered) - positioned below safe area for easy tapping
- **Photos Label**: Simple "Photos · X" label showing total count
- **Featured Hero Image**: First photo displayed as large full-width image at top (280px height)
  - Photo count badge (e.g., "1 of 12") in bottom-right corner
  - Tap to open full-screen image viewer
- **Masonry Grid**: Remaining photos displayed in a two-column staggered layout
  - Varying tile heights (short, medium, tall) create organic visual flow
  - 14px rounded corners, 8px gaps between tiles
  - Smooth fade-in animations on load
  - Tap any tile to open full-screen viewer at that photo's index
- **Performance Optimizations**:
  - Uses `expo-image` with memory-disk caching for fast thumbnail loading
  - FlatList with optimized `windowSize`, `maxToRenderPerBatch`, and `removeClippedSubviews`
  - Memoized tile components prevent unnecessary re-renders
  - Images preloaded (±2 adjacent) when viewer opens
- **Full-Screen Image Viewer** (`react-native-image-viewing`):
  - Native-feeling paging with smooth swipe gestures
  - **Pinch-to-zoom**: Smooth scaling with native gesture handling
  - **Double-tap zoom**: Tap twice to zoom, tap again to reset
  - **Swipe navigation**: Swipe left/right to navigate between photos
  - **Swipe down to dismiss**: Pull down to close the viewer
  - **Photo index indicator**: Shows "4 / 12" at top center
  - **Gesture hints**: Subtle text at bottom explaining controls
- **Collapsible Hours**: Tap the hours row to expand/collapse a full weekly schedule
- **Manage Products Button**: Farmstand owners see a "Manage Product Listings" button on their own listing

## Admin Features

The app includes a full admin panel for managing farmstands, users, and content. Admin access is restricted to the app owner's email (joekociemba@gmail.com) only.

### User Roles
- **admin** - Full access to admin dashboard and management features (owner only)
- **farmer** - Can manage their own farmstands via Farmer Dashboard (granted only after claim approval)
- **guest** - Default role for new users - can browse and submit farmstands, but not manage them
- **consumer** - Regular user who can browse and save farmstands

### Admin Profile Behavior
Admins have special treatment on the Profile screen:
- **No "My Farmstand" section** - Admins manage farmstands via Admin Dashboard, not personal ownership
- **Shows "Admin" subtitle** instead of "Farmstand Manager"
- **Admin Dashboard tile** prominently displayed
- **Platform Analytics** access instead of personal analytics
- Creating a farmstand as admin does NOT assign ownership (remains unclaimed)

**Why admins don't see "My Farmstand":**
- Prevents confusion between admin management and personal ownership
- Admins create listings for the platform, not for themselves
- Ownership only comes from the claiming workflow

### Guest Farmstand Submissions
When a guest creates/submits a farmstand:
1. **Creates listing** with `verificationStatus = "PENDING_VERIFICATION"`
2. **Does NOT** turn the guest into a farmer
3. **Does NOT** enable Farmer Dashboard or farmer tools
4. Listing is **visible on map** but marked as "Pending Verification"
5. Admin must **verify/approve** before it becomes "Verified/Live"

**Guest Permissions:**
- Submit a Farmstand listing (visible on map as Pending)
- View their submission status in Profile → "My Submissions"
- Edit submission draft (if Needs Info status)

**Guest Restrictions:**
- Cannot see "My Farmstand" section in Profile
- Cannot access Farmer Dashboard
- Cannot access owner management pages (my-farmstand, edit, products, hours, location, availability)
- Cannot manage products
- Cannot update hours
- Cannot view analytics
- Cannot respond to reviews as owner

When guests navigate to farmer/owner pages directly, they see a friendly message: "Farmer tools unlock after your Farmstand is claimed or verified."

### My Submissions Screen (`/profile/submissions`)
Dedicated screen for viewing all farmstands a user has submitted. Available to all roles (guest, farmer, admin).

**Features:**
- **Filter tabs**: All, Pending, Verified, Needs Info, Rejected
- **Badge counts** on each filter showing number of submissions in that status
- **Submission cards** showing:
  - Farmstand thumbnail
  - Name and location
  - Status pill with icon (Pending/Verified/Rejected/Needs Info)
  - Date submitted
  - Admin notes (if status is Needs Info or Rejected)
- **Tap to view** the full farmstand detail page

**Why a separate screen:**
- Keeps Profile page clean regardless of submission count
- Works consistently for all user roles
- Provides filtering and better organization

**Profile Integration:**
- "My Submissions" card appears on Profile when user has submissions
- Shows count of submissions in subtitle
- Tapping navigates to `/profile/submissions`

### Verification Workflow
Admin can process pending submissions via Admin Dashboard → Pending Approvals:
1. **Approve/Verify** - Sets `verificationStatus = "VERIFIED"`, listing goes live
2. **Needs Info** - Sets `verificationStatus = "NEEDS_INFO"` with admin note, user can update
3. **Reject** - Sets `verificationStatus = "REJECTED"` with reason, listing hidden

### Becoming a Farmer
Users become farmers only when:
- Their **claim request is approved** by admin
- They claim an existing farmstand via **verification code**

Once approved, the user gains:
- Access to Farmer Dashboard
- Ability to manage products, hours, photos
- Access to analytics
- Ability to respond to reviews

### Admin Dashboard (`/admin/dashboard`)
Central hub with quick access to all admin features:
- **Add New Farmstand** - Quick action button to manually add farmstands
- Manage Farmstands - View, edit, approve, deny, and delete all farmstands (includes pending approvals with filter)
- **Claim Requests** - Review and process farmstand ownership claims
- Manage Users - View, edit roles, suspend, or delete user accounts
- **Reports & Flags** - Review flagged content with count badge showing pending reports
- Settings - Admin preferences

#### Pending Approvals Count (Single Source of Truth)
The pending approvals count is calculated consistently across all screens using a shared function:
- **`getPendingApprovalsCount()`** - Exported from `admin-store.ts`
- **`getPendingFarmstands()`** - Returns the list of pending farmstands
- **ONLY** shows farmstands where `status === 'pending'` AND `deleted_at IS NULL`
- Used by: Dashboard stats card, Manage Farmstands pending filter count

**Status Rules:**
- `status = 'pending'` → Shown in Manage Farmstands with "Pending" filter (waiting for review)
- `status = 'approved'` or `status = 'active'` → Shown in Manage Farmstands with "Active" filter + public app
- `deleted_at IS NOT NULL` → Hidden EVERYWHERE (soft-deleted, never appears in any list or count)

#### Auto-Refresh Behavior
Admin Dashboard and Manage Farmstands screens support:
- **Focus refresh** - Data reloads automatically when navigating to the screen
- **Pull-to-refresh** - Swipe down to manually refresh
- **Post-action refresh** - Data reloads after approve/deny/delete actions

### Admin Settings (`/admin/settings`)
Admin preferences and debugging:
- Auto-approve toggle for new submissions
- Email notification preferences
- Data export and cache management
- **Environment Debug** - Shows app version, SDK, platform, device type, and dev/prod mode

### Reports & Flags (`/admin/reports`)
Review and manage reported content:
- **Tabs**: Pending, Resolved, Dismissed
- **Report Details**: See reported content preview, reporter info, reason, additional details
- **Quick Link**: Navigate directly to the farmstand from any report
- **Actions**:
  - **Resolve** - Mark as resolved with optional admin note (e.g., content removed, user warned)
  - **Dismiss** - Dismiss report with optional note (e.g., false report, content is appropriate)
- **Status Tracking**: Shows when reports were resolved and by whom

### Claim Requests (`/admin/claim-requests`)
Review and process farmstand ownership claims:
- View all pending claim requests sorted by newest first
- See farmstand name, location, requester info (name, email, role) - read directly from `claim_requests` table
- View submitted message and proof photo (if provided)
- **Approve** - Calls `supabase.rpc('approve_claim')` which updates claim status to "approved", sets farmstand `claim_status` to "claimed" and assigns owner
- **Deny** - Calls `supabase.rpc('deny_claim')` which updates claim status to "denied" and resets farmstand `claim_status` to "unclaimed"
- **Request More Info** - Updates status to "needs_more_info" with admin note for requested information

**Pending Claim Definition (SINGLE SOURCE OF TRUTH)**:
Both the Admin Dashboard and Claim Requests screen use the SAME definition:
```
Table: claim_requests
Filter: status = 'pending'
```
- `submit-claim.ts` (backend) inserts into `claim_requests` with `status='pending'`
- The Claim Requests screen primary path: backend endpoint `GET /api/admin/pending-claims` which queries `claim_requests` (service role, bypasses RLS)
- Falls back to `get_pending_claims_for_admin()` SECURITY DEFINER RPC, then direct `.from('claim_requests').select('*').eq('status','pending')`
- **IMPORTANT**: The canonical table is `claim_requests`. Do NOT query `farmstand_claim_requests` — that table does not exist and was a historical naming error.
- Both screens refresh on focus (useFocusEffect) so counts always match
- After approve/deny, UI re-fetches from database (no optimistic updates)

**SQL to run in Supabase**: `mobile/supabase-fix-admin-claims-rpc.sql` — creates the `get_pending_claims_for_admin()` RPC and fixes the admin RLS SELECT policy to check `auth.users` email as well as JWT email claim.

**IMPORTANT**: Requester info is stored directly in `claim_requests.requester_email` and `claim_requests.requester_name`. No queries to `public.users` table are made (that table doesn't exist and causes permission errors).

### Farmstand Claiming
Users can claim unclaimed farmstands to manage their own listings:
- Unclaimed farmstands show a "Claim this Farmstand" button on their detail page
- **Login Required**: Users must be logged in to submit a claim request
- **Claim Request Form**: When tapping "Claim this Farmstand", users must provide:
  - Full Name (required, editable) - stored in `claim_requests.requester_name`
  - Email (required, auto-filled from user profile and read-only) - stored in `claim_requests.requester_email`
  - Photo Evidence (required, 1-3 photos proving ownership - sign, stand, products, business card, etc.)
  - Additional Notes (optional)
- **Supabase Integration**: Claim requests are submitted directly to Supabase `claim_requests` table with:
  - `farmstand_id` = the farmstand being claimed
  - `user_id` = auth user's ID
  - `requester_id` = auth user's ID (same as user_id)
  - `requester_email` = user's email from user profile
  - `requester_name` = user's name from form input
  - `status` = 'pending'
- **Admin Review Flow**: Claim requests go to the Admin → Claim Requests tab for review
  - Does NOT set `claimed_by` immediately
  - Only admin approval (via RPC) sets the farmstand as claimed
- **"Claim when creating" checkbox**: When creating a farmstand via onboarding:
  - Checking "I am the owner" does NOT auto-create a claim request
  - Instead, after farmstand creation, user is prompted to complete claim request with photo evidence
  - User is redirected to the farmstand detail page with the claim modal open
  - This ensures all claims require proper photo evidence
- **Pending State**: After submitting a claim request:
  - Detail page shows a compact "Claim pending" banner (amber/warning style with clock icon + "Pending" pill)
  - Claim button is hidden
  - User cannot submit duplicate claims
- **Per-Farmstand Claim Status**: The farmstand detail page queries for THIS farmstand + THIS user's claim status:
  ```typescript
  from('claim_requests')
    .select('id,status,created_at')
    .eq('farmstand_id', farmstandId)
    .eq('user_id', authUserId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  ```
- **Session Persistence**: After signup/signin, the Supabase JWT session is stored both in-memory and AsyncStorage
  - Session is automatically restored on app restart
  - Authenticated requests use the JWT token (not anon key) for RLS compliance
- **Claim Logic**: A farmstand is "claimed" when `owner_id IS NOT NULL` in the database (authoritative). `claimed_by` is a legacy fallback column that is also set on approval.
- **ClaimStateEnum**: The detail page derives a single enum from DB fields — the single source of truth for all UI:
  - `'owned'` = `claim_status === 'claimed'` AND `owner_id === currentUser.id`
  - `'claimed'` = `claim_status === 'claimed'` AND owner is someone else (NOT claimable — hides "Claim" button and shows "Message" button)
  - `'pending'` = `claim_status === 'pending'` or user has a pending claim_request
  - `'can_claim'` = unclaimed, user can submit a claim
  - `'unknown'` = initial loading state
- **`isClaimed` check**: Returns `true` when `claimEnum === 'owned' || claimEnum === 'claimed'`. This is the guard that shows "Message this Farmstand" instead of "Claim this Farmstand". Previously only checked `claimEnum === 'owned'`, causing a bug where non-owners saw "Claim this Farmstand" on already-claimed farmstands.
- **Fresh State**: Detail pages always fetch fresh claim state from Supabase on load
- **UI Behavior**:
  - If `owner_id IS NULL` and no pending request: Show "Claim This Farmstand" button
  - If `owner_id IS NULL` and has pending request: Show compact "Claim pending" banner
  - If `owner_id IS NOT NULL` and matches current user: Show "Manage Farmstand", hide Claim button
  - If `owner_id IS NOT NULL` but belongs to another user: Hide claim button (farmstand is claimed)
- **Owner Assignment**: When approved via `approve_claim` RPC, both `owner_id` AND `claimed_by` are set to the claimant's user ID
- **Profile Access**: After claim approval, the "My Farmstand" section appears on the claimant's Profile tab (matched by `ownerUserId === user.id` which maps from `owner_id` column)

### Database Columns for claim_requests
The `claim_requests` table has these columns (avoid inserting to non-existent columns):
- `id` - UUID primary key
- `farmstand_id` - UUID foreign key to farmstands
- `user_id` - UUID of the requesting user
- `requester_id` - UUID of the requester (same as user_id)
- `requester_email` - Email of the requester
- `requester_name` - Name of the requester
- `status` - 'pending' | 'approved' | 'denied' | 'needs_more_info'
- `reviewed_by` - UUID of admin who reviewed
- `reviewed_at` - Timestamp when reviewed
- `created_at` - Timestamp when created

**DO NOT use these columns (they do not exist):**
- `requester_role`
- `reviewed_by_admin_id`
- `evidence_urls`

### Importing Farmstands from External Sources

Farmstands can be bulk-imported from CSV/spreadsheet data. All imported listings are automatically created as **unclaimed and unverified**.

#### Import Data Format
Each row in the import file maps to these fields:
- `farmstand_name` → name
- `street_address` → addressLine1
- `city`, `state`, `zip` → address fields
- `full_address_as_listed` → stored in adminNotes
- `description` → description
- `hours_text` → seasonalNotes (text-based hours)
- `payment_methods` → paymentOptions (comma-separated)
- `products` → offerings (comma-separated)
- `tags` → categories (comma-separated, e.g., "baked_goods, eggs, honey")
- `source` → stored in adminNotes
- `notes` → stored in adminNotes

#### Critical Unclaimed/Unverified Defaults
Every imported farmstand is created with:
- `claimStatus: 'unclaimed'`
- `verificationStatus: 'PENDING_VERIFICATION'`
- `claimedByUserId: null`
- `claimedAt: null`
- `verifiedAt: null`
- `ownerUserId: 'system'` (no actual owner)

#### UI Behavior for Imported Farmstands
- Show "Pending Verification" banner on detail page
- Show "Unclaimed Listing" card with "Claim this Farmstand" button
- Do NOT show owner-only tools (My Farmstand, edit, products, hours, etc.)
- Use AI-generated hero images based on tags/products

#### Adding New Imports
To add more farmstands:
1. Add rows to `src/lib/imported-farmstands.ts` in the `IMPORTED_FARMSTANDS` array
2. The import runs automatically when admin data loads
3. Duplicate detection prevents re-importing by matching on name (case-insensitive)

#### Current Imported Sources
- **Facebook Ads Manual Entry** (January 2026): 6 farmstands from Oregon ad screenshots
  - Lorenz Farmstand (Gervais)
  - Wildlings Cottage Farmstand (Warren)
  - NE 143rd Farmstand (Portland)
  - The Little Jar Farmstand
  - Brightwood Loop Farmstand (Brightwood)
  - Oxbow Pkwy Farmstand (Gresham)

- **Manual Admin Seed** (January 2026): 15 farmstands from spreadsheet data
  - Farmstand Sourdough (Cornelius, OR)
  - Farm Stand Open in Newberg (Newberg, OR)
  - Harvest Farm Stand (McKenzie Fire Station area, OR)
  - Farmstand (Depoe Bay, OR)
  - Farm stand (Boring, OR)
  - Sourdough Self Serve Farm Stand (Eugene, OR)
  - Non Toxic Candles (Sisters, OR)
  - Potpourri kits (Longview, WA)
  - Farm Stand Goods (Lebanon, OR)
  - Salt Creek Goods Farmstand (Dallas, OR)
  - Milagro Farmstand (OR)
  - Windmill Springs Farm (OR)
  - Hilltop Homestead Farmstand (Kerby, OR)
  - Jacksonville Hill Farmstand (Jacksonville, OR)

#### Seeded Listing Rules
All imported/seeded farmstands follow strict rules:

**Status:**
- `claimStatus = unclaimed`
- `verificationStatus = unverified` (PENDING_VERIFICATION)
- `approvalStatus = pending`
- `visibility = admin_only`

**Ownership:**
- `ownerUserId = null`
- `createdByUserId = system_seed`
- `createdByRole = system`

**Trust and Safety:**
- `claimingDisabled = true`
- `reviewsEnabled = false`
- `messagingEnabled = false`

**UI Behavior:**
- `showStatusBanner = true`
- `statusBannerText = "This Farmstand is pending verification"`
- `statusBannerType = neutral`

**Import Flags:**
- `seededListing = true`
- `importSource = manual_admin_seed`
- `confidenceLevel = low`

**Default Map Behavior:**
- Geocode address for map pin
- Do not show pin publicly until approved

**Admin Workflow:**
- New farmstands sent to Admin Dashboard → Pending Review
- Admin must approve before public visibility
- Once approved, enable claim request flow
- Rejected listings are archived, not deleted

**Restrictions Until Approved:**
- Cannot be claimed
- Cannot receive messages
- Cannot receive reviews

### AI-Generated Hero Images

For unclaimed or unverified farmstands, the app displays category-based illustrative images instead of real photos. This ensures all listings look polished while clearly communicating trust and ownership status.

**STANDARDIZED: hero_image_url is THE SINGLE SOURCE OF TRUTH**

All farmstand images (hero, cards, map, explore) read from ONE field: `hero_image_url`

**Image Priority (Highest to Lowest)**
1. `hero_image_url` - THE SINGLE SOURCE OF TRUTH for all uploaded and AI images
2. Category-based AI fallback - Dynamically selected based on offerings/categories
3. `DEFAULT_FARM_IMAGE` - Fallback that prevents blank cards

**DEPRECATED fields (legacy support only):**
- `hero_photo_url` - Migrate to hero_image_url
- `ai_photo_url` - Migrate to hero_image_url
- `photos[]` array - Migrate to hero_image_url
- `photo_url`, `image_url` - Legacy fields

**Photo Upload Flow**
After selecting/taking a photo:
1. Upload to Supabase Storage bucket (`farmstand-photos`)
2. Get the public HTTPS URL from the upload response
3. Store ONLY the HTTPS URL in `photos[]` array
4. On save/publish, set `hero_image_url` to the main photo's HTTPS URL
5. NEVER save local file:// paths to the database

**Files with Photo Upload:**
- `src/app/owner/edit.tsx` - Owner farmstand editing
- `src/app/admin/farmstand-edit.tsx` - Admin farmstand editing
- `src/app/farmer/listing/edit.tsx` - Farmer listing editing
- `src/app/farmer/onboarding.tsx` - New farmstand creation

All these files use `uploadToSupabaseStorage()` from `@/lib/supabase` to upload photos before saving.

**CRITICAL: Images are STABLE and PERSISTENT**
- Each farmstand gets ONE hero image that NEVER changes automatically
- Images are stored permanently in `hero_image_url`
- AI images are generated ONCE when first viewed (if hero_image_url is NULL)
- After generation, the same image displays every time
- No random rotation - neighboring cards will always have different images

### Unique AI Image Generation (Main Product System)

Each farmstand can have a unique AI-generated image based on their selected "Main Product". This ensures no two farmstands share the same AI image.

#### How It Works
1. Farmer selects a "Main Product" from the Edit Listing screen (eggs, honey, flowers, produce, beef, pork, etc.)
2. If no uploaded photo exists (`hero_image_url` is null), the system generates a unique AI image
3. The AI image seed is deterministic: `{farmstandId}:{mainProduct}` - ensuring uniqueness
4. The generated image is saved to `ai_image_url` and displayed everywhere

#### Main Product Options
- eggs, honey, flowers, produce, beef, pork, chicken, dairy, fruit, veggies
- baked_goods, jams, crafts, plants, u_pick, pumpkins, christmas_trees, other

#### Database Fields (NEW)
- `main_product` (text): Selected main product category
- `ai_image_url` (text): OpenAI-generated image URL based on main_product
- `ai_image_seed` (text): Deterministic seed `{farmstandId}:{mainProduct}`
- `ai_image_updated_at` (timestamptz): When AI image was last generated

#### Image Priority (Updated)
1. `hero_image_url` - UPLOADED PHOTO (always takes priority)
2. `ai_image_url` - UNIQUE AI IMAGE based on main_product
3. Category-based fallback from offerings (legacy system)
4. Default farm image (never blank)

#### Backend API
POST `/api/ai-image/generate` - Generates unique AI image using OpenAI gpt-image-1
- Request: `{ farmstandId: string, mainProduct: string }`
- Response: `{ success: true, aiImageUrl: string, aiImageSeed: string, aiImageUpdatedAt: string }`

#### Image Source Debugging
Console logs are added to track which image source is being used:
- `[CardImage] Using UPLOADED photo for farmstand {id}` - User-uploaded photo from hero_image_url
- `[CardImage] Using AI fallback ({key}) for farmstand {id}` - AI-generated image based on offerings
- `[HeroImage] Using UPLOADED photo for farmstand {id}` - Hero image from hero_image_url
- `[HeroImage] Using AI fallback (category-based) for farmstand {id}` - AI fallback
- `[FarmstandHeroImage] Using UPLOADED photo for farmstand {id}` - Component using uploaded photo
- `[FarmstandHeroImage] Using AI fallback for farmstand {id}` - Component using AI fallback
- `[HeroImageService] Farmstand {id} has UPLOADED photo, skipping AI generation` - Service skipping AI
- `[HeroImageService] Farmstand {id} has NO uploaded photo, generating AI fallback` - Service generating AI

#### Database Fields
- `hero_image_url`: THE SINGLE SOURCE OF TRUTH - all uploaded photos go here
- `hero_image_theme`: The detected theme (eggs, produce, flowers, etc.)
- `hero_image_seed`: Random seed (0-999999) for variety selection
- `hero_image_generated_at`: Timestamp when AI image was generated

#### When AI Images Are Used
- **Unclaimed Farmstands**: No owner has claimed the listing yet
- **Pending Verification**: Submitted by community but not yet verified
- **No Owner Photo**: Verified owner hasn't uploaded a hero image yet

#### Theme Detection Logic
Theme is determined from farmstand data (in priority order):
1. First item in `offerings` array
2. First item in `categories` array
3. Fallback to `farm_produce`

Valid themes: eggs, produce, vegetables, fruit, honey, baked_goods, flowers, dairy, meat, herbs, preserves, plants, crafts, farm_produce

#### Category-Based Image Selection
AI images are automatically selected based on the farmstand's product categories:
- **Flowers**: Flower fields, bouquets, fresh-cut flowers
- **Produce**: Vegetables, fruit stands, harvest scenes
- **Eggs**: Eggs, cartons, rustic farm setting
- **Meat**: Packaged farm meat, coolers, rustic branding
- **Honey**: Honey jars, honeycomb, bees (no people)
- **Dairy**: Milk, cheese, farm dairy products
- **Baked Goods**: Breads, pastries, rustic baking
- **Preserves**: Jams, canned goods, mason jars
- **Plants**: Seedlings, nursery, potted plants
- **Mixed/General**: Roadside farmstand with produce

#### Image Guidelines (HARD RULES)
All AI-generated images must be:
- **ABSOLUTELY NO PEOPLE** - No faces, hands, silhouettes, or human figures
- Generic and non-branded
- Free of logos, text, or signage
- Not implying ownership or endorsement
- Representative of product type only
- Realistic photography style (no illustrations or fantasy art)
- Farm products, structures, and landscape only

#### Image Variety System
To prevent duplicate images on adjacent farmstand cards:
- Each category has **3+ image variations** stored in theme variants
- Images are selected using the **seed** stored in the database
- Seed is generated ONCE and stored permanently
- **Adjacent card deduplication**: Different seeds ensure different variants
- Same farmstand ALWAYS gets the same image (no random changes on refresh)

#### Image Priority Logic
1. **Owner-uploaded Photo** → Use owner's photo
2. **Stored hero_image_url** → Use the database-stored image
3. **No stored image** → Generate once, save to DB, then display
4. **Load failure** → Show neutral farm placeholder

**Note**: AI-generated images display cleanly without overlays. The "illustrative" nature is communicated via the Unclaimed Listing info box below the photo, not on the image itself.

### Smart Card Images (Map + Explore)

All Farmstand cards throughout the app now display intelligent, product-focused images using the following priority system:

#### Image Priority Rules
For every Farmstand card on Map and Explore screens:
1. **HARD OVERRIDE: Eggs** → If farmstand has "eggs" in offerings/categories, ALWAYS show eggs image
2. **Uploaded cover photo** → Display that image (primary_image_mode = 'uploaded')
3. **Stored fallback_image_key** → Display the image mapped to that key
4. **Stored hero_image_url** → Display the permanent database image
5. **Derive from offerings/categories** → Generate fallback_image_key using HIGH_PRIORITY_CATEGORY_RULES
6. **Fallback** → Display neutral farmstand placeholder (farm_default, never blank)

#### HIGH_PRIORITY_CATEGORY_RULES (Priority Order)
When deriving an image from offerings/categories, the following order ALWAYS applies:
1. **Eggs** - eggs, farm fresh eggs, duck eggs, etc. → eggs image
2. **Honey** - honey, honeycomb, raw honey → honey image
3. **Beef** - beef, grass-fed beef, steaks → meat image
4. **Pork** - pork, bacon, sausage → meat image
5. **Poultry** - poultry, turkey, chicken meat → meat image
6. **Meat** - meat, lamb, venison → meat image
7. **Dairy** - dairy, milk, cheese → dairy image
8. **Flowers** - flowers, bouquet → flowers image
9. **Baked Goods** - bread, bakery, pastries → bread image
10. **Preserves** - jams, pickles → preserves image
11. **Pumpkins** - pumpkins, gourds, squash → pumpkin image
12. **Berries** - berries, strawberries → berries image
13. **Tomatoes** - tomatoes → tomatoes image
14. **Corn** - corn, sweet corn → corn image
15. **Fruit** - fruit, apples, peaches → fruit image
16. **Plants** - plants, seedlings → plants image
17. **Herbs** - herbs → herbs image
18. **Crafts** - crafts, soaps, candles → crafts image
19. **Produce/Vegetables** - produce, vegetables (LAST, uses mixed_produce_colorful)
20. **Default** - farm_default (generic farmstand scene)

#### Fallback Image Keys (NEW)
Each Farmstand can have a `fallback_image_key` that determines which AI image to show when no uploaded photo exists:
- `eggs_fresh_carton_closeup` - Eggs, farm fresh eggs, duck eggs
- `artisan_bread_loaves_rustic` - Baked goods, bread, pastries
- `honeycomb_jar_drizzle` - Honey, honeycomb, raw honey
- `bouquet_field_handpicked` - Flowers, bouquets, cut flowers
- `farm_ranch_cuts_wrapped` - Meat, beef, pork, lamb (tasteful, not graphic)
- `mixed_produce_colorful` - Produce, vegetables (**NEVER asparagus**)
- `jars_of_jam_on_table` - Preserves, jams, pickles
- `fresh_herbs_bundle` - Herbs, fresh herbs
- `handmade_goods_table_display` - Crafts, soap, candles
- `dairy_products_display` - Dairy, milk, cheese
- `potted_plants_nursery` - Plants, seedlings, nursery
- `pumpkin_autumn_display` - Pumpkins, gourds, squash
- `fruit_basket_colorful` - Fruit, apples, peaches
- `tomatoes_vine_heirloom` - Tomatoes
- `corn_fresh_harvest` - Corn, sweet corn
- `berries_fresh_basket` - Berries, strawberries, blueberries
- `farm_default` - Neutral farm scene (default fallback)

**HARD RULE: Asparagus is EXCLUDED from all produce/vegetable images.** Produce always defaults to `mixed_produce_colorful` which uses tomatoes, berries, and greens.

#### Centralized Image Function
All card images across the app use a single function: `getFarmstandCardImage(farmstand)`

**Used in:**
- Explore screen (FarmstandCard)
- Map screen (bottom sheet cards)
- Favorites screen (SavedFarmstandCard)
- Search results
- Visited farms

This ensures the same farmstand shows the same image everywhere.

#### Image Load Error Handling (NEW)
If an image fails to load (404, timeout, etc.):
1. The card automatically switches to the fallback image using `getFailsafeFallback()`
2. If the fallback also fails, displays `FAILSAFE_FALLBACK_IMAGE` (neutral farm scene)
3. **Cards are NEVER blank** - there's always a visible image

#### Database Fields
- `primary_image_mode` ('uploaded' | 'ai_fallback') - Whether using real or AI photo
- `fallback_image_key` (string) - Key for AI fallback image selection
- `hero_image_url` (string) - Stored hero image URL
- `hero_image_theme` (string) - Theme for hero image generation
- `hero_image_seed` (number) - Seed for image variety selection

#### AI Image Generation Rules
When generating/selecting an AI image:
- Based ONLY on what the Farmstand sells (eggs, produce, beef, honey, flowers, pumpkins, fruit, etc.)
- **No people, faces, text, signs, logos, watermarks**
- **No stylized or fantasy art**
- Style: Realistic photography, natural daylight, clean, premium, inviting
- Shallow depth of field, wide horizontal crop
- Products clearly visible, center-weighted framing
- Farmstand-appropriate setting (tables, crates, baskets, wood)

#### Product Category Images
AI images are automatically selected based on farmstand offerings:
- **Eggs**: Farm fresh eggs in rustic setting
- **Produce**: Fresh vegetable arrangements
- **Fruit**: Fresh fruit displays, berries, apples
- **Baked Goods**: Artisan breads and pastries
- **Meat/Beef**: Farm-raised meats
- **Honey**: Honey jars and honeycomb
- **Flowers**: Cut flower bouquets
- **Pumpkins**: Autumn pumpkin displays
- **Dairy**: Milk and cheese products
- **Preserves**: Mason jars of jams
- **Plants**: Potted plants and seedlings
- **Mixed**: Farmstand with assorted products

#### Image Persistence (NEW)
- **Images are stored in the database** - not generated on each render
- **hero_image_url** field stores the permanent image URL
- **One-time generation**: Image is generated only when `hero_image_url` is NULL
- **No cache invalidation**: Image stays the same until manually replaced
- **Consistent display**: Same image on map, explore, and detail pages

#### Regeneration Rules
- **Owner uploads real photo** → Real photo takes priority immediately
- **Manual admin reset** → Admin can clear hero_image_url to trigger new generation
- AI images do NOT regenerate automatically - they are permanent
- Product/offering changes do NOT trigger regeneration (image remains stable)

#### UI Result
- Farmstand cards always show relevant, product-focused images
- No random people or unrelated farming visuals
- Cards feel intentional, clean, and product-focused
- Matches Hipcamp/Airbnb quality level

#### Unclaimed Card Message
The unclaimed info card on farmstand detail pages dynamically updates its message based on whether an AI image is shown, encouraging owners to claim and add real photos.

### Gold Verified Badge System

The Gold Verified Badge is an enhanced verification status that recognizes farmstands trusted by the community over time.

#### Eligibility Criteria
A farmstand is automatically eligible for Gold Verified status when ALL conditions are met:
1. **90 days active** - Listing has existed for at least 90 days
2. **4.0+ average rating** - Maintained a high average rating
3. **7+ reviews** - Accumulated at least 7 reviews (configurable 5-10)
4. **No open disputes** - No unresolved ownership disputes

#### Automatic Evaluation
Gold Verified status is automatically evaluated when:
- A new review is created
- A review is edited or removed
- Ownership dispute status changes
- Farmstand is edited by owner/admin
- Daily scheduled evaluation (for accuracy)

#### Admin Manual Control
Admins can override automatic status via Admin Dashboard → Edit Farmstand → Gold Verified Badge section:
- **Toggle Gold Verified** - Manually enable/disable the badge (sets source to "admin")
- **Return to Automatic** - Restore automatic evaluation based on criteria
- **Dispute Status** - Set ownership dispute status (none/open/resolved)

Admin overrides are never modified by automatic evaluation.

#### Badge Display
- **Gold Verified Ribbon**: A small gold Award icon (`lucide-react-native`) appears inline next to the farmstand name when `goldVerified === true`
- The ribbon appears consistently across:
  - Explore screen farmstand cards
  - Map pin preview cards
  - Farmstand Details page header
  - Manage Farmstands admin list
  - Favorites page saved cards
- **Regular Verified**: Standard badge for claimed farmstands that don't meet Gold criteria (shown only on detail page)
- Only ONE badge type shown (Gold takes priority over regular)
- The ribbon is small (about 14-20px), clean, and doesn't push layout around

#### Ownership Dispute Behavior
- When a dispute is opened on a non-admin-controlled farmstand, Gold status is automatically removed
- When a dispute is resolved, the farmstand is re-evaluated for Gold status
- Admin-controlled badges are not affected by dispute status changes

#### Data Fields
- `goldVerified` (boolean) - Current Gold Verified status
- `goldVerifiedSource` ("auto" | "admin" | "none") - How the status was set
- `ownershipDisputeStatus` ("none" | "open" | "resolved") - Current dispute status
- `lastActivityAt` (datetime) - Last farmstand activity (for future features)
- `reviewCount` (number) - Total number of reviews
- `avgRating` (number) - Average rating from reviews

### GPS Auto-Populate (Shared Logic)
Both Admin Edit Farmstand and Pending Approvals use the same geocoding function (`resolveFarmstandCoordinates`):

**Supported Input Formats:**
1. **Full Address** - "123 Main St, Portland, OR 97201"
2. **Cross Streets** - "SE Sunnyside Rd & 122nd Ave, Clackamas, OR"
   - Detected by patterns: " & ", " and ", " / ", " @ ", " at "
3. **Device GPS** - "Use My Location" button for admin's current position

**Geocoding Behavior:**
- Auto-triggers when addressLine1, city, state, or zip change
- Debounced 600ms to prevent excessive API calls
- Cancels prior requests if new input arrives
- Does NOT clear existing lat/lng on geocode failure (shows warning instead)

**Geocode Source & Confidence:**
- `address` + `high` - Full street address geocoded successfully
- `cross_streets` + `medium` - Intersection geocoded (approximate)
- `device` + `high` - Device GPS coordinates
- `manual` + varies - Admin manually entered coordinates

### Manage Farmstands (`/admin/farmstands`)
Unified farmstand management screen that serves as the single admin review + management interface for ALL farmstands:

**Loading & Filtering:**
- Loads all farmstands where `deleted_at IS NULL` (both `status='pending'` and `status='active')
- Default sort: Pending first, then active (most recent first within each group)
- **Filter chips**: All / Pending / Active with count badges
- Search by name, city, or zip code
- Sort by recently updated, name, or city

**Action Buttons (depend on status):**
- **If `status === 'pending'`**: Show **Approve** and **Deny** buttons directly on the card
  - Approve: Updates `status='active'` and `deleted_at=null`
  - Deny: Soft deletes via `deleted_at = new Date().toISOString()`
- **If `status === 'active'`**: Show standard actions menu
  - Edit - Open full edit form
  - Duplicate - Create a copy as draft
  - Hide/Unhide - Toggle visibility
  - Delete - Soft delete (`deleted_at = new Date().toISOString()`)
  - View on Map - Jump to location on map

**Important Supabase Filters:**
- Uses JavaScript `null` (not the string 'null') for `deleted_at` checks
- All queries use `.is('deleted_at', null)` to exclude soft-deleted farmstands

**Post-Action Refresh:**
- After any action (approve/deny/delete), immediately re-fetches from Supabase so the list reflects the current database state

### Manage Users (`/admin/users`)
Full user account management:
- View all users with role and status
- **Change Role** - Assign admin, farmer, or consumer role
- **Suspend User** - Temporarily disable account
- **Reactivate User** - Re-enable suspended account
- **Delete User** - Permanently remove account
- Owner account (joekociemba@gmail.com) is protected and cannot be modified

### Add/Edit Farmstand (`/admin/farmstand-edit`)
Comprehensive form with all farmstand fields:
- **Basic Info**: Name, short description, full description
- **Location**: Address, city, state, zip, latitude/longitude
  - Auto-geocodes on address change (supports cross streets)
  - "Use My Location" button for device GPS
  - Shows geocode source and confidence level
- **Contact**: Phone, email, website
- **Offerings**: Multi-select (Eggs, Produce, Meats, Baked Goods, etc.)
- **Payment Options**: Cash, Card, Venmo, PayPal, Check
- **Status**: Draft, Pending Approval, Active, Hidden
- **Show on Map**: Toggle visibility on public map
- **Seasonal Notes**: Special hours or seasonal closures

### Farmstand Status
- **Draft** - Not visible, work in progress
- **Pending** - Submitted, awaiting admin approval
- **Active** - Live and visible on the map
- **Hidden** - Temporarily hidden from map

### Accessing Admin
Admin access is restricted to the app owner (joekociemba@gmail.com). The Admin Dashboard button appears on the Profile screen only for the authorized admin. Non-admin users are redirected to Home if they try to access admin routes directly.

### Promotions System

The app includes a comprehensive promotions system allowing admins to manually feature farmstands and an automatic popularity-based system that promotes top performers.

#### Admin Promotions Dashboard (`/admin/promotions`)
Central hub for managing promoted farmstands:
- **Overview Cards**: Active promotions, Auto-Featured, Scheduled, Expired counts
- **Search**: Find any farmstand to promote
- **Filter Tabs**: All, Active, Scheduled, Expired, Auto-Featured
- **Farmstand Cards**: Show promotion status, map boost badge, categories, popularity score

#### Promotion Editor (`/admin/promotion-edit`)
Hipcamp/Airbnb-style editor for configuring farmstand promotions:
- **Placement Toggles**:
  - Feature on Explore - Show in Explore category carousels
  - Boost on Map Cards - Show at top of Map bottom sheet
- **Category Selection**: Multi-select up to 3 Explore categories (Eggs, Produce, Baked Goods, etc.)
- **Schedule Options**:
  - Always On - Promotion runs until removed
  - Scheduled - Set start and end dates (validated: end must be after start)
- **Rotation Settings**:
  - Priority slider (0-100) - Higher = appears higher in lists among selected promos
  - Rotation weight (1-5) - Higher = more likely to be selected when there are more promos than slots
- **Remove Promotion** - Clear all promotion settings

#### How Promotions Work

**Manual Promotions (Admin-Controlled)**
- Admin selects farmstands to promote
- Assigns to specific Explore categories
- Sets priority and rotation weight
- Optionally schedules start/end dates
- Up to 5 manual promos appear in top 10 of each category

**Weighted Rotation Algorithm**
When there are more promoted farmstands than available slots:
1. Each promo gets a "selection score" = (priority × 100) + (rotationWeight × randomFactor × 250)
2. Higher priority items are more likely to be selected
3. Higher rotation weight (1-10) adds more variance, increasing chances of appearing
4. Rotation changes daily (seeded by date + category for consistency throughout the day)
5. Selected promos are then sorted by priority for display order

**Auto-Featured (Popularity-Based)**
- System automatically promotes top-performing farmstands
- Based on popularity score calculated from:
  - Clicks (1 point each)
  - Saves (3 points each)
  - Messages (4 points each)
  - Reviews (5 points each)
  - High rating bonus (×1.15 if avg rating ≥ 4.5)
- Auto-featured fills remaining top 10 slots after manual promos

**Explore Page Integration**
- Category carousels show promoted farmstands first
- Top 10 = up to 5 manual promos (selected via weighted rotation) + auto-featured
- Rotation changes daily when more than 5 promos exist in a category

**Map Bottom Cards Integration**
- Map-boosted farmstands (up to 5) appear first in bottom sheet
- Uses same weighted rotation algorithm when more than 5 boosted
- Then auto-featured by popularity score
- Then remaining farmstands by distance

**Scheduled Promotions**
- Promotions with start date in the future show as "Scheduled"
- Promotions past their end date show as "Expired"
- Only "Active" promotions appear in Explore/Map

**Instant Updates**
- Explore and Map update immediately when promotions change
- No app restart required

#### Popularity Tracking
The app automatically tracks user interactions to calculate popularity:
- **Clicks**: Incremented when viewing farmstand detail page
- **Saves**: Incremented when favoriting a farmstand
- **Messages**: Incremented when messaging a farmstand
- **Reviews**: Count from existing review system

Popularity scores update in real-time and affect auto-featured rankings.

#### Data Model
Farmstand promotion fields:
- `promoActive` - Is this farmstand manually promoted?
- `promoExploreCategories` - Which Explore categories to appear in
- `promoMapBoost` - Show at top of Map cards?
- `promoPriority` - 0-100, higher = more prominent
- `promoStartAt` / `promoEndAt` - Optional scheduling
- `promoRotationWeight` - 1-10, affects rotation when many promos
- `promoStatus` - active, scheduled, expired, none
- `clicks30d` / `saves30d` / `messages30d` - 30-day rolling counts
- `popularityScore` - Calculated score for auto-featuring

## Analytics

The app includes comprehensive analytics for both farmstand owners and platform administrators, with real-time event tracking and automatic demo data seeding.

### Event Tracking
The app automatically logs the following events when users interact with farmstand listings:
- `farmstand_viewed` - When a user views a farmstand detail page (with source tracking: map, search, favorite, share)
- `directions_clicked` - When a user taps to get directions
- `call_clicked` - When a user taps to call a farmstand
- `website_clicked` - When a user taps to visit a farmstand's website
- `saved` / `unsaved` - When a user saves or unsaves a farmstand
- `shared` - When a user shares a farmstand (via native share sheet)
- `review_created` - When a user submits a review (with rating metadata)
- `listing_claim_requested` - When a user submits a claim request
- `listing_claim_approved` - When an admin approves a claim

### Demo Data Seeding
For new farmstands or first-time setup, the analytics system automatically generates 60 days of realistic demo data including:
- Views with realistic patterns (weekend boost, recency trends)
- Engagement metrics (saves, directions, calls, shares) with industry-standard conversion rates
- Review activity and rating distributions
- This allows owners to see how the analytics dashboard works immediately

### Owner Analytics (`/profile/analytics`)
Available to farmers who have claimed or created a farmstand. Access via:
- "View Analytics" quick action on the Farmer Dashboard
- Tapping the Views or Rating tiles on the Dashboard
- Direct navigation to `/profile/analytics`
- Creates a new farmstand through the farmer onboarding flow
- Claims an existing farmstand using the verification code
- Has their claim request approved by an admin

The system automatically grants farmer status when:
- A claim request is approved (user's isFarmer flag is set and farmId is assigned)
- A farmstand is claimed via verification code
- A new farmstand is created through onboarding

**IMPORTANT: Owner analytics queries ONLY count events tied to the owner's specific farmstand(s).**
- All queries filter by `WHERE farmstand_id IN (userFarmstandIds)`
- Events with `farmstand_id = NULL` are NEVER counted
- If no events exist for the farmstand, displays 0 (no fallback to aggregate data)
- Data comes directly from Supabase `analytics_events` table, not local demo data

Analytics features include:
- **Summary Cards**: Views, Saves, Directions (7 days), New Reviews (30 days), Avg Rating
- **Customer Intent**: Direction taps, Calls, Website taps, Shares (30 days)
- **Reviews**: Total reviews, average rating, ratings breakdown
- **Trends**: Last 7 days table showing Views, Saves, Directions, Reviews per day
- **Listing Health**: Checklist showing hours set, photos added, products selected, location pinned, contact method set
- **Recommended Actions**: Smart suggestions based on stats (e.g., "High views but low directions - add clearer address")
- **Empty States**: Appropriate messages when no farmstand connected or no activity yet

### Admin Analytics (`/profile/analytics`)
Available to platform administrators:
- **Platform Stats (7 Days)**: New Listings, Claims Requested, Claims Approved, New Reviews, Reports
- **Active Users**: Count of unique users in last 30 days
- **Needs Attention**: Pending claim requests, flagged listings
- **Data Quality**: Percentage of listings claimed, with photos, with hours, with location, with products
- **Engagement**: Total events (7 days), top event types
- **Top Farmstands**: Ranked by views, saves, and direction taps

### Data Storage
Analytics data is stored in:
- `analytics_events` - Raw event log
- `analytics_farmstand_daily` - Daily rollup per farmstand
- `analytics_farmstand_total` - Lifetime totals per farmstand
- `analytics_admin_daily` - Daily platform-wide metrics

### Owner Editing After Claim

Once a farmstand is claimed, verified owners can fully manage their listing from the Profile section:

**RLS Permission Fix (Important):**
When a claimed owner edits their farmstand, the update MUST:
- Target the row by `id` only: `.eq('id', farmstandId)`
- NOT include ownership fields in the payload: `claimed_by`, `claimed_at`, `submitted_by`
- Only update editable columns (name, description, photos, hours, etc.)

The ownership check uses multiple identifiers to verify access:
- `claimedByUserId` (Supabase auth.uid() from `claimed_by` column)
- `ownerUserId` (legacy compatibility)
- User email as fallback

If edits fail with "Unauthorized" or "Permission denied", the user should log out and log back in to refresh their Supabase session token.

#### My Farmstand (`/owner/my-farmstand`)
Dashboard for verified owners showing:
- Farmstand preview card with photo, status, and location
- Quick action links to all management pages
- Contact info summary
- Today's note display

#### Edit Listing (`/owner/edit?id={farmstandId}`)
Hipcamp-style scrollable editor with all farmstand settings in one place:
- **Hero Preview Card**: Live preview of farmstand with current photo and name
- **Section 1 - Basics**: Name, short tagline (80 char limit), full description (500 char limit) with character counters and helper text
- **Section 2 - Photos**: Add up to 8 photos from camera/library, tap to set main photo, shows "Main" badge
- **Section 3 - Contact**: Phone, email, website fields
- **Section 4 - Hours**: Full weekly schedule editor with quick actions ("Standard Week", "Copy Monday to all") - integrated from separate hours page
- **Section 5 - Location**: Address with auto-geocode, city/state/zip, GPS coordinates status, directions notes, parking notes
- **Section 6 - Payments**: Payment method toggles (Cash, Card, Venmo, etc.), honor system/self-serve option
- **Section 7 - Visibility**: Operating status selector (Active, Temporarily Closed, Seasonal, Permanently Closed), seasonal date picker, show on public map toggle
- **Sticky Save Button**: Always visible at bottom with shadow, saves all sections at once

#### Products Management (`/owner/products?id={farmstandId}`)
Full product catalog management:
- View all products with category, price, and stock status
- **Bulk Actions**: Mark all in stock / Mark all out of stock
- **Add Product**: Name, category, description, price, unit, stock status, stock note, seasonal availability, photo
- **Edit Product**: Update any field
- **Delete Product**: Remove from catalog
- **Stock Toggle**: Quick in-stock/out-of-stock toggle per product

#### Availability (`/owner/availability?id={farmstandId}`)
Quick status updates:
- **Operating Status**: Switch between Active, Temporarily Closed, Seasonal, Permanently Closed
- **Today's Note**: Quick message for customers
- **Product Stock Overview**: See in-stock vs out-of-stock counts
- **Bulk Stock Actions**: Mark all in/out of stock
- **Map Visibility**: Toggle show/hide on map

#### Hours (`/owner/hours?id={farmstandId}`)
Weekly schedule editor with single source of truth:
- **Data Model**: Hours stored as `weeklyHours` JSON on the Farmstand record with Mon-Sun keys, each containing `isOpen`, `openTime`, `closeTime`
- **Editor UI**: 7-row editor for each day with:
  - Day name
  - Open/Closed toggle switch
  - Open time picker (visible only when open)
  - Close time picker (visible only when open)
- **Quick Actions**:
  - "Standard Week" (Mon-Fri 9-5, Sat 8-2, Sun closed)
  - "Copy Monday to all days"
- **Preview Box**: Shows "How customers will see your hours" formatted nicely
- **Save Behavior**:
  - Validates: if Open, openTime and closeTime required, closeTime > openTime
  - Saves to current user's Farmstand (resolved by ownerId == currentUser.id)
  - If no farmstand exists, shows "Create your Farmstand first" message
  - On success: toast "Hours saved", refreshes data from database
  - On failure: shows real error details for debugging
- **Closed Days**: Stored with `isOpen=false` and time values as `null`

### Public Farmstand Hours Display
On the public Farmstand detail page (map "main ad" page), hours are displayed below the About section:
- **Current Status Banner**:
  - "Open now" (green) or "Closed" (red) status indicator
  - Shows next change time: "Closes at 5:00 PM" or "Opens at 9:00 AM"
  - For closed days: "Opens Monday at 9:00 AM"
- **Weekly Schedule**: Clean list of Mon-Sun with times or "Closed"
- **Today Highlight**: Current day is highlighted for quick reference
- **Time Format**: Clean readable format (9:00 AM – 5:00 PM)
- **Data Source**: Reads directly from `weeklyHours` on the Farmstand record

### Map Data Refresh
- Map page automatically refreshes Farmstand data when returning from other screens
- Farm detail page refreshes on focus to show latest hours after saving

#### Location (`/owner/location?id={farmstandId}`)
Location management with interactive map:
- Full address editing (street, city, state, zip)
- **Interactive Map Preview**: Shows current pin location with zoom/pan enabled
  - Recenter button to snap back to stored coordinates
  - Coordinates overlay showing lat/lng
- **Adjust Pin Button**: Opens full-screen map picker
  - Tap map or drag pin to set new coordinates
  - Shows original pin (faded) and new selected location
  - Center crosshair for precision
  - Warning banner: "Manual pin changes require admin verification"
- **Geocoding**: Find coordinates from address
- **Use My Location**: Set coordinates from current GPS position
- **View in Maps**: Open coordinates in Google Maps
- **Directions Notes**: Help customers find you
- **Parking Notes**: Where to park
- **Verification Status Banner**: Shows when location is pending admin verification

### Edit History & Audit Trail
All owner edits are logged for accountability:
- Field changed, old value, new value
- Timestamp and user who made the change
- Role (owner or admin)
- Accessible via admin dashboard for support

### Public Listing Product Display
Farm detail pages now show products with stock status:
- Products displayed in cards with photo, name, category, price
- **Stock Badge**: Green "In Stock" or red "Out" indicator
- Stock notes displayed when available
- Falls back to product category tags if no detailed products

### AddressMapPicker Component

A unified address input with interactive map component used across all farmstand creation and editing flows.

**Used In:**
- Create Farmstand (farmer/onboarding.tsx)
- Admin → Manage Farmstands → Edit (admin/farmstand-edit.tsx)
- Admin → Pending Farmstands → Edit/Approve (admin/pending-approvals.tsx)

**Features:**
- Address input fields (street, city, state, ZIP, country)
- "Locate on Map" button for geocoding address to coordinates
- "Use My Location" button for device GPS
- Interactive map with draggable pin
- Auto-geocode on field blur
- Status line showing pin source and confidence
- Reverse geocode on pin drag (optional)

**Address Fields:**
- Address Line 1 (street)
- Address Line 2 (optional)
- City
- State/Province
- ZIP/Postal
- Country (default US)

**Location Outputs:**
- latitude
- longitude
- geocodeSource: 'address' | 'pin_drag' | 'current_location' | 'manual'
- geocodeConfidence: 'high' | 'medium' | 'low'

**Behavior:**
1. **Geocode on address changes**: Auto-runs when admin finishes editing (on blur) or clicks "Locate on Map"
2. **Pin drag updates coordinates**: Immediately updates lat/lng, optionally reverse-geocodes to fill address
3. **"Use My Location"**: Requests location permission, sets coordinates, centers map
4. **Always in sync**: Address changes → pin moves; Pin moves → coordinates update

**Usage Example:**
```tsx
import {
  AddressMapPicker,
  AddressMapPickerData,
  createDefaultAddressMapData,
} from '@/components/AddressMapPicker';

const [addressData, setAddressData] = useState<AddressMapPickerData>(
  createDefaultAddressMapData({ state: 'OR' })
);

<AddressMapPicker
  value={addressData}
  onChange={setAddressData}
  labels={{
    title: 'Location',
    subtitle: 'Enter address and place pin to set GPS coordinates',
  }}
  compact // Optional: less padding for modals
/>
```

## Profile & Admin UI Design

The Profile and Admin pages feature a premium Hipcamp/Airbnb-inspired design:

### Global Style Rules
- **Background**: Soft off-white (#FAF7F2) throughout
- **Cards**: Rounded corners (18-22px), subtle shadows, generous padding
- **Typography**: Clear hierarchy with larger page titles (28-32), section headers (16-18), and muted secondary text
- **Icons**: Displayed in soft circular containers (40-44px) with muted color tints
- **Buttons**: Primary CTAs use app green with pill radius (16-20)
- **Animations**: Smooth fade-in animations using react-native-reanimated

### Persistent Profile Photos
- **Storage**: Profile photos are uploaded to Supabase Storage bucket `avatars` at path `{userId}/{timestamp}.jpg`
- **Database**: `profiles.avatar_url` column stores the permanent public URL
- **On Save**: `edit-profile.tsx` calls `uploadAvatarAndPersist()` → uploads image → upserts `profiles` row with `avatar_url`
- **On Login**: `login.tsx` calls `fetchProfileAvatarUrl()` after Supabase sign-in to restore the avatar into `user.profilePhoto`
- **RLS Note**: Supabase `avatars` bucket and `profiles` table need policies allowing authenticated users to read/write their own rows
- **Required SQL** (run once in Supabase SQL editor):
  ```sql
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url text;
  ```

### Farmer Profile Page
- **Hero Header**: Gradient background with centered avatar, name, and role subtitle
- **Stats Card**: Overlapping hero card showing Visited/Reviews/Saved counts
- **My Farmstand Card**: Featured card with thumbnail, name, location, and status pill (Live/Draft/Pending)
- **Account Grid**: 2-column tile layout for Edit Profile, Saved, Reviews
- **Preferences Section**: Premium menu rows with icons in circular containers
- **Support & Info Sections**: Clean organized cards with dividers

### Admin Dashboard
- **Hero Header**: Purple gradient with Shield icon and admin email
- **Stats Cards**: Overlapping cards showing Total Farmstands and Pending counts
- **Management Cards**: Featured cards for each admin section (Farmstands, Approvals, Claims, Users, Reports)
- **Color-Coded Icons**: Each section has distinct icon background colors

### Admin List Pages
All admin list pages (Claim Requests, Farmstands, Users, Pending Approvals, Reports & Flags) feature:
- **Hero Headers**: Color-coded gradients matching the section purpose
- **Stats Cards**: Overlapping hero showing relevant counts
- **Card-Based Lists**: Each item displayed as a premium card with status badges
- **Action Menus**: Bottom sheet modals for item actions
- **Empty States**: Friendly messages with icons when no items exist

## Design

Rustic, earthy aesthetic inspired by farm markets:
- Farmstand logo with olive branches
- Forest green primary color
- Terracotta accent for CTAs
- Warm cream backgrounds

## Color Palette

- **Forest Green** (#2D5A3D) - Primary brand color
- **Sage** (#4A7C59) - Secondary green
- **Terracotta** (#C45C3E) - Accent/CTA color
- **Amber/Honey** (#D4943A) - Rating stars, highlights
- **Cream** (#FDF8F3) - Background
- **Sand** (#E8DDD4) - Borders, dividers
- **Bark** (#5C4033) - Text, wood tones

## Tech Stack

- Expo SDK 53 with React Native
- Expo Router for navigation
- NativeWind (TailwindCSS) for styling
- React Native Reanimated for animations
- React Native Gesture Handler for bottom sheet
- Zustand for state management
- react-native-maps for map view
- **Supabase** for backend database (farmstands, users, reviews)

## Supabase Configuration

The app uses Supabase as the **ONLY source of truth** for farmstand data. There is no fallback to mock data or local storage for farmstands.

### Environment Variables
Add these to your `.env` file (get values from Supabase Dashboard → Settings → API):
```
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
```

### Data Flow
- **Supabase is the single source of truth** - No demo data, no AsyncStorage fallback for farmstands
- **Empty state** - If Supabase returns 0 rows, the app shows "0 farmstands" (not mock data)
- **All CRUD operations** go directly to Supabase

### active_farmstands View
The app uses the `active_farmstands` view for all READ operations (listings, counts, display):
- **Explore screen** - Fetches farmstands from `active_farmstands`
- **Map screen** - Displays pins from `active_farmstands`
- **Admin Dashboard counts** - Total, pending, approved, mappable counts from `active_farmstands`
- **Manage Farmstands** - Lists from `active_farmstands`

WRITE operations (create, update, delete) still use the `farmstands` table directly.

This ensures consistent filtering/visibility rules are applied at the database level.

### Status Filtering

**IMPORTANT: All read queries must include `deleted_at IS NULL`**

All lists throughout the app filter by `deleted_at IS NULL` to exclude soft-deleted farmstands:

**Explore & Map (Public Views):**
Only show farmstands where:
- `status = 'active'` AND
- `approval_status = 'approved'` AND
- `deleted_at IS NULL`

**Admin Pending Approvals:**
Show farmstands where:
- `status = 'pending'` AND
- `deleted_at IS NULL`

**Admin Manage Farmstands:**
Show farmstands where:
- `status` in `('approved', 'active', 'draft', 'hidden')` AND
- `deleted_at IS NULL`

**Dashboard Analytics:**
All counts use `deleted_at IS NULL` filter.

### Approve/Deny Actions
When admin approves a farmstand:
```sql
UPDATE farmstands SET
  status = 'active',
  approval_status = 'approved',
  verification_status = 'VERIFIED',
  verified = true,
  verified_at = now(),
  updated_at = now()
WHERE id = ?;
```

When admin denies a farmstand (uses soft delete):
```sql
UPDATE farmstands SET
  deleted_at = now(),
  updated_at = now()
WHERE id = ?;
```

When deleting a farmstand (uses soft delete):
```sql
UPDATE farmstands SET
  deleted_at = now()
WHERE id = ?;
```

### Password Reset & Deep Linking (TestFlight)

The app supports password reset via Supabase with deep linking for TestFlight builds.

**Deep Link Scheme:** `farmstand://`

**Flow:**
1. User requests password reset on login screen
2. App calls `supabaseResetPassword(email)` with `redirectTo: "farmstand://auth/callback"`
3. Supabase sends email with link that redirects to `farmstand://auth/callback#access_token=xxx&refresh_token=xxx&type=recovery`
4. App opens (cold start or foreground), deep link is captured by `_layout.tsx`
5. App navigates to `/auth/callback` screen
6. Callback screen parses tokens, calls `supabaseSetSessionFromTokens()`
7. On success, navigates to `/auth/reset-password` screen
8. User enters new password, calls `supabaseUpdatePassword()`

**Key Files:**
- `src/lib/supabase.ts` - `supabaseResetPassword()` (line ~1195), `supabaseSetSessionFromTokens()` (line ~1257), `supabaseUpdatePassword()` (line ~1317)
- `src/app/_layout.tsx` - Global deep link listener for cold start (captures `farmstand://auth/callback` URLs)
- `src/app/auth/callback.tsx` - Handles token parsing and session setup
- `src/app/auth/reset-password.tsx` - UI for entering new password
- `app.json` - Defines `"scheme": "farmstand"` and iOS `CFBundleURLSchemes`

**Supabase Dashboard Configuration Required:**
Go to Supabase Dashboard → Authentication → URL Configuration
Add `farmstand://auth/callback` to "Additional Redirect URLs"

### Database Schema
The `farmstands` table should include these columns:

**Status Fields:**
- `status` (text): 'draft', 'pending', 'active', 'hidden', 'denied'
- `approval_status` (text): 'pending', 'approved', 'rejected'
- `verification_status` (text): 'PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'NEEDS_INFO'
- `verified` (boolean): true for verified farmstands
- `visibility` (text): 'public', 'admin_only', 'hidden'
- `deleted_at` (timestamptz): NULL for active farmstands, timestamp for soft-deleted

**Location Fields (ALL required for map display):**
- `street_address` (text): Street address (mapped to `addressLine1` in app)
- `address_line2` (text): Additional address info
- `city` (text): City name
- `state` (text): State abbreviation (e.g., 'OR')
- `zip` (text): ZIP code
- `full_address` (text): Combined full address string
- `latitude` (double precision): GPS latitude coordinate
- `longitude` (double precision): GPS longitude coordinate
- `location_mode` (text): 'exact_address', 'cross_streets', 'use_my_location'
- `location_precision` (text): 'exact', 'approximate', 'approximate_manual'
- `cross_street1` (text): First cross street (for approximate locations)
- `cross_street2` (text): Second cross street (for approximate locations)
- `cross_streets` (text): Combined cross streets string (e.g., "Oak St & Main Ave")
- `approx_location_text` (text): Display text for approximate locations
- `pin_adjusted_by_user` (boolean): Whether user manually adjusted the map pin

**Contact Fields:**
- `phone` (text): Contact phone number
- `email` (text): Contact email
- `website` (text): Website URL

**Other Fields:**
- `name` (text): Farmstand name
- `description` (text): Full description
- `offerings` (jsonb): Array of offerings (e.g., ['Eggs', 'Produce'])
- `payment_options` (jsonb): Array of payment methods
- `created_at` (timestamp): Creation timestamp
- `updated_at` (timestamp): Last update timestamp

### Fallback Behavior
- If Supabase is configured but returns no data: Shows empty state (no mock data)
- If Supabase is NOT configured: Shows empty state with message to configure Supabase

## Push Notifications

Push notifications allow farmstand owners to receive real-time alerts when customers message them.

### Setup Requirements

**Important:** Push notifications only work in:
- Development builds (expo-dev-client)
- TestFlight builds
- Production App Store builds

Push notifications do NOT work in Expo Go (starting from SDK 53).

### Supabase Tables

Run the SQL in `supabase-push-notifications.sql` to create the required tables:

1. **`user_push_tokens`** - Stores Expo push tokens for each user/device
   - `user_id` (UUID): Links to auth.users
   - `expo_push_token` (TEXT): The Expo push token
   - `device_os` (TEXT): 'ios', 'android', or 'web'
   - `last_seen_at` (TIMESTAMPTZ): Token freshness timestamp

2. **`user_notification_prefs`** - Stores user notification preferences
   - `user_id` (UUID): Links to auth.users
   - `messages` (BOOLEAN): Enable/disable message notifications (default: true)
   - `new_farmstands`, `seasonal_products`, `saved_farm_updates`, `promotions`, `app_updates` (BOOLEAN): Other notification types

### How It Works

1. **On App Start (after user login):**
   - App requests notification permission (iOS shows system prompt)
   - If granted, app gets Expo push token
   - Token is saved to `user_push_tokens` table in Supabase
   - Default notification preferences are created in `user_notification_prefs`

2. **When User Changes Notification Settings:**
   - Local state updates immediately
   - Preferences sync to Supabase in background

3. **To Send a Push Notification (backend):**
   - Query `user_push_tokens` for the recipient's Expo push token
   - Check `user_notification_prefs.messages` is true
   - Send via Expo Push API: `https://exp.host/--/api/v2/push/send`

### Code Files

- `/mobile/src/lib/push-notifications.ts` - Push notification service module
- `/mobile/src/app/_layout.tsx` - Initializes push notifications on app start
- `/mobile/src/app/profile/notifications.tsx` - Notification preferences UI
- `/mobile/supabase-push-notifications.sql` - SQL to create Supabase tables

### Sending Notifications (Example)

```typescript
// From your backend when a new message is received
const response = await fetch('https://exp.host/--/api/v2/push/send', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    to: expoPushToken, // From user_push_tokens table
    title: 'New Message',
    body: 'You have a new message from Customer Name',
    data: { threadId: 'thread-123', farmstandId: 'farm-456' },
    sound: 'default',
  }),
});
```

## App Bootstrap (Startup Preload)

The app uses a centralized bootstrap system to ensure consistent behavior between TestFlight and VibeCode environments. Core data is preloaded immediately on app launch.

### Bootstrap Sequence

When the app starts, the following sequence runs ONCE before showing the main UI:

1. **Restore Supabase Session** - Load session from AsyncStorage and refresh if needed
2. **Load User Profile** - Restore user from user-store
3. **Parallel Data Fetch** (if user is logged in):
   - Fetch user's claimed farmstands (`claimed_by = user.id`)
   - Load analytics data
   - Load chat data
4. **Set appReady = true** - App is ready to render

### Key Files

- `src/lib/bootstrap-store.ts` - Zustand store managing bootstrap state
- `src/app/_layout.tsx` - Root layout that runs bootstrap and shows splash until ready

### Usage

The bootstrap store exposes:
- `appReady: boolean` - True when bootstrap is complete
- `status: 'idle' | 'bootstrapping' | 'ready' | 'error'`
- `userFarmstands: Farmstand[]` - User's claimed farmstands (preloaded)
- `analyticsSummary` - 7-day analytics summary for user's farmstands

Screens should check `appReady` or use preloaded data from the bootstrap store:

```typescript
import { useBootstrapStore, selectAppReady, selectUserFarmstands } from '@/lib/bootstrap-store';

// In component:
const appReady = useBootstrapStore(selectAppReady);
const userFarmstands = useBootstrapStore(selectUserFarmstands);

if (!appReady) {
  return <LoadingSpinner />;
}
```

### Benefits

- **Consistent behavior**: TestFlight and VibeCode behave the same
- **No UI flicker**: Data is ready before screens render
- **Faster navigation**: My Farmstand, Analytics screens render immediately
- **Single source of truth**: User's farmstands preloaded from `claimed_by` filter

## File Structure

```
src/
├── app/
│   ├── (tabs)/
│   │   ├── _layout.tsx      # Tab navigator
│   │   ├── index.tsx        # Explore page (Hipcamp-style discovery)
│   │   ├── map.tsx          # Map with bottom sheet
│   │   ├── favorites.tsx    # Saved stands with admin store data
│   │   └── profile.tsx      # User profile
│   ├── farm/
│   │   └── [id].tsx         # Farm detail screen
│   ├── profile/
│   │   ├── notifications.tsx
│   │   ├── location.tsx
│   │   ├── rate-us.tsx
│   │   ├── help.tsx
│   │   ├── settings.tsx
│   │   ├── edit-profile.tsx
│   │   ├── change-password.tsx
│   │   ├── privacy-policy.tsx
│   │   ├── terms.tsx
│   │   ├── visited.tsx
│   │   ├── reviews.tsx
│   │   ├── support.tsx          # User support ticket list
│   │   └── support-thread.tsx   # User support conversation view
   710→│   ├── chat/
   711→│   │   └── [threadId].tsx       # Chat thread screen (Messenger-style)
│   ├── farmer/
│   │   ├── onboarding.tsx       # 3-step farmer signup
│   │   ├── dashboard.tsx        # Farmer management hub
│   │   ├── settings.tsx         # Farmer settings
│   │   ├── products.tsx         # Manage products
│   │   ├── hours.tsx            # Update hours
│   │   ├── location.tsx         # Update location
│   │   ├── performance.tsx      # Performance checklist
│   │   ├── listing/
│   │   │   └── edit.tsx         # Edit listing details
│   │   ├── reviews/
│   │   │   ├── index.tsx        # Reviews list
│   │   │   └── detail.tsx       # Review detail & reply
│   │   └── analytics/
│   │       ├── views.tsx        # Views analytics
│   │       └── ratings.tsx      # Ratings analytics
│   ├── admin/
│   │   ├── dashboard.tsx        # Admin management hub
│   │   ├── farmstands.tsx       # Unified farmstand management (list, approve, deny, edit, delete)
│   │   ├── farmstand-edit.tsx   # Add/Edit farmstand form
│   │   ├── claim-requests.tsx   # Review farmstand ownership claims
│   │   ├── promotions.tsx       # Promotions management dashboard
│   │   ├── promotion-edit.tsx   # Promotion editor for individual farmstands
│   │   ├── users.tsx            # User management (role, suspend, delete)
│   │   ├── reports.tsx          # Legacy flagged content
│   │   ├── reports-and-flags.tsx # Unified reports & flags with conversation links
│   │   ├── ticket-thread.tsx    # Admin support ticket conversation view
│   │   └── settings.tsx         # Admin settings
│   ├── owner/
│   │   ├── my-farmstand.tsx     # Owner dashboard for verified farmstands
│   │   ├── edit.tsx             # Full farmstand edit form for owners
│   │   ├── products.tsx         # Product catalog management
│   │   ├── availability.tsx     # Quick status & stock updates
│   │   ├── hours.tsx            # Weekly hours editor
│   │   └── location.tsx         # Address & directions editor
│   └── _layout.tsx          # Root layout
├── components/
│   ├── AdminGuard.tsx       # Route guard for admin pages
│   ├── ClaimFarmstandForm.tsx # Form for claiming farmstand ownership
│   ├── FarmStandCard.tsx
│   ├── FarmstandLogo.tsx
│   ├── PhotoGalleryModal.tsx # Photo gallery with fullscreen viewer
│   └── ReportContentModal.tsx # Modal for reporting reviews/content
└── lib/
    ├── admin-store.ts       # Zustand store for admin data (includes claim requests)
    ├── analytics-store.ts   # Analytics events and rollup data
    ├── bootstrap-store.ts   # App startup preload (user, farmstands, analytics)
    ├── chat-store.ts        # Chat threads, messages, unread tracking
    ├── explore-store.ts     # Trending/activity tracking for explore page
    ├── farm-data.ts         # Oregon farm data & types
    ├── farmer-store.ts      # Zustand store for farmer data (farmstands, products, reviews)
    ├── favorites-store.ts   # Zustand store for favorites
    ├── products-store.ts    # Products catalog with edit history tracking
    ├── promotions-store.ts  # Promotions management and popularity scoring
    ├── reviews-store.ts     # Zustand store for user reviews (persisted)
    └── user-store.ts        # User profile & settings (includes role)
```

## External URLs (To Configure)

- App Store Review URL: `https://apps.apple.com/app/farmstand/id123456789`
- Google Play Review URL: `https://play.google.com/store/apps/details?id=com.farmstand.app`
- Support Email: `support@farmstand.app`
- Privacy Policy URL: `https://farmstand.app/privacy`
- Terms of Service URL: `https://farmstand.app/terms`

## Platform Analytics (Supabase-based)

The app includes a comprehensive analytics system that tracks user interactions and stores them in Supabase. This enables data-driven insights without requiring paid external analytics services.

### Supabase Setup Required

Create the analytics_events table in your Supabase dashboard:

```sql
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  user_id UUID,
  session_id TEXT,
  device_id TEXT,
  screen TEXT,
  farmstand_id UUID,
  product_key TEXT,
  properties JSONB
);

-- RLS policies
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

-- Authenticated users can INSERT events
CREATE POLICY "Authenticated users can insert events"
  ON public.analytics_events FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow anon inserts for guests
CREATE POLICY "Anon users can insert events"
  ON public.analytics_events FOR INSERT
  TO anon
  WITH CHECK (true);

-- Only admins can SELECT events (for analytics dashboard)
CREATE POLICY "Admins can select events"
  ON public.analytics_events FOR SELECT
  TO authenticated
  USING (
    auth.jwt() ->> 'email' = 'contact@farmstand.online'
  );

-- Create indexes for common queries
CREATE INDEX idx_analytics_events_created_at ON public.analytics_events(created_at DESC);
CREATE INDEX idx_analytics_events_event_name ON public.analytics_events(event_name);
CREATE INDEX idx_analytics_events_user_id ON public.analytics_events(user_id);
CREATE INDEX idx_analytics_events_farmstand_id ON public.analytics_events(farmstand_id);
```

### Event Names Tracked

**Note:** Events marked with `*` are farmstand-related and ALWAYS include `farmstand_id` as a top-level column (not just in properties). All events also include `platform` (ios/android/web) and `app_version` in properties.

| Event | Description | farmstand_id |
|-------|-------------|--------------|
| `app_open` | App was opened | - |
| `screen_view` | User viewed a screen | - |
| `signup_start` | User started signup flow | - |
| `signup_complete` | User completed signup | - |
| `location_permission_granted` | User granted location permission | - |
| `location_permission_denied` | User denied location permission | - |
| `search` | User performed a search | - |
| `filter_change` | User changed a filter | - |
| `radius_change` | User changed search radius | - |
| `product_chip_tap` | User tapped a product category chip | - |
| `product_click` | User clicked on a product* | Required |
| `farmstand_view` | User viewed a farmstand detail page* | Required |
| `farmstand_save` | User saved a farmstand to favorites* | Required |
| `save_toggle` | User toggled save state* | Required |
| `share_tap` | User shared a farmstand* | Required |
| `directions_tap` | User tapped directions* | Required |
| `call_tap` | User tapped call button* | Required |
| `website_tap` | User tapped website link* | Required |
| `message_tap` | User tapped message farmstand* | Required |
| `message_farmstand` | User messaged a farmstand* | Required |
| `claim_start` | User started claim process* | Required |
| `claim_submit` | User submitted claim form* | Required |
| `claim_request` | User submitted a claim request* | Required |
| `claim_approved` | Admin approved a claim* | Required |
| `claim_denied` | Admin denied a claim* | Required |
| `farmstand_create` | New farmstand was created* | Required |
| `farmstand_edit` | Farmstand was edited* | Required |
| `farmstand_delete` | Farmstand was deleted* | Required |
| `photo_upload_success` | Photo upload succeeded* | Optional |
| `photo_upload_fail` | Photo upload failed* | Optional |
| `review_create` | User created a review* | Required |
| `report_create` | User submitted a report | Optional |
| `report_resolve` | Admin resolved a report | - |
| `error_event` | An error occurred | - |

### Platform Analytics UI

Admins can access Platform Analytics from Profile → Analytics. The dashboard has 5 tabs:

1. **Overview**: DAU/WAU/MAU, signups, engagement funnel, top searches, top product chips
2. **Farmstands**: Top farmstands by views/saves/directions/calls, claim funnel, photo upload metrics
3. **Demand**: Product chip taps by category, filters used, radius distribution, search terms
4. **Quality**: Error events by screen, photo upload failures, reports created vs resolved
5. **Export**: Copy CSV (7d/30d) for rollup or raw event data

### Usage in Code

```typescript
import {
  logEvent,
  logFarmstandView,
  logSearch,
  logProductChipTap,
  // ... other convenience functions
} from '@/lib/analytics-events';

// Log a custom event
logEvent('custom_event', {
  userId: user?.id,
  screen: 'MyScreen',
  properties: { key: 'value' }
});

// Use convenience functions
logFarmstandView(farmstandId, farmstandName, userId);
logSearch(query, resultCount, userId);
logProductChipTap(productKey, userId);
```

### Key Implementation Details

- **Never blocks UX**: All logging is async and fails silently with console logging
- **Device ID**: Stable per device (persisted in AsyncStorage)
- **Session ID**: Resets after 30 minutes of inactivity
- **Offline support**: Events are queued locally and flushed when online

## Dev vs TestFlight Ownership Sync

### Root Cause of Dev/TestFlight Mismatch

The dev (VibeCode) app and TestFlight both connect to the **same Supabase project**. If an approved owner's farmstand shows correctly in TestFlight but not in dev, the cause is almost always one of:

1. **`_refreshInFlight` guard stuck `true`** (most common in dev with hot reload)
   - `_refreshInFlight` is a module-level variable in `bootstrap-store.ts`
   - If a previous refresh was interrupted mid-flight (hot reload, component unmount), the flag stays `true` forever
   - All subsequent `refreshUserFarmstands()` calls are silently skipped
   - **Fix**: Added `setRefreshInFlight()` wrapper with a 15-second safety timeout that auto-resets the flag

2. **Analytics CTA hidden for owners without `isFarmer` flag**
   - The Analytics card was gated on `user.isFarmer || isAdmin`
   - Approved owners who were approved via claim (not the old farmer onboarding) don't have `isFarmer = true`
   - **Fix**: Added `(farmstandsReady && resolvedOwned.length > 0)` to the condition

### Diagnostic Logs

The profile refresh flow now logs extensively to the LOGS tab:
- `[Profile] useFocusEffect — userId: ... | farmstandsStatus: ... | inMemory: ...`
- `[Profile] useFocusEffect refresh done — ownedFarmstands: ... | ids: ...`
- `[Bootstrap] refreshUserFarmstands START — userId: ... | project: ... | currentStatus: ... | inMemory: ...`
- `[Bootstrap] fetchUserFarmstandsFromSupabase — userId: ... | project: ... | url: ...`
- `[Bootstrap] refreshUserFarmstands DONE — userId: ... | farmstands: ... | ids: ... | error: ...`
- `[Bootstrap] _refreshInFlight safety reset after 15s timeout` (if guard gets stuck)

### Ownership Source of Truth

The `farmstand_owners` table is the **sole** source of ownership (NOT `farmstands.owner_id`). A user owns a farmstand iff they have a row in `farmstand_owners` with `is_active IS NULL OR is_active = true`.

The bootstrap store queries this table on every focus/foreground event and caches results in AsyncStorage per user.

### Soft-Delete Visibility Fix (March 2026)

**Problem**: Soft-deleted farmstands (with `deleted_at` populated in the `farmstands` table) were still appearing on the profile screen and in the My Farmstand manager, causing a frozen UI.

**Root Causes Fixed**:
1. `fetchUserFarmstandsFromSupabase` queried `farmstand_owners JOIN farmstands` but never filtered `deleted_at IS NULL` on the joined `farmstands` rows. Result: soft-deleted farmstands returned via the join.
2. `ownerDeleteFarmstand` did not remove the `farmstand_owners` row from Supabase after soft-deleting the farmstand. Result: next query still found the deleted farmstand via the owner join.
3. The AsyncStorage cache could restore a soft-deleted farmstand during the stale-while-revalidate window before the Supabase fetch completed.
4. When `purgeDeletedFarmstandFromBootstrap` set in-memory state to `loaded/empty` (post-delete), `refreshUserFarmstands` detected `hasInMemoryData = false` and re-populated from the stale cache.

**Fixes Applied**:
- `bootstrap-store.ts` `fetchUserFarmstandsFromSupabase`: Added `farmstands!inner(*)` (inner join) and `farmstands.deleted_at=is.null` query filter. Also added client-side `deletedAt != null` guard as defense-in-depth.
- `admin-store.ts` `ownerDeleteFarmstand`: After successful backend soft-delete, calls Supabase REST API to DELETE the `farmstand_owners` row for the given `(farmstand_id, user_id)`.
- `bootstrap-store.ts` `writeFarmstandCache`: Filters out soft-deleted farmstands before writing to AsyncStorage.
- `bootstrap-store.ts` `refreshUserFarmstands`: When `userFarmstandsStatus === 'loaded'` and `userFarmstands === []` (i.e. post-delete state set by `purgeDeletedFarmstandFromBootstrap`), treat this as `hasInMemoryData = true` — do NOT restore from cache.
- Added comprehensive debug logs: filter being used, row count before/after delete filter, `deleted_at` value per row, local state clear complete, query invalidation complete, profile render branch.
- **Admin-only reads**: Only users with email `contact@farmstand.online` can read events

## Bug Fix: My Farmstand Cold Launch Race (Profile + MyFarmstand screens)

**Problem**: On a fresh app cold launch, opening Profile > My Farmstand would get stuck or show "No Farmstand" on the first try, then work correctly on the second open.

**Root Cause**: A race condition between bootstrap timing and `AuthProvider` initialization:
1. Bootstrap runs early and fetches farmstands using `getValidSession()` — but if the session isn't fully restored yet, returns 0 farmstands.
2. `AuthProvider` mounts after the splash screen and sets `loading=true` briefly during its own `loadSessionFromStorage()` call.
3. Profile's `useFocusEffect` returns early when `authLoading=true`. When `authLoading` flips to `false`, `useFocusEffect` re-runs IF the screen is in focus — but the screen had already been navigated to and focused, so React Navigation may not re-fire the callback immediately.
4. In MyFarmstand: when the initial fetch was blocked by the in-flight guard (bootstrap still running), `hasFetchedRef.current` was set to `true` but no fetch actually completed. When bootstrap finished with 0 farmstands (due to timing), no retry was triggered.

**Fixes Applied**:
- `profile.tsx`: Extracted `doProfileRefresh()` helper. Added `isFocusedRef` to track screen focus state. Added `prevAuthLoadingRef` effect that explicitly fires `doProfileRefresh()` when `authLoading` transitions `true → false` while the screen is focused — guaranteeing the fetch even if `useFocusEffect` doesn't re-run.
- `my-farmstand.tsx`: Added `needsRetryRef` flag. When the initial fetch is blocked by the in-flight guard, sets `needsRetryRef=true`. Added a `useEffect` on `userFarmstandsStatus` that retries `refreshUserFarmstands()` once the store transitions out of `'loading'` — if bootstrap returned 0 farmstands due to a stale session, this triggers a fresh fetch with the now-valid session.
- `my-farmstand.tsx`: Gated `fetchPendingClaimsFromSupabase` and `useFocusEffect` refresh behind `!authLoading` to prevent premature queries.

## Bug Fix: My Farmstand Cold Launch Race — Root Cause Confirmed (Third Fix)

**Problem**: My Farmstand showed "No Farmstand" or got stuck on first cold launch even after prior fixes.

**Confirmed Root Cause**: The runtime logs showed `refresh_token_not_found` (HTTP 400) errors on cold launch. When the stored session token is expired:
1. Bootstrap calls `getValidSession()` → tries `refreshSupabaseSession()` → refresh fails → returns `null`
2. Bootstrap set `userFarmstandsStatus = 'loaded'` with 0 farmstands — **"loaded" is wrong here**: it implies the fetch ran and returned genuinely 0 results
3. My Farmstand screen saw `'loaded'` + 0 farmstands → showed "No Farmstand" empty state
4. AuthProvider also kept the expired session in memory and passed it to screens as `session` — so screens thought the user was authenticated, but the farmstand fetch had already concluded empty

**Fixes Applied**:
- `bootstrap-store.ts` `fetchUserFarmstandsFromSupabase`: Added `accessToken` param (bypasses `getValidSession()` when provided). Returns `noSession: boolean` to distinguish "fetch skipped — no valid token" from "genuinely 0 owned farmstands".
- `bootstrap-store.ts` `bootstrap()`: When `noSession=true`, sets `userFarmstandsStatus = 'idle'` (not `'loaded'`). `'idle'` means "a real fetch hasn't run yet — retry when auth is ready".
- `bootstrap-store.ts` `refreshUserFarmstands(accessToken?)`: Accepts optional token, passes to fetch. When `noSession=true`, sets status back to `'idle'`.
- `profile.tsx` + `my-farmstand.tsx`: Pass `authSession?.access_token` to `refreshUserFarmstands()` so authenticated fetches use the AuthProvider-confirmed token directly.
- `my-farmstand.tsx` retry effect: Also fires when `userFarmstandsStatus === 'idle'` AND `authSession` is available — covers cold launch where bootstrap set `'idle'`.
- `my-farmstand.tsx` spinner logic: Treats `'idle'` as pending — shows "Loading your farmstand..." instead of falling through to "No Farmstand".
