import PostHog from 'posthog-react-native';

let _instance: PostHog | undefined;
let _initialized = false;

// Call this inside a React component (useState/useEffect), never at module level.
export function getPostHog(): PostHog | undefined {
  if (_initialized) return _instance;
  _initialized = true;
  try {
    _instance = new PostHog('phc_fLhsKyhZSYWV0fGN8u7WCOI2H6cCQz4WzwHUrnRoXAg', {
      host: 'https://app.posthog.com',
    });
    if (__DEV__) console.log('[Startup] PostHog initialized');
  } catch (e) {
    if (__DEV__)
      console.log('[Startup] PostHog init threw — analytics disabled for this session:', e);
  }
  return _instance;
}
