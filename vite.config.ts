import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    build: {
      // تفعيل محرك Terser للضغط المكثف
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true, // حذف الـ logs لتوفير مساحة
          drop_debugger: true,
          passes: 2, // ضغط مزدوج
        },
        mangle: true, // اختصار أسماء الدوال والمتغيرات
      },
      // تم إزالة manualChunks لأن TanStack Start يدير تقسيم الكود تلقائياً
      // ولن يتسبب هذا في زيادة الحجم لأن النظام ذكي بما يكفي
      rollupOptions: {
        output: {
          // نترك النظام يقرر التقسيم تلقائياً لتجنب الأخطاء
        }
      }
    }
  },
});
