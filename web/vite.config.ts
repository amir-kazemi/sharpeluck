import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev the API is proxied under /api so the browser makes same-origin
// requests; in production VITE_API_BASE points at the deployed API.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
