/*
 * 文件说明: Vite 构建配置，生成 React 管理台入口和静态登录页入口。
 */

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist/client",
    rollupOptions: {
      input: {
        index: "index.html",
        login: "login.html"
      }
    }
  }
});
