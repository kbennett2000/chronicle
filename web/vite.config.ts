import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds straight into ../public, which server.ts already serves as its
// static root — no change needed on the backend side for this rebuild.
//
// PORT is the single source of truth for the dev proxy target too (issue #73),
// so `PORT=9876 npm run dev` proxies to the same backend `npm run serve` binds.
// Only affects `vite dev`; production is served by the backend and never uses
// this proxy. Falls back to the backend's own default (4317, server.ts).
const backendPort = process.env.PORT ?? "4317";
const backendTarget = `http://127.0.0.1:${backendPort}`;

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../public",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/campaigns": backendTarget,
      "/models": backendTarget,
    },
  },
});
