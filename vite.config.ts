import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri bekler: sabit port, HMR host ayarı.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      // src-tauri değişikliklerini Vite izlemesin
      ignored: ["**/src-tauri/**"],
    },
  },
  // Tauri prod build'de daha küçük çıktı
  build: {
    target: "chrome110",
    minify: "esbuild",
    sourcemap: false,
  },
});
