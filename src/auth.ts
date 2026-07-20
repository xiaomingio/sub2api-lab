/*
 * 文件说明: 提供登录表单处理和签名 Cookie 会话校验，保护 React 管理台页面和数据接口。
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";

type AuthConfig = {
  user: string;
  password: string;
  basePath: string;
};

type LoginForm = {
  username?: string;
  password?: string;
  next?: string;
};

const cookieName = "sub2api_lab_session";
const maxAgeSeconds = 7 * 24 * 60 * 60;
const sessionVersion = "v1";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function hmac(value: string, signingSecret: string): string {
  return createHmac("sha256", signingSecret).update(value).digest("base64url");
}

function sessionSigningSecret(config: AuthConfig): string {
  return `${sessionVersion}.${config.user}.${config.password}`;
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of header?.split(";") || []) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) {
      cookies.set(name, decodeURIComponent(value));
    }
  }
  return cookies;
}

function isHttpsRequest(request: FastifyRequest): boolean {
  const forwardedProto = request.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string" && forwardedProto.split(",")[0]?.trim() === "https") {
    return true;
  }
  return request.protocol === "https";
}

function cookiePath(basePath: string): string {
  return basePath ? `${basePath}/` : "/";
}

function buildCookie(params: {
  value: string;
  basePath: string;
  secure: boolean;
  maxAge?: number;
}): string {
  const parts = [
    `${cookieName}=${encodeURIComponent(params.value)}`,
    "HttpOnly",
    "SameSite=Lax",
    `Path=${cookiePath(params.basePath)}`
  ];
  if (params.secure) {
    parts.push("Secure");
  }
  if (params.maxAge !== undefined) {
    parts.push(`Max-Age=${params.maxAge}`);
  }
  return parts.join("; ");
}

function createSessionValue(user: string, signingSecret: string): string {
  const expiresAt = Date.now() + maxAgeSeconds * 1000;
  const payload = `${sessionVersion}.${expiresAt}.${Buffer.from(user, "utf8").toString("base64url")}`;
  return `${payload}.${hmac(payload, signingSecret)}`;
}

function isValidSession(value: string | undefined, user: string, signingSecret: string): boolean {
  if (!value) {
    return false;
  }
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== sessionVersion) {
    return false;
  }
  const [version, expiresAtRaw, encodedUser, signature] = parts;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return false;
  }
  const sessionUser = Buffer.from(encodedUser, "base64url").toString("utf8");
  const payload = `${version}.${expiresAtRaw}.${encodedUser}`;
  return safeEqual(sessionUser, user) && safeEqual(signature, hmac(payload, signingSecret));
}

function loginPath(basePath: string): string {
  return `${basePath}/login`.replace("//", "/");
}

function dashboardPath(basePath: string): string {
  return `${basePath}/`.replace("//", "/");
}

function isApiRequest(request: FastifyRequest, basePath: string): boolean {
  return request.url.startsWith("/api/") || Boolean(basePath && request.url.startsWith(`${basePath}/api/`));
}

function redirectTarget(request: FastifyRequest, basePath: string): string {
  const target = request.url.startsWith(basePath || "/") ? request.url : dashboardPath(basePath);
  return `${loginPath(basePath)}?next=${encodeURIComponent(target)}`;
}

function parseFormBody(body: unknown): LoginForm {
  if (typeof body !== "string") {
    return {};
  }
  const params = new URLSearchParams(body);
  return {
    username: params.get("username") || "",
    password: params.get("password") || "",
    next: params.get("next") || ""
  };
}

function safeNext(value: unknown, basePath: string): string {
  if (typeof value !== "string" || !value.startsWith("/")) {
    return dashboardPath(basePath);
  }
  if (value.startsWith("//")) {
    return dashboardPath(basePath);
  }
  if (basePath && !value.startsWith(`${basePath}/`)) {
    return dashboardPath(basePath);
  }
  return value;
}

export function createCookieAuth(config: AuthConfig) {
  const signingSecret = sessionSigningSecret(config);

  return {
    requireAuth: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const cookies = parseCookies(request.headers.cookie);
      if (isValidSession(cookies.get(cookieName), config.user, signingSecret)) {
        return;
      }
      if (isApiRequest(request, config.basePath)) {
        await reply.code(401).send({ error: "需要登录后查看统计数据" });
        return;
      }
      return reply.redirect(redirectTarget(request, config.basePath));
    },
    handleLogin: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const body = parseFormBody(request.body);
      if (safeEqual(body.username || "", config.user) && safeEqual(body.password || "", config.password)) {
        reply.header(
          "Set-Cookie",
          buildCookie({
            value: createSessionValue(config.user, signingSecret),
            basePath: config.basePath,
            secure: isHttpsRequest(request),
            maxAge: maxAgeSeconds
          })
        );
        return reply.redirect(safeNext((request.query as { next?: string }).next || body.next, config.basePath));
      }

      const next = safeNext((request.query as { next?: string }).next || body.next, config.basePath);
      return reply.redirect(`${loginPath(config.basePath)}?error=invalid&next=${encodeURIComponent(next)}`);
    },
    handleLogout: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      reply.header(
        "Set-Cookie",
        buildCookie({
          value: "",
          basePath: config.basePath,
          secure: isHttpsRequest(request),
          maxAge: 0
        })
      );
      return reply.redirect(loginPath(config.basePath));
    }
  };
}
