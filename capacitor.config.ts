import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hamor.game',
  appName: 'hamor',
  webDir: 'dist', // هنخليه dist ونخلق الفولدر ده وهمي في السيرفر
  server: {
    url: 'https://رابط-لعبتك-الأونلاين-الحقيقي.com', // 👈 ضع هنا رابط اللعبة الأونلاين بتاعكم
    cleartext: true
  }
};

export default config;
