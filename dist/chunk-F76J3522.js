import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
import {
  TMP_DIR,
  publicUploadUrl
} from "./chunk-AINQSJV5.js";
import {
  db_exports,
  env,
  prisma
} from "./chunk-AFZENULZ.js";

// src/services/image-moderation.ts
import { readFile } from "fs/promises";
var baseUrl = () => env.IMAGE_MODERATION_URL.replace(/\/$/, "");
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function safeMessage(response) {
  try {
    const payload = await response.json();
    return String(payload?.detail || payload?.message || payload?.error || "").trim();
  } catch {
    try {
      return (await response.text()).slice(0, 300).trim();
    } catch {
      return "";
    }
  }
}
async function checkImageModerationHealth() {
  if (env.IMAGE_MODERATION_ENABLED.toLowerCase() !== "true") {
    return { ok: false, message: "A modera\xE7\xE3o de imagens est\xE1 desativada no servidor." };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8e3);
  try {
    const response = await fetch(`${baseUrl()}/health`, { signal: controller.signal });
    if (!response.ok) return { ok: false, message: `Moderador respondeu HTTP ${response.status}` };
    const payload = await response.json();
    return {
      ok: payload?.ready !== false && payload?.status === "ok",
      service: payload?.service,
      engine: payload?.engine,
      runtime: payload?.runtime,
      message: payload?.ready === false ? "Moderador ainda est\xE1 inicializando." : void 0
    };
  } catch (error) {
    return {
      ok: false,
      message: error?.name === "AbortError" ? "Timeout ao consultar o moderador." : "N\xE3o foi poss\xEDvel alcan\xE7ar o moderador local."
    };
  } finally {
    clearTimeout(timeout);
  }
}
async function runModeration(bytes, mimeType, originalName) {
  const attempts = Math.max(1, env.IMAGE_MODERATION_RETRIES + 1);
  let lastMessage = "A modera\xE7\xE3o de imagens est\xE1 temporariamente indispon\xEDvel.";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const body = new FormData();
    body.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), originalName || "image");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.IMAGE_MODERATION_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl()}/moderate-image`, {
        method: "POST",
        body,
        signal: controller.signal
      });
      if (response.ok) {
        const result = await response.json();
        if (typeof result.allowed !== "boolean") {
          throw Object.assign(new Error("Resposta inv\xE1lida do servi\xE7o de modera\xE7\xE3o de imagens."), { statusCode: 503 });
        }
        return result;
      }
      const detail = await safeMessage(response);
      if (response.status === 400 || response.status === 413 || response.status === 415 || response.status === 422) {
        const message = detail || "A imagem n\xE3o p\xF4de ser analisada.";
        throw Object.assign(new Error(message), { statusCode: response.status });
      }
      lastMessage = detail || `Moderador respondeu HTTP ${response.status}`;
    } catch (error) {
      if (error?.statusCode && Number(error.statusCode) < 500) throw error;
      if (error?.name === "AbortError") lastMessage = "O moderador excedeu o tempo de resposta.";
      else if (error?.message) lastMessage = String(error.message);
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < attempts) await sleep(Math.min(750 * 2 ** (attempt - 1), 4e3));
  }
  throw Object.assign(new Error(`A modera\xE7\xE3o local n\xE3o ficou pronta ap\xF3s ${attempts} tentativa(s). ${lastMessage}`), {
    statusCode: 503,
    code: "IMAGE_MODERATION_UNAVAILABLE"
  });
}
async function moderateImageFile(filePath, mimeType, originalName) {
  if (env.IMAGE_MODERATION_ENABLED.toLowerCase() !== "true") {
    throw Object.assign(new Error("A modera\xE7\xE3o de imagens est\xE1 desativada no servidor."), {
      statusCode: 503,
      code: "IMAGE_MODERATION_DISABLED"
    });
  }
  const bytes = await readFile(filePath);
  return runModeration(bytes, mimeType, originalName);
}

// src/services/media-moderation.ts
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
async function moderatePendingBatch(limit = 10) {
  const pending = await prisma.mediaAsset.findMany({
    where: { moderationStatus: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, name: true, mimeType: true, data: true }
  });
  let approved = 0;
  let rejected = 0;
  await mkdir(TMP_DIR, { recursive: true });
  for (const asset of pending) {
    const file = path.join(TMP_DIR, `mod-${asset.name}`);
    try {
      await writeFile(file, Buffer.from(asset.data));
      const result = await moderateImageFile(file, asset.mimeType, asset.name);
      await setModeration(asset.id, result.allowed ? "APPROVED" : "REJECTED", result.riskScore ?? null);
      result.allowed ? approved++ : rejected++;
    } finally {
      await unlink(file).catch(() => void 0);
    }
  }
  return { checked: pending.length, approved, rejected };
}
async function setModeration(id, status, score = null) {
  const asset = await prisma.mediaAsset.update({
    where: { id },
    data: { moderationStatus: status, moderationScore: score, moderatedAt: /* @__PURE__ */ new Date() },
    select: { name: true, uploadedById: true }
  });
  if (status === "REJECTED") await removeReferences(asset.name, asset.uploadedById);
  return asset;
}
async function removeReferences(name, userId) {
  const url = publicUploadUrl(name);
  const variants = [url, `/uploads/${name}`];
  await prisma.user.updateMany({ where: { avatarUrl: { in: variants } }, data: { avatarUrl: null } });
  await prisma.communityPost.updateMany({ where: { imageUrl: { in: variants } }, data: { imageUrl: null } });
  await prisma.libraryItem.updateMany({ where: { coverUrl: { in: variants } }, data: { coverUrl: null } });
  if (userId)
    await prisma.notification.create({
      data: {
        recipientId: userId,
        type: "SYSTEM",
        title: "Uma imagem sua foi removida",
        body: "A modera\xE7\xE3o autom\xE1tica identificou conte\xFAdo impr\xF3prio em uma imagem enviada. Ela foi retirada do seu perfil/publica\xE7\xE3o."
      }
    }).catch(() => void 0);
}

export {
  checkImageModerationHealth,
  moderateImageFile,
  moderatePendingBatch,
  setModeration
};
//# sourceMappingURL=chunk-F76J3522.js.map