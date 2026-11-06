/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the Vite server proxies /api to the Vera backend (default http://127.0.0.1:3001).
const api = process.env.VERA_DEV_API ?? "http://127.0.0.1:3001";
export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 600 },
  server: { proxy: { "/api": { target: api, changeOrigin: false } } },
  test: {
    globals: true,
    projects: [
      { extends: true, test: { name: "web", environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"], setupFiles: ["./src/test/setup.ts"] } },
      { test: { name: "server", environment: "node", include: ["server/**/*.test.ts", "tests/**/*.test.{ts,tsx}"], testTimeout: 20000 } },
    ],
  },
});
