import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 7100,
    host: true,
  },
  preview: {
    port: 7100,
    host: true,
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
