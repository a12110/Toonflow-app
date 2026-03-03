export interface ApiResponse {
  code: number;
  data: any;
  message: string;
}

const ASSET_KEYS = new Set(["filePath", "url", "firstFrame", "storyboardImgs", "imageUrl", "path"]);

function normalizeBasePath(rawPath?: string): string {
  const value = (rawPath || "/").trim();
  if (!value || value === "/") return "/";
  const normalized = (value.startsWith("/") ? value : `/${value}`).replace(/\/+$/, "");
  return normalized || "/";
}

function toClientAssetPath(value: string): string {
  const basePath = normalizeBasePath(process.env.BASE_PATH || "/");
  const raw = value.trim();
  if (!raw || raw.startsWith("data:")) return value;

  let pathname = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      pathname = new URL(raw).pathname;
    } catch {
      return value;
    }
  }

  pathname = pathname.split("?")[0]?.split("#")[0] || pathname;
  if (!pathname) return value;

  if (!pathname.startsWith("/")) pathname = `/${pathname}`;

  if (basePath !== "/" && pathname.startsWith(`${basePath}/`)) {
    pathname = pathname.slice(basePath.length) || "/";
  }

  if (pathname !== "/uploads" && !pathname.startsWith("/uploads/")) {
    pathname = `/uploads${pathname}`;
  }

  pathname = pathname.replace(/\/{2,}/g, "/");
  if (basePath === "/") return pathname;
  return `${basePath}${pathname}`;
}

function normalizeResponseData(data: any): any {
  if (Array.isArray(data)) {
    return data.map((item) => normalizeResponseData(item));
  }

  if (data && typeof data === "object") {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "string" && ASSET_KEYS.has(key)) {
        result[key] = toClientAssetPath(value);
      } else if (Array.isArray(value) || (value && typeof value === "object")) {
        result[key] = normalizeResponseData(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  return data;
}

// 成功回调
export function success<T>(data: T | null = null, message: string = "成功"): ApiResponse {
  return {
    code: 200,
    data: normalizeResponseData(data),
    message,
  };
}

// 客户端错误响应
export function error<T>(message: string = "", data: T | null = null): ApiResponse {
  return {
    code: 400,
    data,
    message,
  };
}
