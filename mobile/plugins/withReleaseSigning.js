/**
 * Signs release builds with your own keystore when CI (or your shell) provides one, and falls back to the debug
 * key otherwise, so `assembleRelease` always produces an installable APK.
 *
 * Environment variables read by Gradle at build time (nothing secret is ever written into the project):
 *   VERA_KEYSTORE_PATH, VERA_KEYSTORE_PASSWORD, VERA_KEY_ALIAS, VERA_KEY_PASSWORD
 */
const { withAppBuildGradle } = require("expo/config-plugins");

const MARK = "// vera-release-signing";

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes(MARK)) return cfg;

    const signing = `
        release {
            ${MARK}
            def ksPath = System.getenv('VERA_KEYSTORE_PATH')
            if (ksPath) {
                storeFile file(ksPath)
                storePassword System.getenv('VERA_KEYSTORE_PASSWORD')
                keyAlias System.getenv('VERA_KEY_ALIAS')
                keyPassword System.getenv('VERA_KEY_PASSWORD') ?: System.getenv('VERA_KEYSTORE_PASSWORD')
            }
        }
`;
    // 1) add a "release" signing config next to the generated "debug" one
    const debugBlock = /(signingConfigs\s*\{\s*debug\s*\{[\s\S]*?\n\s{8}\}\n)/;
    if (!debugBlock.test(src)) throw new Error("withReleaseSigning: could not find signingConfigs.debug in app/build.gradle");
    src = src.replace(debugBlock, `$1${signing}`);

    // 2) use it for the release build type whenever a keystore was supplied
    const relSigning = /(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/;
    if (!relSigning.test(src)) throw new Error("withReleaseSigning: could not find the release signingConfig line");
    src = src.replace(relSigning, `$1signingConfig (System.getenv('VERA_KEYSTORE_PATH') ? signingConfigs.release : signingConfigs.debug)`);

    cfg.modResults.contents = src;
    return cfg;
  });
};
