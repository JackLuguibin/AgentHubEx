import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  envDir: path.resolve(__dirname, "../.."),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": {
        target: "http://localhost:8080",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    // Keep fonts/scripts self-hosted; never inject CDN asset tags.
    modulePreload: true,
  },
});
