import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared")
    }
  },
  server: {
    // changeOrigin:false 保留浏览器原始 Host 转发给后端（默认字符串型代理会注入 changeOrigin:true 把
    // Host 改写为 localhost:8787）。这样后端的 CSRF 同主机校验在 `vite --host` 经 LAN IP/真机访问时，
    // Origin 主机名与 Host 主机名一致而放行；localhost 访问命中回环放行。两种 dev 访问方式都不被误伤。
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: false },
      "/uploads": { target: "http://localhost:8787", changeOrigin: false },
      "/exports": { target: "http://localhost:8787", changeOrigin: false }
    }
  }
});
