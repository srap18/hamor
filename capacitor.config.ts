import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hamor.game',
  appName: 'ملوك القراصنة',
  // Capacitor يتطلب webDir موجود ليتم cap sync — نستخدم مجلد dist
  // الذي يحتوي على index.html احتياطي فقط. المحتوى الفعلي للعبة
  // يُحمَّل من server.url أدناه (الموقع المنشور).
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
    allowMixedContent: true,
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
