import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    build: {
      // نستخدم 'esbuild' للضغط السريع والمدمج بدون الحاجة لتثبيت مكتبات إضافية
      minify: 'esbuild',
      // قمنا بإزالة manualChunks لأنها السبب في فشل البناء
      // النظام يقوم بالتقسيم تلقائياً وبأمان تام
    }
  },
});
