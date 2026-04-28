/**
 * app.config.js takes precedence over app.json for all Expo/EAS builds.
 * It locks ios.supportsTablet to true so submission tooling that rewrites
 * app.json (e.g. to bump buildNumber) can never accidentally reset it.
 */
module.exports = ({ config }) => ({
  ...config,
ios: {
  ...(config.ios || {}),
  supportsTablet: true,
},
});
