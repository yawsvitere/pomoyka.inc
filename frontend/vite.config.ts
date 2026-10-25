import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const backendProxyTarget =
  process.env.VITE_BACKEND_PROXY_TARGET ?? "http://127.0.0.1:5000";
const storageProxyTarget =
  process.env.VITE_STORAGE_PROXY_TARGET ?? "http://127.0.0.1:9000";
const imgproxyProxyTarget =
  process.env.VITE_IMGPROXY_PROXY_TARGET ?? "http://127.0.0.1:8081";

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
        const postMatch = /^\/posts\/public\/([^/]+)\/?$/.exec(url.pathname);
        const galleryMatch = /^\/files\/gallery\/([0-9a-fA-F-]{36})\/?$/.exec(
          url.pathname,
        );
        const metadataPath = postMatch
          ? `/api/posts/public/metadata/${postMatch[1]}`
          : galleryMatch
            ? `/api/files/gallery/metadata/${galleryMatch[1]}`
            : null;
        if (
          !metadataPath ||
          !socialPreviewAgents.test(request.headers["user-agent"] ?? "")
        ) {
          next();
          return;
        }

        request.headers["x-forwarded-host"] ??= request.headers.host;
        request.headers["x-forwarded-proto"] ??= "http";
        request.url = metadataPath;
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
      "d7b2-2-27-11-87.ngrok-free.app",
      "cba9-2-27-11-87.ngrok-free.app",
    ],

    proxy: {
      "/api": {
        target: backendProxyTarget,
        changeOrigin: true,
      },

      "/og": {
        target: backendProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/og/, "/api/posts/og"),
      },

      "/gallery-og": {
        target: backendProxyTarget,
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\/gallery-og/, "/api/files/gallery/og"),
      },

      "/hubs": {
        target: backendProxyTarget,
        changeOrigin: true,
        ws: true,
      },

      "/feed-files": {
        target: storageProxyTarget,
        changeOrigin: true,
      },

      "/imgproxy": {
        target: imgproxyProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/imgproxy/, ""),
      },
    },
  },
});
