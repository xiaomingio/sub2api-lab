/*
 * 文件说明: 读取并校验 sub2api-lab 的运行环境变量，集中提供服务、鉴权、数据库和 Sub2API 管理接口配置。
 */

type AppConfig = {
  host: string;
  port: number;
  basePath: string;
  timezone: string;
  authUser: string;
  authPassword: string;
  defaultRange: string;
  maxRows: number;
  sub2api: {
    baseUrl: string;
    adminApiKey: string;
  };
  databaseUrl: string;
};

function getEnv(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function getRequiredEnv(name: string): string {
  const value = getEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getIntegerEnv(name: string, fallback: number): number {
  const raw = getEnv(name);
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid positive integer environment variable: ${name}`);
  }
  return value;
}

const defaultRange = "last_24_hours";
const maxRows = 1000;

function getDatabaseUrl(): string {
  const value = getRequiredEnv("DATABASE_URL");
  try {
    new URL(value);
  } catch {
    throw new Error("Invalid DATABASE_URL");
  }
  return value;
}

export function loadConfig(): AppConfig {
  return {
    host: getEnv("SUB2API_LAB_HOST", "127.0.0.1"),
    port: getIntegerEnv("SUB2API_LAB_PORT", 9100),
    basePath: normalizeBasePath(getEnv("SUB2API_LAB_BASE_PATH", "")),
    timezone: getEnv("SUB2API_LAB_TIMEZONE", "Asia/Shanghai"),
    authUser: getRequiredEnv("SUB2API_LAB_AUTH_USER"),
    authPassword: getRequiredEnv("SUB2API_LAB_AUTH_PASSWORD"),
    defaultRange,
    maxRows,
    sub2api: {
      baseUrl: getEnv("SUB2API_BASE_URL", "http://127.0.0.1:8080").replace(/\/+$/, ""),
      adminApiKey: getEnv("SUB2API_ADMIN_API_KEY")
    },
    databaseUrl: getDatabaseUrl()
  };
}

function normalizeBasePath(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export type { AppConfig };
