import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  // هنا التعديل: سنضيف إعدادات الضغط داخل الـ vite
  vite: {
    build: {
      minify: 'terser', // استخدام محرك Terser للضغط المكثف
      terserOptions: {
        compress: {
          drop_console: true, // حذف الـ logs لتقليل الحجم
          drop_debugger: true,
          passes: 2, // ضغط الملفات على مرحلتين للحصول على أصغر حجم ممكن
        },
        mangle: true, // اختصار أسماء المتغيرات والدوال لتقليل الحجم
      },
      rollupOptions: {
        output: {
          // تقسيم الحزم لضمان عدم تكرار الأكواد
          manualChunks(id) {
            if (id.includes('node_modules')) {
              return 'vendor';
            }
          }
        }
      }
    }
  },
});
