import PostHog from 'posthog-react-native';

// Diagnostic kill-switch. Set false to skip PostHog init entirely at startup,
// preventing any native-module touch during the first few seconds of launch.
// Flip to true once the startup SIGABRT is resolved.
const POSTHOG_STARTUP_ENABLED = false;

let _instance: PostHog | undefined;
let _initialized = false;

// Call this inside a React component (useState/useEffect), never at module level.
export function getPostHog(): PostHog | undefined {
  if (!POSTHOG_STARTUP_ENABLED) {
    console.log('[Startup] skipping PostHog startup for diagnostic build');
    return undefined;
  }
  if (_initialized) return _instance;
  _initialized = true;
  console.log('[BOOT] PostHog: starting constructor');
  try {
    _instance = new PostHog('phc_fLhsKyhZSYWV0fGN8u7WCOI2H6cCQz4WzwHUrnRoXAg', {
      host: 'https://app.posthog.com',
    });
    console.log('[BOOT] PostHog: constructor ok');
  } catch (e) {
    console.warn('[BOOT] PostHog: constructor failed (non-fatal):', e instanceof Error ? e.message : String(e));
  }
  return _instance;
}
