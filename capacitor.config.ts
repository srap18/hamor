import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hamor.game',
  appName: 'hamor',
  webDir: 'build/client' // التعديل السحري: وجهنا الكاباسيتور لمجلد Remix الصحيح
};

export default config;
