import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fdhchecker.mobile',
  appName: 'FDH Checker',
  webDir: 'dist',
  backgroundColor: '#f8fafc',
  server: {
    url: 'http://147.50.107.211:3507',
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
