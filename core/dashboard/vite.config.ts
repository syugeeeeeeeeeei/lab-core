import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Lab-Core serves the Vite dev server behind Caddy using custom lab domains.
    allowedHosts: true,
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_PROXY_TARGET ?? "http://127.0.0.1:7300",
        changeOrigin: true
      }
    }
  }
});
