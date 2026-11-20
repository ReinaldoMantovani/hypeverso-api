import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
import {
  db_exports,
  env,
  prisma
} from "./chunk-AFZENULZ.js";

// src/lib/paths.ts
import os from "os";
import path from "path";
var API_DIR = process.cwd();
var UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(API_DIR, "uploads");
var TMP_DIR = path.join(os.tmpdir(), "hypeverso-uploads");

// src/lib/media-store.ts
import { readFile, unlink } from "fs/promises";
import path2 from "path";
import { createHash } from "crypto";
var MIME_BY_EXT = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif"
};
var MAX_STORED_BYTES = 12 * 1024 * 1024;
var SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;
var PLACEHOLDER_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="#140d24"/><path d="M200 140a40 40 0 1 1 0 80a40 40 0 1 1 0-80zm-90 170c10-45 50-70 90-70s80 25 90 70z" fill="#3b2a63"/></svg>'
);
function mimeFromName(name) {
  return MIME_BY_EXT[name.split(".").pop()?.toLowerCase() || ""] || "application/octet-stream";
}
function publicUploadUrl(name) {
  return `${env.PUBLIC_WEB_URL.replace(/\/$/, "")}/uploads/${name}`;
}
async function saveMediaBuffer(name, data, options = {}) {
  if (!SAFE_NAME.test(name)) throw new Error("Nome de arquivo inv\xE1lido");
  if (!data.length || data.length > MAX_STORED_BYTES) throw new Error("Imagem vazia ou grande demais");
  await prisma.mediaAsset.create({
    data: {
      name,
      data,
      bytes: data.length,
      mimeType: options.mimeType || mimeFromName(name),
      purpose: options.purpose || name.split("-")[0] || "article",
      width: options.width,
      height: options.height,
      uploadedById: options.uploadedById,
      moderationStatus: options.moderationStatus || "NOT_REQUIRED"
    }
  });
  return publicUploadUrl(name);
}
async function saveMediaFile(name, filePath, options = {}) {
  try {
    const data = await readFile(filePath);
    return await saveMediaBuffer(name, data, options);
  } finally {
    await unlink(filePath).catch(() => void 0);
  }
}
var SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  "Cross-Origin-Resource-Policy": "cross-origin"
};
var hidePendingCache = null;
async function hidePending() {
  if (hidePendingCache && Date.now() - hidePendingCache.at < 6e4) return hidePendingCache.value;
  const { getAllSettings } = await import("./settings-KPQOR3HS.js");
  const value = (await getAllSettings()).moderation.hideUntilApproved;
  hidePendingCache = { at: Date.now(), value };
  return value;
}
function registerUploadServing(app) {
  const serve = async (req, reply, rawName, legacyDir) => {
    if (!SAFE_NAME.test(rawName)) return reply.code(404).send({ error: "Arquivo n\xE3o encontrado" });
    reply.headers(SECURITY_HEADERS);
    const asset = await prisma.mediaAsset.findUnique({
      where: { name: rawName },
      select: { data: true, mimeType: true, bytes: true, createdAt: true, moderationStatus: true }
    });
    const hidden = asset && (asset.moderationStatus === "REJECTED" || asset.moderationStatus === "PENDING" && await hidePending());
    if (asset && hidden) {
      return reply.header("content-type", "image/svg+xml").header("cache-control", "no-store").send(PLACEHOLDER_SVG);
    }
    if (asset) {
      const cacheControl = asset.moderationStatus === "PENDING" ? "public, max-age=300" : "public, max-age=31536000, immutable";
      const etag = `"${createHash("sha1").update(rawName + asset.bytes).digest("hex").slice(0, 20)}"`;
      if (req.headers["if-none-match"] === etag) return reply.code(304).send();
      return reply.header("content-type", asset.mimeType).header("cache-control", cacheControl).header("etag", etag).header("last-modified", asset.createdAt.toUTCString()).send(Buffer.from(asset.data));
    }
    try {
      const file = path2.join(UPLOAD_DIR, ...legacyDir ? [legacyDir] : [], rawName);
      if (!file.startsWith(UPLOAD_DIR)) throw new Error("fora da pasta");
      const data = await readFile(file);
      return reply.header("content-type", mimeFromName(rawName)).header("cache-control", "public, max-age=86400").send(data);
    } catch {
      return reply.code(404).header("cache-control", "no-store").send({ error: "Arquivo n\xE3o encontrado" });
    }
  };
  app.get("/uploads/:name", (req, reply) => serve(req, reply, String(req.params.name || "")));
  app.get("/uploads/ai-news/:name", (req, reply) => serve(req, reply, String(req.params.name || ""), "ai-news"));
}

export {
  TMP_DIR,
  publicUploadUrl,
  saveMediaBuffer,
  saveMediaFile,
  registerUploadServing
};
//# sourceMappingURL=chunk-AINQSJV5.js.map