import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hamor.game',
  appName: 'ملوك القراصنة',
  webDir: 'dist',
  server: {
    url: 'https://www.molok-alqarasna.com',
    // HTTPS فقط — لا cleartext ولا mixed content (متطلب Google Play).
    cleartext: false,
    allowNavigation: [
      'www.molok-alqarasna.com',
      '*.molok-alqarasna.com',
      '*.stripe.com',
      '*.paypal.com',
      '*.paymob.com'
    ]
  },
  android: {
    allowMixedContent: false,
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: "#000000",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP"
    }
  }
};

export default config;
