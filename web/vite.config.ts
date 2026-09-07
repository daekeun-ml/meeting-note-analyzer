import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { existsSync, readFileSync } from "node:fs";

const localConfigPath = process.env.MEETING_CONFIG_FILE || new URL("../deploy.local.json", import.meta.url);
const apiOrigin = process.env.VITE_API_ORIGIN || (existsSync(localConfigPath) ? JSON.parse(readFileSync(localConfigPath, "utf8")).siteUrl : "");

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: null, // registered in main.tsx so update checks also run when the home-screen app is resumed
      manifest: {
        name: "Meeting Notes",
        short_name: "회의록",
        description: "회의 녹음(mp3)을 업로드하면 회의록·노트·F/U·AI 제안을 만들어 드립니다.",
        lang: "ko",
        display: "standalone",
        start_url: "/",
        scope: "/",
        background_color: "#0a0f1a",
        theme_color: "#0a0f1a",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      injectManifest: { globPatterns: ["**/*.{js,css,html,png,svg,woff2}"], maximumFileSizeToCacheInBytes: 5 * 1024 * 1024 },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173, ...(apiOrigin ? { proxy: { "/api": { target: apiOrigin, changeOrigin: true, secure: true } } } : {}) },
  build: { sourcemap: true },
});
