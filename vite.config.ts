import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
  base: loadEnv(mode, ".", "VITE_").VITE_BASE_PATH ?? "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Fuji Pocket",
        short_name: "Fuji Pocket",
        description: "A personal, source-linked Fujifilm recipe companion.",
        theme_color: "#17211c",
        background_color: "#f7f5ef",
        display: "standalone",
        start_url: "./",
        scope: "./",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }]
      },
      workbox: { globPatterns: ["**/*.{js,css,html,svg,json}"] }
    })
  ]
}));
