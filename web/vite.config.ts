import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../src/shared"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/auth": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      "/chats": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      "/groups": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      "/files": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      "/search": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      "/users": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      "/me": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      "/health": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://127.0.0.1:3000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});

