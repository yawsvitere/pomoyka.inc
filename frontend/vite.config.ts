import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const socialPreviewAgents =
  /TelegramBot|facebookexternalhit|Facebot|Twitterbot|WhatsApp|Slackbot|Discordbot|LinkedInBot|vkShare|Viber|SkypeUriPreview/i;

function socialPreviewPlugin(): Plugin {
  return {
    name: "social-preview-metadata",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.method !== "GET" || !request.url) {
          next();
          return;
        }

        const url = new URL(request.url, "http://localhost");
        const match = /^\/posts\/public\/([^/]+)\/?$/.exec(url.pathname);
        if (!match || !socialPreviewAgents.test(request.headers["user-agent"] ?? "")) {
          next();
          return;
        }

        request.headers["x-forwarded-host"] ??= request.headers.host;
        request.headers["x-forwarded-proto"] ??= "http";
        request.url = `/api/posts/public/metadata/${match[1]}`;
        next();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [socialPreviewPlugin(), react()],

  server: {
    host: "0.0.0.0",

    allowedHosts: [
      "33eb-2a01-ecc0-40-6c0-00-2.ngrok-free.app",
      "cba9-2-27-11-87.ngrok-free.app",
    ],

    proxy: {
      "/api": {
        target: "http://127.0.0.1:5000",
        changeOrigin: true,
      },

      "/og": {
        target: "http://127.0.0.1:5000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/og/, "/api/posts/og"),
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
