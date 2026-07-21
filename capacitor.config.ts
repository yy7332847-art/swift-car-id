import type { CapacitorConfig } from "@capacitor/cli";

// Capacitor config for wrapping the built web app as Android/iOS.
// IMPORTANT: TanStack Start builds SSR output in `dist/`; Android WebView needs
// a real static index.html. Run `npm run build:android` to create `dist-capacitor/`.
const config: CapacitorConfig = {
  appId: "app.platecheck.mobile",
  appName: "PlateCheck",
  webDir: "dist-capacitor",
  server: {
    androidScheme: "https",
  },
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
