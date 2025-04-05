import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [react(), tailwindcss(), wasm(), topLevelAwait()],
  root: "examples",
  server: {
    port: 3000,
    fs: {
      // Allow serving files from one level up to the project root
      allow: [".."],
    },
  },
  optimizeDeps: {
    exclude: ["opencascade.js"],
  },
  build: {
    target: "esnext",
  },
  // Add proper asset handling
  assetsInclude: ["**/*.wasm"],
});
