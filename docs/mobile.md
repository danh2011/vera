# Vera for Android (Expo)

The Android app lives in `mobile/`. It is a React Native app built with Expo (SDK 58, Expo Router, Hermes, New Architecture). It replaces the old Capacitor wrapper: instead of showing the web app in a WebView, it is a native app that talks to the same Vera backend through the same `/api/v1` contract.

## What it is

- **Same look as the web app.** The design tokens in `src/styles.css` (graphite palette, accent colours, Geist, radii) are ported to `mobile/src/theme/tokens.ts`. Lucide icons, same wording.
- **Mobile-first layout.** Chat is the home screen. A left drawer (swipe from the edge or tap the menu) holds new chat, the sections, searchable history grouped by recency, settings and sign-out, the pattern ChatGPT, Claude and Gemini use. Forms and menus are bottom sheets, lists support pull-to-refresh, tasks and memory support swipe actions, and there are haptics on key actions.
- **Same features as the web app.** Chat with live steps, approval cards and privacy notices; tasks and reminders; memory and notes; the Integrations store, detail page and setup wizard; systems status; settings (AI provider, privacy, account, sessions, audit log); onboarding.
- **Voice.** Dictation (Android speech recognition) fills the message box live; ✓ keeps the text to edit, ✕ discards it. Nothing is sent by voice. Optional "speak replies" uses the phone's text-to-speech.
- **No fake data.** If the server can't be reached the app says so. There is no mock mode.

## How it connects

A phone has no "same origin", so the first screen asks for your server address (for example `192.168.1.20:3001` or `https://vera.example.com`). The app checks that it really is a Vera server before saving it.

- Plain `http://` is allowed for local-network, `.local`, and Tailscale addresses. For any other `http://` address the app warns before connecting.
- The session token is kept in Android's encrypted storage (`expo-secure-store`) and sent explicitly as the `vera_session` cookie, together with the CSRF token on writes. If a server doesn't expose `Set-Cookie` to the app, the platform cookie jar is used instead.
- Replies stream as NDJSON via `expo/fetch`.
- Nothing in the app talks to anyone except the server you entered.

The backend needs no changes. The app sends no `Origin` header, which the server already accepts.

## Build the APK with GitHub Actions

`.github/workflows/android-apk.yml` builds an installable APK.

| Trigger | Result |
| --- | --- |
| Push to `main` or a PR touching `mobile/` or `shared/` | Typecheck, lint, tests, then an APK in the run's **Artifacts** (kept 30 days) |
| Tag `v*` (e.g. `git tag v3.0.0 && git push --tags`) | The same, plus the APK attached to a **GitHub Release** |
| **Actions → Android APK → Run workflow** | Choose architectures: `arm64-v8a` (default, almost every modern phone), plus 32-bit ARM, or universal including emulators |

Each build's `versionCode` is the workflow run number, so a newer APK always installs over an older one.

### Signing

Without any setup the APK is signed with the debug key. It installs and updates fine for personal use. To sign with your own key, create a keystore once and add four repository secrets:

```bash
keytool -genkeypair -v -storetype PKCS12 -keystore vera-release.keystore -alias vera \
        -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 vera-release.keystore      # macOS: base64 -i vera-release.keystore
```

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the base64 output above |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `vera` (or the alias you chose) |
| `ANDROID_KEY_PASSWORD` | the key password (omit if same as the keystore password) |

Keep `vera-release.keystore` somewhere safe: an APK signed with a different key cannot update one signed with another, and Android will make you uninstall first. Switching from the debug key to your own key is such a change, so decide before you start using it day to day.

### Installing

Download the APK from the run (or release) on your phone, open it, and allow "Install unknown apps" for your browser when asked.

## Develop locally

```bash
cd mobile
npm install
npm run typecheck && npm run lint && npm test
npx expo prebuild --platform android      # generates android/ (git-ignored)
npx expo run:android                      # needs Android Studio / the SDK and a device or emulator
```

The app uses native modules (speech recognition, secure storage), so it needs a development build; Expo Go can't run it. `npx expo start` after a first `expo run:android` gives you fast refresh.

To build the release APK yourself: `cd mobile/android && ./gradlew assembleRelease` (JDK 17, Android SDK). Output: `app/build/outputs/apk/release/app-release.apk`.

## Layout

```
mobile/
  app/                 screens (Expo Router): chat, tasks, memory, integrations/*, systems, settings
  src/api/             typed client for /api/v1 (cookies, CSRF, NDJSON streaming, error mapping)
  src/state/           connection + session, settings, background reply runs, toasts, drawer
  src/features/        chat, drawer, connect/auth/onboarding, integrations (store, detail, wizard)
  src/ui/              buttons, fields, sheets, headers, feedback components
  src/theme/           tokens ported from the web stylesheet
  plugins/             config plugin: signs releases with your keystore when the env vars are set
  __tests__/           client, URL, streaming and logic tests
```

Server-shaped types come from `shared/types`, the same file the web app uses, so the two clients can't drift apart silently.

## Known limits

- **OAuth integrations** (for example Google Calendar) finish in your browser, and the provider returns to the Vera web page, which needs you to be signed in to Vera in that browser. The app re-checks when you come back. A deep-link return into the app would need a small server change and isn't included.
- **File attachments** behave as in the web app: the file name is shown and the file stays on the device; it is not uploaded or processed.
- **R8 minification is off** in release builds until the build has been exercised on a device. Enabling it (`enableMinifyInReleaseBuilds` in `mobile/app.config.ts`) shrinks the APK.
- iOS isn't built or tested. The code is cross-platform, but the dictation, permissions and build workflow target Android only.
