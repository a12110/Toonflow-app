import "./logger";
import "./err";
import "./env";
import express, { Request, Response, NextFunction } from "express";
import expressWs from "express-ws";
import logger from "morgan";
import cors from "cors";
import buildRoute from "@/core";
import fs from "fs";
import path from "path";
import u from "@/utils";
import jwt from "jsonwebtoken";

const app = express();
let server: ReturnType<typeof app.listen> | null = null;

function normalizeBasePath(rawPath?: string): string {
  const value = (rawPath || "/").trim();
  if (!value || value === "/") return "/";
  const normalized = (value.startsWith("/") ? value : `/${value}`).replace(/\/+$/, "");
  return normalized || "/";
}

function resolveDataRoot(): string {
  const dataRoot = process.env.DATA_ROOT?.trim();
  if (!dataRoot) return path.join(process.cwd(), "data");
  return path.isAbsolute(dataRoot) ? dataRoot : path.join(process.cwd(), dataRoot);
}

export default async function startServe(randomPort: Boolean = false) {
  if (process.env.NODE_ENV == "dev") await buildRoute();

  expressWs(app);

  app.use(logger("dev"));
  app.use(cors({ origin: "*" }));
  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ extended: true, limit: "100mb" }));

  const basePath = normalizeBasePath(process.env.BASE_PATH || "/");
  if (basePath !== "/") {
    app.use((req, _res, next) => {
      if (req.url === basePath || req.url.startsWith(`${basePath}/`)) {
        const stripped = req.url.slice(basePath.length);
        req.url = stripped ? (stripped.startsWith("/") ? stripped : `/${stripped}`) : "/";
      }
      next();
    });
  }

  let uploadRoot: string;
  if (typeof process.versions?.electron !== "undefined") {
    const { app } = require("electron");
    const userDataDir: string = app.getPath("userData");
    uploadRoot = path.join(userDataDir, "uploads");
  } else {
    uploadRoot = path.join(resolveDataRoot(), "uploads");
  }

  // 确保 uploads 目录存在
  if (!fs.existsSync(uploadRoot)) {
    fs.mkdirSync(uploadRoot, { recursive: true });
  }
  console.log("文件目录:", uploadRoot);

  const webRoot = path.join(process.cwd(), "scripts", "web");
  const webIndex = path.join(webRoot, "index.html");
  const hasWebStatic = fs.existsSync(webIndex);

  app.get("/healthz", (_req, res) => {
    res.status(200).send({ code: 200, data: { status: "ok" }, message: "ok" });
  });

  // 兼容旧的根路径访问，同时增加 /uploads 规范路径
  app.use("/uploads", express.static(uploadRoot));
  app.use(express.static(uploadRoot));

  if (hasWebStatic) {
    app.use(express.static(webRoot));
  }

  app.use(async (req, res, next) => {
    const setting = await u.db("t_setting").where("id", 1).select("tokenKey").first();
    if (!setting) return res.status(500).send({ message: "服务器未配置，请联系管理员" });
    const { tokenKey } = setting;

    const rawToken = req.headers.authorization || (req.query.token as string) || "";
    const token = rawToken.replace("Bearer ", "");

    if (req.path === "/other/login" || req.path === "/healthz") return next();

    if (!token) return res.status(401).send({ message: "未提供token" });
    try {
      const decoded = jwt.verify(token, tokenKey as string);
      (req as any).user = decoded;
      next();
    } catch (err) {
      return res.status(401).send({ message: "无效的token" });
    }
  });

  const router = await import("@/router");
  await router.default(app);

  if (hasWebStatic) {
    app.use((req, res, next) => {
      if (req.method !== "GET") return next();
      const accept = req.headers.accept || "";
      if (!accept.includes("text/html")) return next();
      return res.sendFile(webIndex);
    });
  }

  // 404 处理
  app.use((_, res, next: NextFunction) => {
    return res.status(404).send({ message: "Not Found" });
  });

  // 错误处理
  app.use((err: any, _: Request, res: Response, __: NextFunction) => {
    res.locals.message = err.message;
    res.locals.error = err;
    console.error(err);
    res.status(err.status || 500).send(err);
  });

  const port = randomPort ? 0 : parseInt(process.env.PORT || "60000");
  return await new Promise((resolve, reject) => {
    server = app.listen(port, async (v) => {
      const address = server?.address();
      const realPort = typeof address === "string" ? address : address?.port;
      console.log(`[服务启动成功]: http://localhost:${realPort}`);
      resolve(realPort);
    });
  });
}

// 支持await关闭
export function closeServe(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server) {
      server.close((err?: Error) => {
        if (err) return reject(err);
        console.log("[服务已关闭]");
        resolve();
      });
    } else {
      resolve();
    }
  });
}

const isElectron = typeof process.versions?.electron !== "undefined";
if (!isElectron) startServe();
