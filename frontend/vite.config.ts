import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  server: {
    host: "0.0.0.0",

    allowedHosts: ["33eb-2a01-ecc0-40-6c0-00-2.ngrok-free.app"],

    proxy: {
      "/api": {
        target: "http://127.0.0.1:5000",
        changeOrigin: true,
      },

      "/hubs": {
        target: "http://127.0.0.1:5000",
        changeOrigin: true,
        ws: true,
      },

      "/feed-files": {
        target: "http://127.0.0.1:9000",
        changeOrigin: true,
      },

      "/imgproxy": {
        target: "http://127.0.0.1:8081",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/imgproxy/, ""),
      },
    },
  },
});
