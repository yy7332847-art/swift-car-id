import type { CapacitorConfig } from "@capacitor/cli";

// Capacitor config for wrapping the built web app as Android/iOS.
// After building the web app to `dist/`, run:
//   npx cap add android      # once
//   npx cap add ios          # once (iOS)
//   npx cap sync             # after every build or plugin change
//   npx cap open android     # opens Android Studio for APK
//   npx cap open ios         # opens Xcode for IPA (requires macOS)
const config: CapacitorConfig = {
  appId: "app.platecheck.mobile",
  appName: "PlateCheck",
  webDir: "dist",
  android: {
    allowMixedContent: false,
  },
  ios: {
    // Enables server-driven web content over https (default).
    contentInset: "always",
    // Background modes for location must be enabled in Info.plist as well.
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    Geolocation: {
      // Request high-accuracy location; permissions are declared in
      // AndroidManifest and Info.plist.
    },
    BackgroundGeolocation: {
      // Cross-platform config for @capacitor-community/background-geolocation.
      // iOS: requires "Location updates" in UIBackgroundModes and the
      //   NSLocationAlwaysAndWhenInUseUsageDescription key in Info.plist.
      // Android: uses a foreground service (permissions in AndroidManifest).
    },
  },
};

export default config;
