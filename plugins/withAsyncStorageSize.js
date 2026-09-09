const { withGradleProperties } = require('expo/config-plugins');

/**
 * Raises AsyncStorage's Android database ceiling.
 *
 * `@react-native-async-storage/async-storage` is SQLite-backed on Android and
 * defaults to a **6 MB** limit. This app stores the whole business as one sealed
 * JSON blob, which measures roughly 155 bytes per engagement — so the default
 * caps a business at about 40,000 visits. A gym with 500 members coming three
 * times a week reaches that in around eighteen months, and then writes begin to
 * fail: the owner records a check-in, sees no error, and loses it.
 *
 * 128 MB is not a fix, it is headroom. The real fix is to stop keeping the
 * entire ledger in one value — see the note on `saveJSON` in `state/persist.ts`.
 * This buys the years needed to do that properly rather than in a panic.
 *
 * There is no `expo-build-properties` option for arbitrary gradle properties,
 * which is why this is a plugin rather than a line of config.
 */
const SIZE_MB = 128;

module.exports = function withAsyncStorageSize(config) {
  return withGradleProperties(config, (cfg) => {
    const key = 'AsyncStorage_db_size_in_MB';
    cfg.modResults = cfg.modResults.filter(
      (item) => !(item.type === 'property' && item.key === key),
    );
    cfg.modResults.push({ type: 'property', key, value: String(SIZE_MB) });
    return cfg;
  });
};
