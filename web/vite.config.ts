import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev the API is proxied under /api so the browser makes same-origin
// requests; in production VITE_API_BASE points at the deployed API.
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind IPv4 explicitly. The default "localhost" can resolve to ::1, which an
    // `ssh -L 5173:127.0.0.1:5173` tunnel cannot reach -- the browser then gets
    // a connection refused with the dev server apparently running fine.
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
