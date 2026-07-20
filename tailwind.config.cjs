/*
 * 文件说明: Tailwind CSS 配置，声明 React 页面、静态 HTML 入口和样式入口的扫描范围。
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./login.html", "./src/client/**/*.{ts,tsx}", "./src/styles.css"],
  theme: {
    extend: {}
  },
  plugins: []
};
