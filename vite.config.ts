import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    watch: {
      usePolling: true,
      interval: 1000,
    },
    proxy: {
      "/api": "http://127.0.0.1:5175",
    },
  },
});
