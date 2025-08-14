import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.devforth.lik',
  appName: 'Lik',
  webDir: 'dist',
  plugins: {
    Keyboard: {
      resizeOnFullScreen: true
    }
  },
  android: {
    adjustMarginsForEdgeToEdge: 'force'
  }
};

export default config;
