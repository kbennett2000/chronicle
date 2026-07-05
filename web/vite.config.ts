import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds straight into ../public, which server.ts already serves as its
// static root — no change needed on the backend side for this rebuild.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../public",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/campaigns": "http://127.0.0.1:4317",
      "/models": "http://127.0.0.1:4317",
    },
  },
});
