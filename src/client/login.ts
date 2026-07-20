/*
 * 文件说明: 静态登录页交互脚本，设置登录提交路径、next 参数和失败提示。
 */

import "../styles.css";

const params = new URLSearchParams(window.location.search);
const form = document.querySelector<HTMLFormElement>("[data-login-form]");
const nextInput = document.querySelector<HTMLInputElement>("[data-login-next]");
const error = document.querySelector<HTMLElement>("[data-login-error]");
const defaultNext = window.location.pathname.replace(/\/login\/?$/, "/") || "/";

if (form) {
  form.action = window.location.pathname;
}

if (nextInput) {
  const next = params.get("next");
  nextInput.value = next && next.startsWith("/") && !next.startsWith("//") ? next : defaultNext;
}

if (error && params.get("error") === "invalid") {
  error.hidden = false;
}
