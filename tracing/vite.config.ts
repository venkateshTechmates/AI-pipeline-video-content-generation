import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const target = env.API_PROXY_TARGET || "http://localhost:8000";
  return {
    plugins: [react()],
    server: {
      port: 5174,
      strictPort: true,
      proxy: {
        "/api": {
          target,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ""),
        },
      },
    },
    preview: { port: 4174 },
  };
});
