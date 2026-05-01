import PostHog from 'posthog-react-native';

let _instance: PostHog | undefined;
let _initialized = false;

// Call this inside a React component (useState/useEffect), never at module level.
export function getPostHog(): PostHog | undefined {
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
