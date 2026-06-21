import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hamor.game',
  appName: 'ملوك القراصنة',
  webDir: 'dist',
  server: {
    url: 'https://www.molok-alqarasna.com', 
    cleartext: true,
    allowNavigation: [
      'www.molok-alqarasna.com',
      '*.molok-alqarasna.com',
      '*.stripe.com',
      '*.paypal.com',
      '*.paymob.com'
    ]
  },
  android: {
    allowMixedContent: true
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: "#000000",
    }
  }
};

export default config;
