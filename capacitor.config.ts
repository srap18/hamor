import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hamor.game',
  appName: 'hamor',
  webDir: 'dist',
  server: {
    // الرابط الرسمي الجديد الصحيح 
    url: 'https://www.molok-alqarasna.com', 
    cleartext: true,
    // السماح بالتنقل لضمان فتح صفحات الدفع والتسجيل الخارجية دون الخروج من التطبيق
    allowNavigation: [
      'www.molok-alqarasna.com',
      '*.molok-alqarasna.com',
      '*.stripe.com',
      '*.paypal.com',
      '*.paymob.com'
    ]
  },
  android: {
    // تفعيل المحتوى المختلط لضمان عمل السيرفرات والـ WebSockets الخاصة باللعبة الأونلاين بكفاءة
    allowMixedContent: true
  }
};

export default config;
