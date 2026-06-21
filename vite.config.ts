import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    build: {
      // نستخدم 'esbuild' بدلاً من 'terser' لأنه مضمن تلقائياً في Vite
      minify: 'esbuild', 
      rollupOptions: {
        output: {
          // تقسيم ذكي تلقائي للملفات
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
