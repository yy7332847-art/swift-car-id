import type { CapacitorConfig } from "@capacitor/cli";

// Capacitor config for wrapping the built web app as an Android APK.
// After building the web app to `dist/`, run:
//   npx cap add android          # once
//   npx cap sync android         # after every build or plugin change
//   npx cap open android         # opens Android Studio to build the APK
const config: CapacitorConfig = {
  appId: "app.platecheck.mobile",
  appName: "PlateCheck",
  webDir: "dist",
  android: {
    allowMixedContent: false,
  },
  plugins: {
    Geolocation: {
      // Request high-accuracy location; permissions are declared in AndroidManifest.
    },
  },
};

export default config;
