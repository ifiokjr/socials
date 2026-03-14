import { defineConfig } from "npm:vite@^6";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "npm:vite-plugin-pwa@^0.21.1";

export default defineConfig({
  root: "web",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  plugins: [
    tailwindcss(),
    VitePWA({
      srcDir: ".",
      filename: "sw.ts",
      strategies: "injectManifest",
      registerType: "prompt",
      injectRegister: false,
      devOptions: {
        enabled: true,
        type: "module",
      },
      includeAssets: ["favicon.ico", "icons/*.png"],
      manifest: false,
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/auth": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
