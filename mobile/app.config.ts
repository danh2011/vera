import type { ExpoConfig } from "expo/config";
import pkg from "./package.json";

/** CI sets VERA_VERSION_CODE (the run number) so every build can be installed over the last one. */
const versionCode = Number(process.env.VERA_VERSION_CODE ?? 1) || 1;

const config: ExpoConfig = {
  name: "Vera",
  slug: "vera",
  scheme: "vera",
  version: pkg.version,
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  backgroundColor: "#212121",
  primaryColor: "#ececec",
  android: {
    package: "app.vera.assistant",
    versionCode,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      monochromeImage: "./assets/monochrome-icon.png",
      backgroundColor: "#171717",
    },
    permissions: ["android.permission.RECORD_AUDIO"],
    predictiveBackGestureEnabled: true,
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    ["expo-splash-screen", {
      image: "./assets/splash-icon.png", imageWidth: 120, resizeMode: "contain", backgroundColor: "#ffffff",
      dark: { image: "./assets/splash-icon.png", backgroundColor: "#212121" },
    }],
    ["expo-speech-recognition", {
      microphonePermission: "Vera listens only while you hold the dictation button, to turn your voice into text.",
      speechRecognitionPermission: "Vera uses speech recognition to turn what you say into text.",
      androidSpeechServicePackages: ["com.google.android.as", "com.google.android.googlequicksearchbox"],
    }],
    // Home servers are usually reached over plain http on the local network, so cleartext must be allowed.
    // The app warns whenever you connect over http to something that is not a private address.
    ["expo-build-properties", { android: {
      usesCleartextTraffic: true,
      // R8 is off until a release build has been exercised on a device; turn it on to shrink the APK.
      enableMinifyInReleaseBuilds: false, enableShrinkResourcesInReleaseBuilds: false,
    } }],
    "./plugins/withReleaseSigning",
  ],
};
export default config;
