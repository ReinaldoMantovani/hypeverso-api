import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
import {
  getActiveAiModel,
  getAiNewsHealth,
  randomToken,
  sha256,
  slugify,
  startAiNewsWorker,
  stopAiNewsWorker
} from "./chunk-DLAJTYKO.js";
import {
  semanticCandidates
} from "./chunk-GCV4ST27.js";
import {
  checkImageModerationHealth,
  moderateImageFile,
  setModeration
} from "./chunk-F76J3522.js";
import {
  TMP_DIR,
  registerUploadServing,
  saveMediaFile
} from "./chunk-AINQSJV5.js";
import {
  isAllowedPushEndpoint,
  isNewsletterSlot,
  notify,
  notifyFollowersActivity,
  notifyNewsPublished,
  processMediaReleaseReminders,
  pushEnabled,
  sendConfirmationEmail,
  sendMail,
  sendWeeklyDigest,
  stringList,
  unsubscribeLinks
} from "./chunk-QI3TW2B2.js";
import {
  removePostFromSearchIndex,
  searchIndexHealth,
  searchPostsWithMeili,
  syncPostToSearchIndex
} from "./chunk-YXQVW2OS.js";
import {
  bullEnabled,
  enqueueAiNewsJob,
  enqueueNewsPublished,
  enqueueSearchRemove,
  enqueueSearchSync,
  getBullQueue,
  queueNames,
  queueSnapshot,
  removeAiNewsQueueJob
} from "./chunk-RJRFEJ4O.js";
import {
  applyCheckResult
} from "./chunk-DVHMYG66.js";
import {
  getAllSettings,
  getPublicSettings,
  saveSetting,
  settingSchemas
} from "./chunk-OG6KD6QD.js";
import {
  delCache,
  getCache,
  redis,
  redisOptions,
  setCache
} from "./chunk-ZIMWUEV2.js";
import {
  allowedOrigins,
  db_exports,
  emailVerificationRequired,
  env,
  mfaRequiredForStaff,
  prisma,
  redisConfigured,
  swaggerEnabled,
  trustProxySetting
} from "./chunk-AFZENULZ.js";

// src/app.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import rawBody from "fastify-raw-body";

// src/routes/auth.ts
import { z } from "zod";

// src/lib/auth.ts
import argon2 from "argon2";
import { randomBytes, timingSafeEqual } from "crypto";
var ACCESS_COOKIE = "nv_access";
var REFRESH_COOKIE = "nv_refresh";
var CSRF_COOKIE = "nv_csrf";
var CSRF_HEADER = "x-csrf-token";
var MFA_ROLES = ["ADMIN", "EDITOR"];
var hashPassword = (v) => argon2.hash(v, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
var verifyPassword = (hash, v) => argon2.verify(hash, v);
var secure = () => env.COOKIE_SECURE === "true";
function ttlSeconds(value) {
  const m = /^(\d+)\s*([smhd]?)$/.exec(value.trim());
  if (!m) return 900;
  const n = Number(m[1]);
  return n * ({ s: 1, m: 60, h: 3600, d: 86400 }[m[2] || "s"] ?? 1);
}
function setRefreshCookie(reply, token) {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: secure(),
    sameSite: "lax",
    path: "/api/auth",
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86400
  });
}
function setAccessCookie(reply, token) {
  reply.setCookie(ACCESS_COOKIE, token, {
    httpOnly: true,
    secure: secure(),
    sameSite: "lax",
    path: "/api",
    maxAge: ttlSeconds(env.ACCESS_TOKEN_TTL)
  });
}
function ensureCsrfCookie(request, reply) {
  const current = request.cookies[CSRF_COOKIE];
  if (current && /^[A-Za-z0-9_-]{32,}$/.test(current)) return current;
  const token = randomBytes(32).toString("base64url");
  reply.setCookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: secure(),
    sameSite: "lax",
    path: "/",
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86400
  });
  return token;
}
function clearAuthCookies(reply) {
  reply.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
  reply.clearCookie(ACCESS_COOKIE, { path: "/api" });
}
var isMobileClient = (request) => request.headers["x-client-platform"] === "mobile";
async function issueTokens(app2, user, request, reply, options = {}) {
  const mfa = Boolean(options.mfa);
  const accessToken = app2.jwt.sign(
    { sub: user.id, email: user.email, role: user.role, mfa },
    { expiresIn: env.ACCESS_TOKEN_TTL }
  );
  const refreshToken = randomToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 864e5);
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: sha256(refreshToken), expiresAt, mfaVerified: mfa }
  });
  setRefreshCookie(reply, refreshToken);
  setAccessCookie(reply, accessToken);
  ensureCsrfCookie(request, reply);
  if (isMobileClient(request)) {
    reply.header("x-refresh-token", refreshToken);
    return accessToken;
  }
  return void 0;
}
async function authenticate(request, reply) {
  try {
    const p = await request.jwtVerify();
    request.authUser = { id: p.sub, email: p.email, role: p.role, mfa: Boolean(p.mfa) };
  } catch {
    return reply.code(401).send({ error: "N\xE3o autenticado" });
  }
}
async function optionalUser(request) {
  try {
    const p = await request.jwtVerify();
    return { id: p.sub, role: p.role, mfa: Boolean(p.mfa) };
  } catch {
    return null;
  }
}
var requireRole = (...roles) => async (request, reply) => {
  await authenticate(request, reply);
  if (reply.sent) return;
  const user = request.authUser;
  if (!user || !roles.includes(user.role)) return reply.code(403).send({ error: "Acesso negado" });
  if (mfaRequiredForStaff && MFA_ROLES.includes(user.role) && !user.mfa) {
    const row = await prisma.user.findUnique({ where: { id: user.id }, select: { totpEnabledAt: true } });
    const code = row?.totpEnabledAt ? "MFA_REQUIRED" : "MFA_SETUP_REQUIRED";
    return reply.code(403).send({
      error: code === "MFA_REQUIRED" ? "Entre novamente e confirme o c\xF3digo de verifica\xE7\xE3o em duas etapas." : "Ative a verifica\xE7\xE3o em duas etapas em Conta \u203A Seguran\xE7a para acessar a \xE1rea administrativa.",
      code
    });
  }
};
var UNSAFE = /* @__PURE__ */ new Set(["POST", "PUT", "PATCH", "DELETE"]);
var CSRF_EXEMPT = /* @__PURE__ */ new Set(["/api/billing/webhook"]);
function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
async function csrfGuard(request, reply) {
  if (!UNSAFE.has(request.method)) return;
  const path2 = request.url.split("?")[0];
  if (CSRF_EXEMPT.has(path2)) return;
  const cookies = request.cookies || {};
  const usesCookieSession = Boolean(cookies[ACCESS_COOKIE] || cookies[REFRESH_COOKIE]);
  if (!usesCookieSession || request.headers.authorization) return;
  const origin = request.headers.origin;
  if (origin) {
    const trusted = /* @__PURE__ */ new Set([...allowedOrigins, new URL(env.PUBLIC_WEB_URL).origin]);
    if (!trusted.has(origin)) return reply.code(403).send({ error: "Origem n\xE3o autorizada", code: "CSRF_ORIGIN" });
  }
  const header = request.headers[CSRF_HEADER];
  const cookie2 = cookies[CSRF_COOKIE];
  if (typeof header !== "string" || !cookie2 || !safeEqual(header, cookie2)) {
    return reply.code(403).send({ error: "Sess\xE3o de seguran\xE7a expirada. Recarregue a p\xE1gina.", code: "CSRF_INVALID" });
  }
}

// src/lib/captcha.ts
var captchaEnabled = () => Boolean(env.TURNSTILE_SECRET_KEY);
async function verifyCaptcha(token, ip) {
  if (!captchaEnabled()) return true;
  if (!token || token.length > 2048) return false;
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(8e3)
    });
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}
function captchaError() {
  const error = new Error("Confirme que voc\xEA n\xE3o \xE9 um rob\xF4 e tente novamente.");
  error.statusCode = 400;
  error.code = "CAPTCHA_FAILED";
  return error;
}

// src/lib/signed-token.ts
import { createHmac, timingSafeEqual as timingSafeEqual2 } from "crypto";
var secret = `signed-token:${env.JWT_REFRESH_SECRET}`;
function signToken(payload, ttlSeconds2) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1e3) + ttlSeconds2 })).toString(
    "base64url"
  );
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verifySignedToken(token, purpose) {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (expected.length !== given.length || !timingSafeEqual2(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (data.purpose !== purpose || typeof data.exp !== "number" || data.exp < Date.now() / 1e3) return null;
    return data;
  } catch {
    return null;
  }
}

// src/lib/crypto-box.ts
import { createCipheriv, createDecipheriv, createHash, randomBytes as randomBytes2 } from "crypto";
var key = createHash("sha256").update(env.MFA_ENCRYPTION_KEY || `mfa:${env.JWT_REFRESH_SECRET}`).digest();
function seal(plain) {
  const iv = randomBytes2(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(
    "."
  );
}
function open(sealed) {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Formato de segredo inv\xE1lido");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

// src/lib/totp.ts
import { createHmac as createHmac2, randomBytes as randomBytes3, timingSafeEqual as timingSafeEqual3 } from "crypto";
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
var STEP_SECONDS = 30;
var DIGITS = 6;
function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = value << 8 | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[value >>> bits - 5 & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[value << 5 - bits & 31];
  return out;
}
function base32Decode(input) {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    value = value << 5 | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push(value >>> bits - 8 & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function generateTotpSecret() {
  return base32Encode(randomBytes3(20));
}
function currentStep(now = Date.now()) {
  return Math.floor(now / 1e3 / STEP_SECONDS);
}
function hotp(secret2, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac2("sha1", base32Decode(secret2)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const code = (hmac.readUInt32BE(offset) & 2147483647) % 10 ** DIGITS;
  return code.toString().padStart(DIGITS, "0");
}
function verifyTotp(secret2, code, lastUsedStep, now = Date.now()) {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const step = currentStep(now);
  for (const delta of [0, -1, 1]) {
    const candidate = step + delta;
    if (lastUsedStep != null && candidate <= lastUsedStep) continue;
    const expected = Buffer.from(hotp(secret2, candidate));
    const given = Buffer.from(normalized);
    if (expected.length === given.length && timingSafeEqual3(expected, given)) return candidate;
  }
  return null;
}
function otpauthUrl(secret2, account, issuer) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secret2,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS)
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes3(6)).slice(0, 10).toLowerCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

// src/lib/client-ip.ts
import { timingSafeEqual as timingSafeEqual4 } from "crypto";
import { isIP } from "net";
var GATEWAY_SECRET_HEADER = "x-hv-gateway-secret";
var GATEWAY_CLIENT_IP_HEADER = "x-hv-client-ip";
function sameSecret(received, expected) {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual4(a, b);
}
function isTrustedGateway(request) {
  const expected = (env.GATEWAY_SHARED_SECRET || "").trim();
  if (expected.length < 16) return false;
  const received = request.headers[GATEWAY_SECRET_HEADER];
  return typeof received === "string" && sameSecret(received, expected);
}
function clientIp(request) {
  if (isTrustedGateway(request)) {
    const raw = request.headers[GATEWAY_CLIENT_IP_HEADER];
    const value = (Array.isArray(raw) ? raw[0] : raw || "").split(",")[0].trim();
    if (value && isIP(value)) return value;
  }
  return request.ip;
}

// src/routes/auth.ts
var dummyHashPromise = null;
var dummyHash = () => dummyHashPromise ??= hashPassword(randomToken());
var escapeHtml = (v) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
var credentials = z.object({
  email: z.string().email().transform((v) => v.toLowerCase()),
  password: z.string().min(8).max(128)
});
async function sendVerificationEmail(userId, email, name) {
  const raw = randomToken();
  await prisma.emailVerificationToken.create({
    data: { userId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 24 * 36e5) }
  });
  await sendMail(
    email,
    "Confirme seu e-mail no Hypeverso",
    `<h1>Bem-vindo ao Hypeverso, ${escapeHtml(name)}</h1><p>Confirme seu e-mail para comentar e publicar na comunidade:</p><p><a href="${env.PUBLIC_WEB_URL}/verify-email?token=${raw}">Confirmar e-mail</a></p><p>O link vale por 24 horas.</p>`
  );
}
var authRoutes = async (app2) => {
  app2.post("/register", { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = z.object({
      name: z.string().trim().min(2).max(100),
      username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
      email: z.string().email().max(254),
      password: z.string().min(8).max(128),
      acceptTerms: z.literal(true, { message: "\xC9 necess\xE1rio aceitar os Termos de Uso e a Pol\xEDtica de Privacidade." }),
      captchaToken: z.string().max(2048).optional()
    }).parse(req.body);
    if (!await verifyCaptcha(body.captchaToken, clientIp(req))) throw captchaError();
    const email = body.email.toLowerCase();
    const username = slugify(body.username).replace(/-/g, "_");
    const exists = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
    if (exists) return reply.code(409).send({ error: "Email ou usu\xE1rio j\xE1 cadastrado" });
    const user = await prisma.user.create({
      data: {
        name: body.name,
        username,
        email,
        passwordHash: await hashPassword(body.password),
        termsAcceptedAt: /* @__PURE__ */ new Date(),
        termsVersion: env.LEGAL_TERMS_VERSION,
        subscription: { create: {} }
      },
      select: { id: true, name: true, username: true, email: true, role: true, level: true, xp: true, avatarUrl: true }
    });
    await sendVerificationEmail(user.id, email, body.name);
    const accessToken = await issueTokens(app2, user, req, reply);
    return reply.code(201).send({ user: { ...user, emailVerifiedAt: null }, ...accessToken ? { accessToken } : {} });
  });
  app2.post("/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = credentials.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email }, include: { subscription: true } });
    if (!user) {
      await verifyPassword(await dummyHash(), body.password).catch(() => false);
      return reply.code(401).send({ error: "Credenciais inv\xE1lidas" });
    }
    if (!await verifyPassword(user.passwordHash, body.password))
      return reply.code(401).send({ error: "Credenciais inv\xE1lidas" });
    if (user.status !== "ACTIVE") return reply.code(403).send({ error: "Conta indispon\xEDvel" });
    if (user.totpEnabledAt) {
      const mfaToken = signToken({ purpose: "mfa-login", sub: user.id }, 300);
      return { mfaRequired: true, mfaToken };
    }
    const accessToken = await issueTokens(app2, user, req, reply);
    return {
      ...accessToken ? { accessToken } : {},
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        level: user.level,
        xp: user.xp,
        avatarUrl: user.avatarUrl,
        emailVerifiedAt: user.emailVerifiedAt,
        subscription: user.subscription,
        mfaEnabled: Boolean(user.totpEnabledAt)
      }
    };
  });
  app2.post("/mfa/verify", { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } }, async (req, reply) => {
    const body = z.object({ mfaToken: z.string().min(10).max(1e3), code: z.string().trim().min(6).max(20) }).parse(req.body);
    const challenge = verifySignedToken(body.mfaToken, "mfa-login");
    if (!challenge) return reply.code(401).send({ error: "O desafio expirou. Entre novamente.", code: "MFA_EXPIRED" });
    const user = await prisma.user.findUnique({ where: { id: challenge.sub }, include: { subscription: true } });
    if (!user || user.status !== "ACTIVE" || !user.totpSecret)
      return reply.code(401).send({ error: "N\xE3o foi poss\xEDvel validar o c\xF3digo." });
    let ok = false;
    if (/^\d{6}$/.test(body.code.replace(/\s+/g, ""))) {
      const step = verifyTotp(open(user.totpSecret), body.code, user.totpLastStep);
      if (step != null) {
        const claimed = await prisma.user.updateMany({
          where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
          data: { totpLastStep: step }
        });
        ok = claimed.count === 1;
      }
    } else {
      const hash = sha256(body.code.toLowerCase().replace(/\s+/g, ""));
      const codes = stringList(user.totpRecoveryCodes);
      if (codes.includes(hash)) {
        await prisma.user.update({
          where: { id: user.id },
          data: { totpRecoveryCodes: codes.filter((c) => c !== hash) }
        });
        ok = true;
        req.log.warn({ userId: user.id }, "Login com c\xF3digo de recupera\xE7\xE3o de 2FA");
      }
    }
    if (!ok) return reply.code(401).send({ error: "C\xF3digo inv\xE1lido.", code: "MFA_INVALID" });
    const accessToken = await issueTokens(app2, user, req, reply, { mfa: true });
    return {
      ...accessToken ? { accessToken } : {},
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        level: user.level,
        xp: user.xp,
        avatarUrl: user.avatarUrl,
        emailVerifiedAt: user.emailVerifiedAt,
        subscription: user.subscription,
        mfaEnabled: true
      }
    };
  });
  app2.get("/csrf", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return { csrfToken: ensureCsrfCookie(req, reply) };
  });
  app2.post(
    "/resend-verification",
    { preHandler: authenticate, config: { rateLimit: { max: 3, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      const user = await prisma.user.findUnique({
        where: { id: req.authUser.id },
        select: { id: true, email: true, name: true, emailVerifiedAt: true }
      });
      if (!user) return reply.code(404).send({ error: "Usu\xE1rio n\xE3o encontrado" });
      if (user.emailVerifiedAt) return { ok: true, alreadyVerified: true };
      await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });
      await sendVerificationEmail(user.id, user.email, user.name);
      return { ok: true };
    }
  );
  app2.post("/refresh", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {});
    const raw = body.refreshToken || req.cookies.nv_refresh;
    if (!raw) return reply.code(401).send({ error: "Refresh token ausente" });
    const token = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) }, include: { user: true } });
    if (token?.revokedAt && Date.now() - token.revokedAt.getTime() > 3e4) {
      await prisma.refreshToken.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: /* @__PURE__ */ new Date() }
      });
      req.log.warn({ userId: token.userId }, "Reuso de refresh token detectado; sess\xF5es revogadas");
    }
    if (!token || token.revokedAt || token.expiresAt < /* @__PURE__ */ new Date() || token.user.status !== "ACTIVE") {
      clearAuthCookies(reply);
      return reply.code(401).send({ error: "Sess\xE3o expirada" });
    }
    await prisma.refreshToken.update({ where: { id: token.id }, data: { revokedAt: /* @__PURE__ */ new Date() } });
    const accessToken = await issueTokens(app2, token.user, req, reply, { mfa: token.mfaVerified });
    return accessToken ? { accessToken } : { ok: true };
  });
  app2.post("/logout", async (req, reply) => {
    const body = z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {});
    const raw = body.refreshToken || req.cookies.nv_refresh;
    if (raw)
      await prisma.refreshToken.updateMany({
        where: { tokenHash: sha256(raw), revokedAt: null },
        data: { revokedAt: /* @__PURE__ */ new Date() }
      });
    clearAuthCookies(reply);
    return reply.code(204).send();
  });
  app2.post("/verify-email", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
    const row = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.expiresAt < /* @__PURE__ */ new Date()) return reply.code(400).send({ error: "Token inv\xE1lido ou expirado" });
    await prisma.$transaction([
      prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: /* @__PURE__ */ new Date() } }),
      prisma.emailVerificationToken.deleteMany({ where: { userId: row.userId } })
    ]);
    return { ok: true };
  });
  app2.post("/forgot-password", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req) => {
    const { email, captchaToken } = z.object({ email: z.string().email().max(254), captchaToken: z.string().max(2048).optional() }).parse(req.body);
    if (!await verifyCaptcha(captchaToken, clientIp(req))) throw captchaError();
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (user) {
      const raw = randomToken();
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 36e5) }
      });
      await sendMail(
        user.email,
        "Recupera\xE7\xE3o de senha Hypeverso",
        `<p><a href="${env.PUBLIC_WEB_URL}/reset-password?token=${raw}">Criar nova senha</a></p>`
      );
    }
    return { ok: true };
  });
  app2.post("/reset-password", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const { token, password } = z.object({ token: z.string().min(20).max(200), password: z.string().min(8).max(128) }).parse(req.body);
    const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt || row.expiresAt < /* @__PURE__ */ new Date())
      return reply.code(400).send({ error: "Token inv\xE1lido ou expirado" });
    await prisma.$transaction([
      prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(password) } }),
      prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: /* @__PURE__ */ new Date() } }),
      prisma.refreshToken.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: /* @__PURE__ */ new Date() }
      })
    ]);
    return { ok: true };
  });
};
var auth_default = authRoutes;

// src/routes/content.ts
import { z as z2 } from "zod";
import sanitizeHtml from "sanitize-html";

// src/lib/verified-email.ts
async function assertVerifiedEmail(userId) {
  if (!emailVerificationRequired) return;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true, role: true } });
  if (user?.emailVerifiedAt || user && user.role !== "USER") return;
  const error = new Error("Confirme seu e-mail para participar. Reenvie o link em Conta \u203A Privacidade.");
  error.statusCode = 403;
  error.code = "EMAIL_NOT_VERIFIED";
  throw error;
}

// src/services/views.ts
import { createHash as createHash2 } from "crypto";
var PENDING = "views:pending";
var EVENTS = "views:events";
var DEDUPE_SECONDS = 30 * 60;
var MAX_EVENTS_PER_FLUSH = 5e3;
function viewerKey(userId, ip, userAgent = "") {
  if (userId) return `u:${userId}`;
  const day = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  return `a:${createHash2("sha256").update(`${day}|${ip}|${userAgent}`).digest("hex").slice(0, 24)}`;
}
async function recordPostView(input) {
  try {
    const fresh = await redis.set(`views:seen:${input.postId}:${input.viewer}`, "1", "EX", DEDUPE_SECONDS, "NX");
    if (!fresh) return { counted: false };
    await redis.multi().hincrby(PENDING, input.postId, 1).rpush(
      EVENTS,
      JSON.stringify({ p: input.postId, u: input.userId || null, path: input.path || null, t: Date.now() })
    ).exec();
    return { counted: true };
  } catch {
    await prisma.$transaction([
      prisma.post.updateMany({ where: { id: input.postId }, data: { viewCount: { increment: 1 } } }),
      prisma.analyticsEvent.create({
        data: { userId: input.userId, postId: input.postId, type: "POST_VIEW", path: input.path }
      }),
      ...input.userId ? [
        prisma.userInteraction.create({
          data: { userId: input.userId, postId: input.postId, type: "VIEW", weight: 1 }
        })
      ] : []
    ]);
    return { counted: true };
  }
}
var flushing = false;
async function flushViews(log) {
  if (flushing) return 0;
  flushing = true;
  let total = 0;
  try {
    const batchKey = `${PENDING}:flush:${Date.now()}:${process.pid}`;
    const renamed = await redis.rename(PENDING, batchKey).then(
      () => true,
      () => false
    );
    if (renamed) {
      const counts = await redis.hgetall(batchKey);
      const entries = Object.entries(counts).filter(([, n]) => Number(n) > 0);
      for (let i = 0; i < entries.length; i += 100) {
        const chunk = entries.slice(i, i + 100);
        await prisma.$transaction(
          chunk.map(
            ([id, n]) => prisma.post.updateMany({ where: { id }, data: { viewCount: { increment: Number(n) } } })
          )
        );
        total += chunk.reduce((sum, [, n]) => sum + Number(n), 0);
      }
      await redis.unlink(batchKey);
    }
    const raw = await redis.lpop(EVENTS, MAX_EVENTS_PER_FLUSH) || [];
    if (raw.length) {
      const events = raw.map((r) => {
        try {
          return JSON.parse(r);
        } catch {
          return null;
        }
      }).filter((e) => !!e);
      const validIds = new Set(
        (await prisma.post.findMany({
          where: { id: { in: [...new Set(events.map((e) => e.p))] } },
          select: { id: true }
        })).map((r) => r.id)
      );
      const valid = events.filter((e) => validIds.has(e.p));
      if (valid.length) {
        await prisma.analyticsEvent.createMany({
          data: valid.map((e) => ({
            type: "POST_VIEW",
            postId: e.p,
            userId: e.u,
            path: e.path,
            createdAt: new Date(e.t)
          }))
        });
        const interactions = valid.filter((e) => e.u);
        if (interactions.length)
          await prisma.userInteraction.createMany({
            data: interactions.map((e) => ({
              userId: e.u,
              postId: e.p,
              type: "VIEW",
              weight: 1,
              createdAt: new Date(e.t)
            })),
            skipDuplicates: true
          });
      }
    }
    return total;
  } catch (error) {
    log?.warn({ err: error }, "Falha ao gravar visualiza\xE7\xF5es em lote; nova tentativa no pr\xF3ximo ciclo");
    return 0;
  } finally {
    flushing = false;
  }
}

// src/shared/config.ts
var XP_RULES = {
  COMMENT_CREATED: 10,
  COMMUNITY_POST_CREATED: 15,
  FAVORITE_ADDED: 2,
  PROFILE_COMPLETED: 25
};

// src/services/gamification.ts
async function addXp(userId, amount) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { xp: true, level: true } });
  if (!user) return;
  const xp = user.xp + amount;
  const level = Math.max(1, Math.floor(Math.sqrt(xp / 250)) + 1);
  await prisma.user.update({ where: { id: userId }, data: { xp, level } });
}
async function unlock(userId, code) {
  const a = await prisma.achievement.findUnique({ where: { code } });
  if (!a) return false;
  const exists = await prisma.userAchievement.findUnique({
    where: { userId_achievementId: { userId, achievementId: a.id } }
  });
  if (exists) return false;
  await prisma.$transaction([
    prisma.userAchievement.create({ data: { userId, achievementId: a.id } }),
    prisma.user.update({ where: { id: userId }, data: { xp: { increment: a.xpReward } } }),
    prisma.notification.create({
      data: {
        recipientId: userId,
        type: "ACHIEVEMENT",
        title: `Conquista desbloqueada: ${a.name}`,
        body: a.description,
        entityType: "achievement",
        entityId: a.id
      }
    })
  ]);
  return true;
}

// src/routes/content.ts
var publicSelect = {
  id: true,
  viewCount: true,
  title: true,
  slug: true,
  description: true,
  coverImageUrl: true,
  isPremium: true,
  publishedAt: true,
  createdAt: true,
  category: { select: { id: true, name: true, slug: true } },
  author: { select: { id: true, name: true, username: true, avatarUrl: true } },
  tags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
  _count: { select: { comments: true, favorites: true } }
};
async function queuePostPublished(postId, log) {
  if (bullEnabled()) {
    await Promise.all([
      enqueueNewsPublished(postId).catch(
        (error) => log.warn({ err: error, postId }, "BullMQ: notifica\xE7\xE3o ficar\xE1 para reconcilia\xE7\xE3o/manual")
      ),
      enqueueSearchSync(postId).catch(
        (error) => log.warn({ err: error, postId }, "BullMQ: indexa\xE7\xE3o ficar\xE1 para o discovery-worker")
      )
    ]);
    return;
  }
  await notifyNewsPublished(postId).catch(
    (error) => log.error({ err: error, postId }, "Notifica\xE7\xE3o de not\xEDcia falhou")
  );
  void syncPostToSearchIndex(postId).catch(
    (error) => log.warn({ err: error, postId }, "Sincroniza\xE7\xE3o da busca falhou")
  );
}
async function queuePostSearchSync(postId, log) {
  if (bullEnabled())
    await enqueueSearchSync(postId).catch(
      (error) => log.warn({ err: error, postId }, "BullMQ: indexa\xE7\xE3o ficar\xE1 para reconcilia\xE7\xE3o")
    );
  else
    void syncPostToSearchIndex(postId).catch(
      (error) => log.warn({ err: error, postId }, "Sincroniza\xE7\xE3o da busca falhou")
    );
}
async function queuePostSearchRemove(postId, log) {
  if (bullEnabled())
    await enqueueSearchRemove(postId).catch(
      (error) => log.warn({ err: error, postId }, "BullMQ: remo\xE7\xE3o do \xEDndice ficar\xE1 para reconcilia\xE7\xE3o")
    );
  else
    void removePostFromSearchIndex(postId).catch(
      (error) => log.warn({ err: error, postId }, "Remo\xE7\xE3o do \xEDndice falhou")
    );
}
var CMS_BODY_LIMIT = 20 * 1024 * 1024;
var ALLOWED_IFRAME_HOSTS = [
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "player.vimeo.com",
  "player.twitch.tv",
  "clips.twitch.tv",
  "open.spotify.com",
  "w.soundcloud.com",
  "platform.twitter.com",
  "www.instagram.com"
];
var contentRoutes = async (app2) => {
  app2.get("/categories", async (req) => {
    const q = z2.object({ fresh: z2.enum(["1", "true"]).optional() }).parse(req.query);
    if (q.fresh) await delCache("categories");
    const c = await getCache("categories");
    if (c) return c;
    const rows = await prisma.category.findMany({ orderBy: { name: "asc" } });
    await setCache("categories", rows, 3600);
    return rows;
  });
  const SITEMAP_PAGE = 5e3;
  const publishedWhere = () => ({ status: "PUBLISHED", publishedAt: { lte: /* @__PURE__ */ new Date() } });
  app2.get("/sitemap/posts", async (req, reply) => {
    const { page } = z2.object({ page: z2.coerce.number().int().min(1).max(1e3).default(1) }).parse(req.query);
    const [items, total] = await Promise.all([
      prisma.post.findMany({
        where: publishedWhere(),
        select: { slug: true, updatedAt: true, publishedAt: true, coverImageUrl: true, title: true },
        orderBy: { publishedAt: "desc" },
        skip: (page - 1) * SITEMAP_PAGE,
        take: SITEMAP_PAGE
      }),
      prisma.post.count({ where: publishedWhere() })
    ]);
    reply.header("cache-control", "public, max-age=300");
    return { items, total, page, pages: Math.max(1, Math.ceil(total / SITEMAP_PAGE)), pageSize: SITEMAP_PAGE };
  });
  app2.get("/sitemap/news", async (_req, reply) => {
    const items = await prisma.post.findMany({
      where: { status: "PUBLISHED", publishedAt: { lte: /* @__PURE__ */ new Date(), gte: new Date(Date.now() - 2 * 864e5) } },
      select: { slug: true, title: true, publishedAt: true, tags: { select: { tag: { select: { name: true } } } } },
      orderBy: { publishedAt: "desc" },
      take: 1e3
    });
    reply.header("cache-control", "public, max-age=120");
    return { items };
  });
  app2.get("/sitemap/taxonomies", async (_req, reply) => {
    const [categories, tags] = await Promise.all([
      prisma.category.findMany({ select: { slug: true, name: true }, orderBy: { name: "asc" } }),
      prisma.tag.findMany({
        where: { posts: { some: { post: publishedWhere() } } },
        select: { slug: true, name: true },
        orderBy: { name: "asc" },
        take: 5e3
      })
    ]);
    reply.header("cache-control", "public, max-age=600");
    return { categories, tags };
  });
  app2.get("/tags/:slug", async (req, reply) => {
    const { slug } = z2.object({ slug: z2.string().max(120) }).parse(req.params);
    const tag = await prisma.tag.findUnique({ where: { slug }, select: { id: true, name: true, slug: true } });
    if (!tag) return reply.code(404).send({ error: "Tag n\xE3o encontrada" });
    return tag;
  });
  app2.get("/categories/:slug", async (req, reply) => {
    const { slug } = z2.object({ slug: z2.string().max(120) }).parse(req.params);
    const category = await prisma.category.findUnique({ where: { slug } });
    if (!category) return reply.code(404).send({ error: "Categoria n\xE3o encontrada" });
    return category;
  });
  app2.get("/tags", async (req) => {
    const { q } = z2.object({ q: z2.string().optional() }).parse(req.query);
    return prisma.tag.findMany({
      where: q ? { name: { contains: q } } : void 0,
      take: 50,
      orderBy: { name: "asc" }
    });
  });
  app2.get("/posts", async (req) => {
    const q = z2.object({
      page: z2.coerce.number().min(1).default(1),
      limit: z2.coerce.number().min(1).max(50).default(12),
      category: z2.string().max(80).optional(),
      tag: z2.string().max(80).optional(),
      q: z2.string().trim().max(100).optional(),
      sort: z2.enum(["recent", "popular"]).default("recent")
    }).parse(req.query);
    const cacheKey = `posts:${q.page}:${q.limit}:${q.category || ""}:${q.tag || ""}:${q.q || ""}:${q.sort}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;
    const now = /* @__PURE__ */ new Date();
    const where = {
      AND: [
        {
          OR: [
            { status: "PUBLISHED", publishedAt: { lte: now } },
            { status: "SCHEDULED", scheduledAt: { lte: now } }
          ]
        }
      ]
    };
    if (q.category) where.category = { slug: q.category };
    if (q.tag) where.tags = { some: { tag: { slug: q.tag } } };
    if (q.q)
      where.AND.push({
        OR: [
          { title: { contains: q.q } },
          { description: { contains: q.q } }
        ]
      });
    const [items, total] = await prisma.$transaction([
      prisma.post.findMany({
        where,
        select: publicSelect,
        orderBy: q.sort === "popular" ? [{ viewCount: "desc" }, { publishedAt: "desc" }] : [{ publishedAt: "desc" }, { createdAt: "desc" }],
        skip: (q.page - 1) * q.limit,
        take: q.limit
      }),
      prisma.post.count({ where })
    ]);
    const result = { items, total, page: q.page, pages: Math.ceil(total / q.limit) };
    await setCache(cacheKey, result, 60);
    return result;
  });
  app2.get("/posts/:slug", async (req, reply) => {
    const { slug } = z2.object({ slug: z2.string() }).parse(req.params);
    const post = await prisma.post.findUnique({
      where: { slug },
      include: {
        category: true,
        author: { select: { id: true, name: true, username: true, avatarUrl: true, bio: true } },
        tags: { include: { tag: true } },
        aiDraft: { select: { coverImageCredit: true, coverImageSourceUrl: true } },
        _count: { select: { comments: true, favorites: true } }
      }
    });
    if (!post) return reply.code(404).send({ error: "Conte\xFAdo n\xE3o encontrado" });
    const due = post.status === "PUBLISHED" && !!post.publishedAt && post.publishedAt <= /* @__PURE__ */ new Date() || post.status === "SCHEDULED" && !!post.scheduledAt && post.scheduledAt <= /* @__PURE__ */ new Date();
    if (!due) return reply.code(404).send({ error: "Conte\xFAdo n\xE3o encontrado" });
    let viewerId;
    let privileged = false;
    try {
      const payload = await req.jwtVerify();
      viewerId = payload.sub;
      privileged = ["ADMIN", "EDITOR"].includes(payload.role);
      if (!privileged) {
        const subscription = await prisma.subscription.findUnique({
          where: { userId: payload.sub },
          select: { status: true, currentPeriodEnd: true }
        });
        privileged = subscription?.status === "ACTIVE" && (!subscription.currentPeriodEnd || subscription.currentPeriodEnd > /* @__PURE__ */ new Date());
      }
    } catch {
    }
    const premiumLocked = post.isPremium && !privileged;
    return { ...post, content: premiumLocked ? "" : post.content, premiumLocked };
  });
  app2.post("/posts/:id/view", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = z2.object({ id: z2.string().min(1).max(40) }).parse(req.params);
    let userId;
    try {
      const p = await req.jwtVerify();
      userId = p.sub;
    } catch {
    }
    const result = await recordPostView({
      postId: id,
      userId,
      viewer: viewerKey(userId, clientIp(req), String(req.headers["user-agent"] || ""))
    });
    return { ok: true, counted: result.counted };
  });
  app2.get("/posts/:id/comments", async (req) => {
    const { id } = z2.object({ id: z2.string() }).parse(req.params);
    return prisma.comment.findMany({
      where: { postId: id, parentId: null, hiddenAt: null },
      include: {
        user: { select: { id: true, name: true, username: true, avatarUrl: true, level: true } },
        _count: { select: { likes: true } },
        replies: {
          where: { hiddenAt: null },
          include: {
            user: { select: { id: true, name: true, username: true, avatarUrl: true, level: true } },
            _count: { select: { likes: true } }
          },
          orderBy: { createdAt: "asc" }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });
  });
  app2.post(
    "/posts/:id/comments",
    { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      await assertVerifiedEmail(req.authUser.id);
      const { id } = z2.object({ id: z2.string() }).parse(req.params);
      const { content, parentId } = z2.object({ content: z2.string().trim().min(1).max(3e3), parentId: z2.string().optional() }).parse(req.body);
      const post = await prisma.post.findUnique({
        where: { id },
        select: { id: true, authorId: true, title: true, slug: true, status: true }
      });
      if (!post || post.status === "DRAFT" || post.status === "ARCHIVED")
        return reply.code(404).send({ error: "Post n\xE3o encontrado" });
      if (parentId) {
        const parentRow = await prisma.comment.findUnique({
          where: { id: parentId },
          select: { postId: true, parentId: true }
        });
        if (!parentRow || parentRow.postId !== id) return reply.code(400).send({ error: "Coment\xE1rio pai inv\xE1lido" });
      }
      const comment = await prisma.comment.create({
        data: { postId: id, userId: req.authUser.id, parentId, content },
        include: { user: { select: { id: true, name: true, username: true, avatarUrl: true, level: true } } }
      });
      await Promise.all([addXp(req.authUser.id, XP_RULES.COMMENT_CREATED), unlock(req.authUser.id, "FIRST_COMMENT")]);
      let recipient = post.authorId;
      if (parentId) {
        const parent = await prisma.comment.findUnique({ where: { id: parentId }, select: { userId: true } });
        if (parent) recipient = parent.userId;
      }
      await Promise.all([
        notify({
          recipientId: recipient,
          actorId: req.authUser.id,
          type: parentId ? "REPLY" : "COMMENT",
          title: parentId ? "Responderam seu coment\xE1rio" : "Novo coment\xE1rio",
          body: content.slice(0, 140),
          entityType: "news",
          entityId: post.slug
        }).catch(() => void 0),
        notifyFollowersActivity({
          actorId: req.authUser.id,
          title: `${comment.user.name} comentou em uma not\xEDcia`,
          body: `${post.title}: ${content.slice(0, 120)}`,
          entityType: "news",
          entityId: post.slug
        }).catch(() => 0)
      ]);
      return reply.code(201).send(comment);
    }
  );
  app2.post("/comments/:id/like", { preHandler: authenticate }, async (req) => {
    const { id } = z2.object({ id: z2.string() }).parse(req.params);
    const key2 = { commentId_userId: { commentId: id, userId: req.authUser.id } };
    const exists = await prisma.commentLike.findUnique({ where: key2 });
    if (exists) {
      await prisma.commentLike.delete({ where: key2 });
      return { liked: false };
    }
    await prisma.commentLike.create({ data: { commentId: id, userId: req.authUser.id } });
    const [comment, actor] = await Promise.all([
      prisma.comment.findUnique({
        where: { id },
        select: { userId: true, post: { select: { slug: true, title: true } } }
      }),
      prisma.user.findUnique({ where: { id: req.authUser.id }, select: { name: true } })
    ]);
    await Promise.all([
      comment ? notify({
        recipientId: comment.userId,
        actorId: req.authUser.id,
        type: "REACTION",
        title: "Curtiram seu coment\xE1rio",
        entityType: "news",
        entityId: comment.post.slug
      }).catch(() => void 0) : Promise.resolve(),
      notifyFollowersActivity({
        actorId: req.authUser.id,
        title: `${actor?.name || "Algu\xE9m que voc\xEA segue"} curtiu um coment\xE1rio`,
        body: comment?.post.title,
        entityType: comment ? "news" : void 0,
        entityId: comment?.post.slug
      }).catch(() => 0)
    ]);
    return { liked: true };
  });
  app2.post(
    "/comments/:id/report",
    { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const { id } = z2.object({ id: z2.string() }).parse(req.params);
      const body = z2.object({ reason: z2.string().min(3).max(100), details: z2.string().max(1e3).optional() }).parse(req.body);
      try {
        await prisma.commentReport.create({ data: { commentId: id, reporterId: req.authUser.id, ...body } });
        return reply.code(201).send({ ok: true });
      } catch {
        return reply.code(409).send({ error: "Coment\xE1rio j\xE1 denunciado por voc\xEA" });
      }
    }
  );
  app2.post("/favorites/:postId", { preHandler: authenticate }, async (req) => {
    const { postId } = z2.object({ postId: z2.string() }).parse(req.params);
    const key2 = { userId_postId: { userId: req.authUser.id, postId } };
    const exists = await prisma.favorite.findUnique({ where: key2 });
    if (exists) {
      await prisma.favorite.delete({ where: key2 });
      return { favorite: false };
    }
    await prisma.favorite.create({ data: { userId: req.authUser.id, postId } });
    await prisma.userInteraction.create({ data: { userId: req.authUser.id, postId, type: "FAVORITE", weight: 5 } });
    await addXp(req.authUser.id, XP_RULES.FAVORITE_ADDED);
    const count = await prisma.favorite.count({ where: { userId: req.authUser.id } });
    if (count >= 10) await unlock(req.authUser.id, "COLLECTOR");
    return { favorite: true };
  });
  app2.get(
    "/favorites",
    { preHandler: authenticate },
    async (req) => prisma.favorite.findMany({
      where: { userId: req.authUser.id },
      include: { post: { select: publicSelect } },
      orderBy: { createdAt: "desc" }
    })
  );
  const editor = async (req, reply) => requireRole("EDITOR", "ADMIN")(req, reply);
  const postPayloadSchema = z2.object({
    title: z2.string().trim().min(3).max(180),
    slug: z2.string().trim().optional().nullable(),
    description: z2.string().trim().min(10).max(500),
    content: z2.string().min(10),
    coverImageUrl: z2.string().url().refine((v) => /^https?:\/\//i.test(v), "A capa deve usar http(s)").optional().nullable().or(z2.literal("")),
    categoryId: z2.string().min(1),
    tagNames: z2.array(z2.string().trim().min(1).max(60)).default([]),
    status: z2.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
    isPremium: z2.boolean().default(false),
    seoTitle: z2.string().max(180).optional().nullable(),
    seoDescription: z2.string().max(320).optional().nullable(),
    scheduledAt: z2.string().datetime().optional().nullable()
  });
  const sanitizePostHtml = (content) => sanitizeHtml(content, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "h1",
      "h2",
      "h3",
      "figure",
      "figcaption",
      "iframe",
      "span"
    ]),
    // Única classe permitida: marcação de spoiler do editor.
    allowedClasses: { span: ["spoiler"] },
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ["href", "target", "rel"],
      img: ["src", "alt", "title", "loading", "width", "height"],
      iframe: ["src", "title", "allow", "allowfullscreen", "frameborder", "loading", "referrerpolicy"]
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https"], iframe: ["https"] },
    allowedIframeHostnames: ALLOWED_IFRAME_HOSTS,
    allowProtocolRelative: false,
    transformTags: {
      // Links externos nunca recebem acesso a window.opener.
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, ...attribs.target === "_blank" ? { rel: "noopener noreferrer nofollow" } : {} }
      }),
      iframe: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, loading: "lazy", referrerpolicy: "strict-origin-when-cross-origin" }
      })
    }
  });
  async function uniquePostSlug(raw, currentPostId) {
    const base = slugify(raw).slice(0, 120) || `artigo-${Date.now()}`;
    let candidate = base;
    for (let i = 0; i < 50; i++) {
      const row = await prisma.post.findUnique({ where: { slug: candidate }, select: { id: true } });
      if (!row || row.id === currentPostId) return candidate;
      candidate = `${base}-${i + 2}`;
    }
    return `${base}-${Date.now().toString(36)}`;
  }
  function httpError2(message, statusCode, code) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
  }
  function prismaCode(error) {
    return typeof error === "object" && error !== null && "code" in error ? String(error.code ?? "") : "";
  }
  function normalizeTagInputs(tagNames) {
    const normalized = /* @__PURE__ */ new Map();
    for (const raw of tagNames) {
      const name = raw.trim().slice(0, 60);
      const tagSlug = slugify(name);
      if (!name || !tagSlug || normalized.has(tagSlug)) continue;
      normalized.set(tagSlug, name);
    }
    return [...normalized].map(([slug, name]) => ({ slug, name }));
  }
  async function resolveTags(tagNames) {
    const result = [];
    for (const input of normalizeTagInputs(tagNames)) {
      let row = await prisma.tag.findFirst({
        where: { OR: [{ slug: input.slug }, { name: { equals: input.name } }] },
        select: { id: true }
      });
      if (!row) {
        try {
          row = await prisma.tag.create({ data: input, select: { id: true } });
        } catch (error) {
          if (prismaCode(error) !== "P2002") throw error;
          row = await prisma.tag.findFirst({
            where: { OR: [{ slug: input.slug }, { name: { equals: input.name } }] },
            select: { id: true }
          });
          if (!row) throw error;
        }
      }
      result.push(row);
    }
    return result;
  }
  async function assertCmsReferences(categoryId, userId) {
    const [category, author] = await Promise.all([
      prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true } })
    ]);
    if (!category) {
      await delCache("categories");
      throw httpError2(
        "Categoria inv\xE1lida ou desatualizada. Atualize a lista e selecione novamente.",
        400,
        "CATEGORY_STALE"
      );
    }
    if (!author)
      throw httpError2("Sua sess\xE3o n\xE3o corresponde mais a um usu\xE1rio v\xE1lido. Entre novamente.", 401, "STALE_SESSION");
    if (author.status !== "ACTIVE")
      throw httpError2("Este usu\xE1rio n\xE3o est\xE1 ativo e n\xE3o pode salvar conte\xFAdo.", 403, "USER_INACTIVE");
  }
  async function dbWriteWithRetry(work) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await work();
      } catch (error) {
        lastError = error;
        const code = prismaCode(error);
        if (!["P1001", "P1002", "P2024", "P2034", "P2028"].includes(code) || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw lastError;
  }
  const cmsWriteSelect = { id: true, slug: true, status: true, updatedAt: true };
  const cmsListSelect = {
    id: true,
    title: true,
    slug: true,
    description: true,
    coverImageUrl: true,
    status: true,
    isPremium: true,
    publishedAt: true,
    scheduledAt: true,
    createdAt: true,
    updatedAt: true,
    category: { select: { id: true, name: true, slug: true } },
    author: { select: { name: true, username: true } },
    aiDraft: { select: { id: true } }
  };
  async function createCmsPost(b, authorId) {
    if (b.status === "SCHEDULED" && !b.scheduledAt)
      throw httpError2("Informe a data e hora para agendar a publica\xE7\xE3o.", 400, "SCHEDULE_REQUIRED");
    await assertCmsReferences(b.categoryId, authorId);
    const safe = sanitizePostHtml(b.content);
    if (safe.trim().length < 10)
      throw httpError2("O conte\xFAdo ficou vazio ap\xF3s a sanitiza\xE7\xE3o. Revise o HTML do artigo.", 400, "EMPTY_CONTENT");
    const slug = await uniquePostSlug(b.slug?.trim() || b.title);
    const tags = await resolveTags(b.tagNames);
    return dbWriteWithRetry(
      () => prisma.post.create({
        data: {
          title: b.title,
          slug,
          description: b.description,
          content: safe,
          coverImageUrl: b.coverImageUrl || null,
          categoryId: b.categoryId,
          authorId,
          status: b.status,
          isPremium: b.isPremium,
          seoTitle: b.seoTitle?.trim() || null,
          seoDescription: b.seoDescription?.trim() || null,
          publishedAt: b.status === "PUBLISHED" ? /* @__PURE__ */ new Date() : null,
          scheduledAt: b.status === "SCHEDULED" && b.scheduledAt ? new Date(b.scheduledAt) : null,
          tags: tags.length ? { create: tags.map((tag) => ({ tag: { connect: { id: tag.id } } })) } : void 0
        },
        select: cmsWriteSelect
      })
    );
  }
  async function updateCmsPost(id, b, userId) {
    if (b.status === "SCHEDULED" && !b.scheduledAt)
      throw httpError2("Informe a data e hora para agendar a publica\xE7\xE3o.", 400, "SCHEDULE_REQUIRED");
    await assertCmsReferences(b.categoryId, userId);
    const current = await prisma.post.findUnique({
      where: { id },
      select: { id: true, status: true, publishedAt: true }
    });
    if (!current) throw httpError2("Artigo n\xE3o encontrado.", 404, "POST_NOT_FOUND");
    const safe = sanitizePostHtml(b.content);
    if (safe.trim().length < 10)
      throw httpError2("O conte\xFAdo ficou vazio ap\xF3s a sanitiza\xE7\xE3o. Revise o HTML do artigo.", 400, "EMPTY_CONTENT");
    const slug = await uniquePostSlug(b.slug?.trim() || b.title, id);
    const tags = await resolveTags(b.tagNames);
    return dbWriteWithRetry(
      () => prisma.post.update({
        where: { id },
        data: {
          title: b.title,
          slug,
          description: b.description,
          content: safe,
          coverImageUrl: b.coverImageUrl || null,
          categoryId: b.categoryId,
          status: b.status,
          isPremium: b.isPremium,
          seoTitle: b.seoTitle?.trim() || null,
          seoDescription: b.seoDescription?.trim() || null,
          scheduledAt: b.status === "SCHEDULED" && b.scheduledAt ? new Date(b.scheduledAt) : null,
          publishedAt: b.status === "PUBLISHED" ? current.publishedAt ?? /* @__PURE__ */ new Date() : current.publishedAt,
          tags: {
            deleteMany: {},
            ...tags.length ? { create: tags.map((tag) => ({ tag: { connect: { id: tag.id } } })) } : {}
          }
        },
        select: cmsWriteSelect
      })
    );
  }
  app2.get("/admin/cms/categories", { preHandler: editor }, async (_req, reply) => {
    reply.header("cache-control", "no-store");
    return prisma.category.findMany({
      select: { id: true, name: true, slug: true, description: true, icon: true },
      orderBy: { name: "asc" }
    });
  });
  app2.get("/admin/cms/bootstrap", { preHandler: editor }, async (_req, reply) => {
    reply.header("cache-control", "no-store");
    const [categories, posts] = await Promise.all([
      prisma.category.findMany({
        select: { id: true, name: true, slug: true, description: true, icon: true },
        orderBy: { name: "asc" }
      }),
      // A listagem nunca devolve o HTML completo do artigo. Antes, dois artigos
      // grandes já eram suficientes para disparar compressão e tornar o payload
      // desnecessariamente pesado no CMS.
      prisma.post.findMany({ select: cmsListSelect, orderBy: { updatedAt: "desc" } })
    ]);
    return { categories, posts, totals: { categories: categories.length, posts: posts.length } };
  });
  app2.get("/admin/cms/diagnostics", { preHandler: editor }, async (_req, reply) => {
    reply.header("cache-control", "no-store");
    const [posts, categories, users] = await Promise.all([
      prisma.post.count(),
      prisma.category.count(),
      prisma.user.count()
    ]);
    return {
      ok: true,
      database: "postgresql",
      orm: "prisma",
      counts: { posts, categories, users },
      time: (/* @__PURE__ */ new Date()).toISOString()
    };
  });
  app2.get("/admin/posts", { preHandler: editor }, async (req, reply) => {
    reply.header("cache-control", "no-store");
    const q = z2.object({ status: z2.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).optional() }).parse(req.query);
    return prisma.post.findMany({
      where: q.status ? { status: q.status } : void 0,
      select: cmsListSelect,
      orderBy: { updatedAt: "desc" }
    });
  });
  app2.get("/admin/posts/:id", { preHandler: editor }, async (req, reply) => {
    const { id } = z2.object({ id: z2.string() }).parse(req.params);
    const post = await prisma.post.findUnique({
      where: { id },
      include: {
        category: true,
        author: { select: { name: true, username: true } },
        tags: { include: { tag: true } },
        aiDraft: {
          include: {
            sources: { select: { id: true, title: true, url: true, publisher: true } },
            job: { select: { id: true, model: true, query: true, timeRange: true, createdAt: true } }
          }
        }
      }
    });
    if (!post) return reply.code(404).send({ error: "Artigo n\xE3o encontrado" });
    return post;
  });
  app2.post("/admin/posts", { preHandler: editor, bodyLimit: CMS_BODY_LIMIT }, async (req, reply) => {
    const b = postPayloadSchema.parse(req.body);
    req.log.info(
      {
        userId: req.authUser.id,
        categoryId: b.categoryId,
        titleLength: b.title.length,
        contentLength: b.content.length,
        tagCount: b.tagNames.length,
        status: b.status
      },
      "Salvando novo artigo no CMS"
    );
    const post = await createCmsPost(b, req.authUser.id);
    await delCache("posts:*");
    if (post.status === "PUBLISHED") await queuePostPublished(post.id, req.log);
    else await queuePostSearchSync(post.id, req.log);
    req.log.info({ postId: post.id, slug: post.slug }, "Artigo salvo com sucesso");
    return reply.code(201).send({ id: post.id, slug: post.slug, status: post.status, updatedAt: post.updatedAt });
  });
  const updatePostHandler = async (req, reply) => {
    const { id } = z2.object({ id: z2.string() }).parse(req.params);
    const b = postPayloadSchema.parse(req.body);
    req.log.info(
      {
        postId: id,
        userId: req.authUser.id,
        categoryId: b.categoryId,
        contentLength: b.content.length,
        tagCount: b.tagNames.length,
        status: b.status
      },
      "Atualizando artigo no CMS"
    );
    const before = await prisma.post.findUnique({ where: { id }, select: { publishedAt: true } });
    const post = await updateCmsPost(id, b, req.authUser.id);
    await delCache("posts:*");
    if (!before?.publishedAt && post.status === "PUBLISHED") await queuePostPublished(post.id, req.log);
    else await queuePostSearchSync(post.id, req.log);
    req.log.info({ postId: post.id, slug: post.slug }, "Artigo atualizado com sucesso");
    return reply.send({ id: post.id, slug: post.slug, status: post.status, updatedAt: post.updatedAt });
  };
  app2.put("/admin/posts/:id", { preHandler: editor, bodyLimit: CMS_BODY_LIMIT }, updatePostHandler);
  app2.post("/admin/posts/:id/save", { preHandler: editor, bodyLimit: CMS_BODY_LIMIT }, updatePostHandler);
  app2.delete("/admin/posts/:id", { preHandler: editor }, async (req, reply) => {
    const { id } = z2.object({ id: z2.string() }).parse(req.params);
    await prisma.post.delete({ where: { id } });
    await delCache("posts:*");
    await queuePostSearchRemove(id, req.log);
    return reply.code(204).send();
  });
};
var content_default = contentRoutes;

// src/routes/users.ts
import { z as z3 } from "zod";

// src/lib/managed-upload.ts
function isManagedUploadUrl(value, allowedPurposes = []) {
  if (!value) return true;
  try {
    const target = new URL(value);
    const allowedOrigins2 = /* @__PURE__ */ new Set([new URL(env.ASSET_BASE_URL).origin, new URL(env.PUBLIC_WEB_URL).origin]);
    if (!allowedOrigins2.has(target.origin) || !target.pathname.startsWith("/uploads/")) return false;
    if (!allowedPurposes.length) return true;
    const filename = target.pathname.split("/").pop() || "";
    return allowedPurposes.some((purpose) => filename.startsWith(`${purpose}-`));
  } catch {
    return false;
  }
}

// src/routes/users.ts
var usersRoutes = async (app2) => {
  app2.get(
    "/me",
    { preHandler: authenticate },
    async (req) => prisma.user.findUnique({
      where: { id: req.authUser.id },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        avatarUrl: true,
        bio: true,
        level: true,
        xp: true,
        role: true,
        emailVerifiedAt: true,
        createdAt: true,
        subscription: true,
        totpEnabledAt: true,
        moderationReputation: true,
        _count: { select: { followers: true, following: true, favorites: true, comments: true } }
      }
    }).then((user) => {
      if (!user) return user;
      const { totpEnabledAt, ...rest } = user;
      const premium = user.subscription?.status === "ACTIVE" && (!user.subscription.currentPeriodEnd || user.subscription.currentPeriodEnd > /* @__PURE__ */ new Date());
      return { ...rest, mfaEnabled: Boolean(totpEnabledAt), isPremium: premium };
    })
  );
  app2.patch("/me", { preHandler: authenticate }, async (req, reply) => {
    const b = z3.object({
      name: z3.string().trim().min(2).max(100).optional(),
      bio: z3.string().max(600).optional().nullable(),
      avatarUrl: z3.string().url().optional().nullable()
    }).parse(req.body);
    if (b.avatarUrl !== void 0 && !isManagedUploadUrl(b.avatarUrl, ["avatar"]))
      return reply.code(400).send({ error: "O avatar deve ser enviado pelo upload seguro do Hypeverso." });
    return prisma.user.update({
      where: { id: req.authUser.id },
      data: b,
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        avatarUrl: true,
        bio: true,
        level: true,
        xp: true,
        role: true
      }
    });
  });
  app2.get("/me/news-preferences", { preHandler: authenticate }, async (req) => {
    const [categories, selected] = await Promise.all([
      prisma.category.findMany({ select: { id: true, name: true, slug: true, icon: true }, orderBy: { name: "asc" } }),
      prisma.userNewsCategoryPreference.findMany({ where: { userId: req.authUser.id }, select: { categoryId: true } })
    ]);
    const selectedIds = new Set(selected.map((row) => row.categoryId));
    return {
      categories: categories.map((c) => ({ ...c, enabled: selectedIds.has(c.id) })),
      selectedCategoryIds: [...selectedIds]
    };
  });
  app2.put("/me/news-preferences", { preHandler: authenticate }, async (req) => {
    const { categoryIds } = z3.object({ categoryIds: z3.array(z3.string()).max(100) }).parse(req.body);
    const unique = [...new Set(categoryIds)];
    if (unique.length) {
      const valid = await prisma.category.count({ where: { id: { in: unique } } });
      if (valid !== unique.length) {
        const error = new Error("Uma ou mais categorias selecionadas n\xE3o existem.");
        error.statusCode = 400;
        throw error;
      }
    }
    await prisma.$transaction([
      prisma.userNewsCategoryPreference.deleteMany({ where: { userId: req.authUser.id } }),
      ...unique.length ? [
        prisma.userNewsCategoryPreference.createMany({
          data: unique.map((categoryId) => ({ userId: req.authUser.id, categoryId }))
        })
      ] : []
    ]);
    return { ok: true, selectedCategoryIds: unique };
  });
  app2.get(
    "/me/export",
    { preHandler: authenticate, config: { rateLimit: { max: 3, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const id = req.authUser.id;
      const data = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          avatarUrl: true,
          bio: true,
          level: true,
          xp: true,
          role: true,
          status: true,
          emailVerifiedAt: true,
          termsAcceptedAt: true,
          termsVersion: true,
          createdAt: true,
          updatedAt: true,
          subscription: { select: { status: true, currentPeriodEnd: true, createdAt: true } },
          comments: { select: { id: true, postId: true, content: true, createdAt: true } },
          communityPosts: { select: { id: true, content: true, imageUrl: true, createdAt: true } },
          communityComments: { select: { id: true, communityPostId: true, content: true, createdAt: true } },
          favorites: { select: { postId: true, createdAt: true } },
          library: {
            select: {
              externalId: true,
              title: true,
              mediaType: true,
              status: true,
              notes: true,
              rating: true,
              createdAt: true
            }
          },
          following: { select: { followingId: true, createdAt: true } },
          searchHistory: { select: { query: true, createdAt: true } },
          newsPreferences: { select: { categoryId: true } },
          achievements: { select: { achievement: { select: { name: true } }, unlockedAt: true } }
        }
      });
      reply.header("cache-control", "no-store");
      reply.header(
        "content-disposition",
        `attachment; filename="hypeverso-meus-dados-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json"`
      );
      return { exportedAt: (/* @__PURE__ */ new Date()).toISOString(), data };
    }
  );
  app2.delete(
    "/me",
    { preHandler: authenticate, config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const { password, confirm } = z3.object({ password: z3.string().min(1).max(128), confirm: z3.literal("EXCLUIR") }).parse(req.body);
      const user = await prisma.user.findUnique({
        where: { id: req.authUser.id },
        select: {
          id: true,
          passwordHash: true,
          subscription: { select: { status: true } },
          _count: { select: { posts: true } }
        }
      });
      if (!user) return reply.code(404).send({ error: "Usu\xE1rio n\xE3o encontrado" });
      if (!await verifyPassword(user.passwordHash, password))
        return reply.code(403).send({ error: "Senha incorreta" });
      if (user.subscription?.status === "ACTIVE" || user.subscription?.status === "PAST_DUE")
        return reply.code(409).send({ error: "Cancele a assinatura Premium antes de excluir a conta." });
      if (user._count.posts > 0)
        return reply.code(409).send({
          error: "Contas com artigos publicados precisam ser removidas por um administrador (os artigos devem ser transferidos antes)."
        });
      await prisma.user.delete({ where: { id: user.id } });
      clearAuthCookies(reply);
      return reply.code(204).send();
    }
  );
  app2.get(
    "/rankings",
    async () => prisma.user.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        username: true,
        avatarUrl: true,
        level: true,
        xp: true,
        achievements: { select: { achievement: { select: { name: true, icon: true } } } }
      },
      orderBy: [{ xp: "desc" }, { createdAt: "asc" }],
      take: 100
    })
  );
  app2.get(
    "/me/history",
    { preHandler: authenticate },
    async (req) => prisma.userInteraction.findMany({
      where: { userId: req.authUser.id, type: "VIEW" },
      distinct: ["postId"],
      include: {
        post: {
          select: {
            id: true,
            title: true,
            slug: true,
            description: true,
            coverImageUrl: true,
            category: { select: { name: true, slug: true } }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 50
    })
  );
  app2.get("/users/:username", async (req, reply) => {
    const { username } = z3.object({ username: z3.string() }).parse(req.params);
    const u = await prisma.user.findFirst({
      where: { username, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        username: true,
        avatarUrl: true,
        bio: true,
        level: true,
        xp: true,
        createdAt: true,
        _count: { select: { followers: true, following: true, comments: true, favorites: true } },
        achievements: { include: { achievement: true } },
        communityPosts: {
          take: 10,
          orderBy: { createdAt: "desc" },
          include: { _count: { select: { comments: true, reactions: true } } }
        },
        subscription: { select: { status: true } }
      }
    });
    if (!u) return reply.code(404).send({ error: "Usu\xE1rio n\xE3o encontrado" });
    return u;
  });
  app2.get("/users/:id/follow-status", { preHandler: authenticate }, async (req) => {
    const { id } = z3.object({ id: z3.string() }).parse(req.params);
    if (id === req.authUser.id) return { following: false, self: true };
    const row = await prisma.userFollow.findUnique({
      where: { followerId_followingId: { followerId: req.authUser.id, followingId: id } },
      select: { followerId: true }
    });
    return { following: !!row, self: false };
  });
  app2.post(
    "/users/:id/follow",
    { preHandler: authenticate, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { id } = z3.object({ id: z3.string() }).parse(req.params);
      if (id === req.authUser.id) return reply.code(400).send({ error: "Voc\xEA n\xE3o pode seguir a si mesmo" });
      const target = await prisma.user.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!target || target.status !== "ACTIVE") return reply.code(404).send({ error: "Usu\xE1rio n\xE3o encontrado" });
      const key2 = { followerId_followingId: { followerId: req.authUser.id, followingId: id } };
      const existing = await prisma.userFollow.findUnique({ where: key2 });
      if (existing) {
        await prisma.userFollow.delete({ where: key2 });
        return { following: false };
      }
      await prisma.userFollow.create({ data: { followerId: req.authUser.id, followingId: id } });
      await notify({
        recipientId: id,
        actorId: req.authUser.id,
        type: "FOLLOW",
        title: "Novo seguidor",
        entityType: "user",
        entityId: req.authUser.id
      }).catch(() => void 0);
      return { following: true };
    }
  );
  app2.get(
    "/notifications",
    { preHandler: authenticate },
    async (req) => prisma.notification.findMany({
      where: { recipientId: req.authUser.id },
      include: { actor: { select: { id: true, name: true, username: true, avatarUrl: true } } },
      take: 100,
      orderBy: { createdAt: "desc" }
    })
  );
  app2.get("/notifications/unread-count", { preHandler: authenticate }, async (req) => ({
    count: await prisma.notification.count({ where: { recipientId: req.authUser.id, readAt: null } })
  }));
  app2.post("/notifications/read", { preHandler: authenticate }, async (req) => {
    const { ids } = z3.object({ ids: z3.array(z3.string()).max(200).optional() }).parse(req.body ?? {});
    await prisma.notification.updateMany({
      where: { recipientId: req.authUser.id, ...ids?.length ? { id: { in: ids } } : { readAt: null } },
      data: { readAt: /* @__PURE__ */ new Date() }
    });
    return { ok: true };
  });
};
var users_default = usersRoutes;

// src/routes/community.ts
import { z as z4 } from "zod";
var REACTIONS = ["LIKE", "LOVE", "HAHA", "WOW", "SAD", "ANGRY", "FIRE"];
var communityRoutes = async (app2) => {
  app2.get("/community/feed", async (req) => {
    const q = z4.object({ cursor: z4.string().optional(), limit: z4.coerce.number().min(1).max(30).default(15) }).parse(req.query);
    const items = await prisma.communityPost.findMany({
      take: q.limit + 1,
      ...q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {},
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, name: true, username: true, avatarUrl: true, level: true } },
        _count: { select: { comments: true, reactions: true } },
        reactions: { take: 5, select: { kind: true, userId: true } }
      }
    });
    const hasMore = items.length > q.limit;
    if (hasMore) items.pop();
    let viewerId;
    try {
      const payload = await req.jwtVerify();
      viewerId = payload.sub;
    } catch {
    }
    let following = /* @__PURE__ */ new Set();
    if (viewerId) {
      const userIds = [...new Set(items.map((p) => p.userId).filter((id) => id !== viewerId))];
      if (userIds.length) {
        const rows = await prisma.userFollow.findMany({
          where: { followerId: viewerId, followingId: { in: userIds } },
          select: { followingId: true }
        });
        following = new Set(rows.map((r) => r.followingId));
      }
    }
    return {
      items: items.map((item) => ({ ...item, viewerFollowing: following.has(item.userId) })),
      nextCursor: hasMore ? items.at(-1)?.id : null
    };
  });
  app2.post(
    "/community/posts",
    { preHandler: authenticate, config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    async (req, reply) => {
      await assertVerifiedEmail(req.authUser.id);
      const b = z4.object({ content: z4.string().trim().min(1).max(5e3), imageUrl: z4.string().url().optional().nullable() }).parse(req.body);
      if (b.imageUrl && !isManagedUploadUrl(b.imageUrl, ["community"]))
        return reply.code(400).send({ error: "A imagem deve ser enviada pelo upload seguro do Hypeverso." });
      const post = await prisma.communityPost.create({
        data: { userId: req.authUser.id, content: b.content, imageUrl: b.imageUrl || null },
        include: {
          user: { select: { id: true, name: true, username: true, avatarUrl: true, level: true } },
          _count: { select: { comments: true, reactions: true } }
        }
      });
      await Promise.all([
        addXp(req.authUser.id, XP_RULES.COMMUNITY_POST_CREATED),
        unlock(req.authUser.id, "FIRST_POST"),
        notifyFollowersActivity({
          actorId: req.authUser.id,
          title: `${post.user.name} publicou na comunidade`,
          body: b.content.slice(0, 160),
          entityType: "communityPost",
          entityId: post.id
        }).catch(() => 0)
      ]);
      return reply.code(201).send({ ...post, viewerFollowing: false });
    }
  );
  app2.delete("/community/posts/:id", { preHandler: authenticate }, async (req, reply) => {
    const { id } = z4.object({ id: z4.string() }).parse(req.params);
    const post = await prisma.communityPost.findUnique({ where: { id } });
    if (!post) return reply.code(404).send({ error: "Publica\xE7\xE3o n\xE3o encontrada" });
    if (post.userId !== req.authUser.id && req.authUser.role !== "ADMIN" && req.authUser.role !== "MODERATOR")
      return reply.code(403).send({ error: "Acesso negado" });
    await prisma.communityPost.delete({ where: { id } });
    return reply.code(204).send();
  });
  app2.post(
    "/community/posts/:id/react",
    { preHandler: authenticate, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { id } = z4.object({ id: z4.string() }).parse(req.params);
      const { kind } = z4.object({ kind: z4.enum(REACTIONS).default("LIKE") }).parse(req.body ?? {});
      if (!await prisma.communityPost.findUnique({ where: { id }, select: { id: true } }))
        return reply.code(404).send({ error: "Publica\xE7\xE3o n\xE3o encontrada" });
      const key2 = { communityPostId_userId: { communityPostId: id, userId: req.authUser.id } };
      const existing = await prisma.communityReaction.findUnique({ where: key2 });
      if (existing) {
        if (existing.kind === kind) {
          await prisma.communityReaction.delete({ where: key2 });
          return { reacted: false };
        }
        await prisma.communityReaction.update({ where: key2, data: { kind } });
      } else await prisma.communityReaction.create({ data: { communityPostId: id, userId: req.authUser.id, kind } });
      const [post, actor] = await Promise.all([
        prisma.communityPost.findUnique({ where: { id }, select: { userId: true } }),
        prisma.user.findUnique({ where: { id: req.authUser.id }, select: { name: true } })
      ]);
      await Promise.all([
        post ? notify({
          recipientId: post.userId,
          actorId: req.authUser.id,
          type: "REACTION",
          title: "Reagiram \xE0 sua publica\xE7\xE3o",
          entityType: "communityPost",
          entityId: id
        }).catch(() => void 0) : Promise.resolve(),
        notifyFollowersActivity({
          actorId: req.authUser.id,
          title: `${actor?.name || "Algu\xE9m que voc\xEA segue"} reagiu a uma publica\xE7\xE3o`,
          entityType: "communityPost",
          entityId: id
        }).catch(() => 0)
      ]);
      return { reacted: true, kind };
    }
  );
  app2.get("/community/posts/:id/comments", async (req) => {
    const { id } = z4.object({ id: z4.string() }).parse(req.params);
    return prisma.communityComment.findMany({
      take: 200,
      where: { communityPostId: id },
      include: { user: { select: { id: true, name: true, username: true, avatarUrl: true, level: true } } },
      orderBy: { createdAt: "asc" }
    });
  });
  app2.post(
    "/community/posts/:id/comments",
    { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      await assertVerifiedEmail(req.authUser.id);
      const { id } = z4.object({ id: z4.string() }).parse(req.params);
      const { content } = z4.object({ content: z4.string().trim().min(1).max(2e3) }).parse(req.body);
      const c = await prisma.communityComment.create({
        data: { communityPostId: id, userId: req.authUser.id, content },
        include: { user: { select: { id: true, name: true, username: true, avatarUrl: true, level: true } } }
      });
      const post = await prisma.communityPost.findUnique({ where: { id }, select: { userId: true } });
      await Promise.all([
        post ? notify({
          recipientId: post.userId,
          actorId: req.authUser.id,
          type: "COMMENT",
          title: "Novo coment\xE1rio na comunidade",
          body: content.slice(0, 140),
          entityType: "communityPost",
          entityId: id
        }).catch(() => void 0) : Promise.resolve(),
        notifyFollowersActivity({
          actorId: req.authUser.id,
          title: `${c.user.name} comentou na comunidade`,
          body: content.slice(0, 160),
          entityType: "communityPost",
          entityId: id
        }).catch(() => 0)
      ]);
      return reply.code(201).send(c);
    }
  );
};
var community_default = communityRoutes;

// src/routes/library.ts
import { z as z5 } from "zod";

// src/services/media-catalog.ts
var mediaTypes = ["MOVIE", "SERIES", "GAME", "ANIME", "MANGA", "COMIC"];
var compact = (value) => value?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;
var tmdbImage = (path2, size = "w500") => path2 ? `https://image.tmdb.org/t/p/${size}${path2}` : null;
var igdbImage = (imageId, size = "t_cover_big") => imageId ? `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg` : null;
var dateFromParts = (year, month, day) => year ? `${String(year).padStart(4, "0")}-${String(month || 1).padStart(2, "0")}-${String(day || 1).padStart(2, "0")}` : null;
async function requestJson(url, init = {}, timeoutMs = 15e3) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} em ${new URL(url).hostname}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
function tmdbHeaders() {
  return env.TMDB_READ_TOKEN ? { Authorization: `Bearer ${env.TMDB_READ_TOKEN}`, Accept: "application/json" } : null;
}
async function searchTmdb(query, type) {
  const headers = tmdbHeaders();
  if (!headers) return [];
  const endpoint = type === "MOVIE" ? "movie" : "tv";
  const url = new URL(`https://api.themoviedb.org/3/search/${endpoint}`);
  url.searchParams.set("query", query);
  url.searchParams.set("include_adult", "false");
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("page", "1");
  const data = await requestJson(url.toString(), { headers });
  return (data.results || []).slice(0, 8).map((row) => ({
    provider: "TMDB",
    externalId: String(row.id),
    mediaType: type,
    title: String(type === "MOVIE" ? row.title : row.name || ""),
    originalTitle: type === "MOVIE" ? row.original_title : row.original_name,
    description: compact(row.overview),
    coverUrl: tmdbImage(row.poster_path),
    backdropUrl: tmdbImage(row.backdrop_path, "w780"),
    releaseDate: type === "MOVIE" ? row.release_date : row.first_air_date,
    genres: [],
    rating: typeof row.vote_average === "number" ? row.vote_average : null,
    sourceUrl: `https://www.themoviedb.org/${endpoint}/${row.id}`,
    metadata: { popularity: row.popularity, originalLanguage: row.original_language }
  }));
}
async function detailTmdb(id, type) {
  const headers = tmdbHeaders();
  if (!headers) return null;
  const endpoint = type === "MOVIE" ? "movie" : "tv";
  const url = new URL(`https://api.themoviedb.org/3/${endpoint}/${encodeURIComponent(id)}`);
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("append_to_response", "videos,credits");
  const row = await requestJson(url.toString(), { headers });
  const trailer = (row.videos?.results || []).find((v) => v.site === "YouTube" && v.type === "Trailer") || (row.videos?.results || []).find((v) => v.site === "YouTube");
  const cast = (row.credits?.cast || []).slice(0, 8).map((p) => ({
    id: p.id,
    name: p.name,
    character: p.character,
    profileUrl: tmdbImage(p.profile_path, "w185")
  }));
  const crew = (row.credits?.crew || []).filter((p) => ["Director", "Creator", "Executive Producer"].includes(p.job)).slice(0, 8).map((p) => ({ id: p.id, name: p.name, job: p.job }));
  return {
    provider: "TMDB",
    externalId: String(row.id),
    mediaType: type,
    title: String(type === "MOVIE" ? row.title : row.name || ""),
    originalTitle: type === "MOVIE" ? row.original_title : row.original_name,
    description: compact(row.overview),
    coverUrl: tmdbImage(row.poster_path),
    backdropUrl: tmdbImage(row.backdrop_path, "w1280"),
    releaseDate: type === "MOVIE" ? row.release_date : row.first_air_date,
    genres: (row.genres || []).map((g) => g.name).filter(Boolean),
    rating: typeof row.vote_average === "number" ? row.vote_average : null,
    sourceUrl: `https://www.themoviedb.org/${endpoint}/${row.id}`,
    trailerUrl: trailer?.key ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
    metadata: {
      runtime: row.runtime,
      episodeRunTime: row.episode_run_time,
      numberOfSeasons: row.number_of_seasons,
      numberOfEpisodes: row.number_of_episodes,
      status: row.status,
      tagline: row.tagline,
      cast,
      crew,
      originalLanguage: row.original_language
    }
  };
}
var ANILIST_QUERY = `query ($search:String!,$type:MediaType!){
  Page(page:1,perPage:8){media(search:$search,type:$type,isAdult:false,sort:SEARCH_MATCH){
    id title{romaji english native} description(asHtml:false) coverImage{extraLarge large} bannerImage
    startDate{year month day} genres averageScore episodes chapters volumes format status siteUrl
    trailer{id site thumbnail}
  }}
}`;
var ANILIST_DETAIL = `query ($id:Int!,$type:MediaType!){Media(id:$id,type:$type){
  id title{romaji english native} description(asHtml:false) coverImage{extraLarge large} bannerImage
  startDate{year month day} endDate{year month day} genres averageScore episodes chapters volumes format status siteUrl
  trailer{id site thumbnail} studios{nodes{name isAnimationStudio}} tags{name rank isMediaSpoiler}
}}`;
function normalizeAniList(row, type) {
  const title = row.title?.english || row.title?.romaji || row.title?.native || `AniList ${row.id}`;
  const trailer = row.trailer?.site === "youtube" && row.trailer?.id ? `https://www.youtube.com/watch?v=${row.trailer.id}` : null;
  return {
    provider: "ANILIST",
    externalId: String(row.id),
    mediaType: type,
    title,
    originalTitle: row.title?.romaji || row.title?.native || null,
    description: compact(row.description),
    coverUrl: row.coverImage?.extraLarge || row.coverImage?.large || null,
    backdropUrl: row.bannerImage || null,
    releaseDate: dateFromParts(row.startDate?.year, row.startDate?.month, row.startDate?.day),
    genres: (row.genres || []).filter(Boolean),
    rating: typeof row.averageScore === "number" ? row.averageScore / 10 : null,
    sourceUrl: row.siteUrl || `https://anilist.co/${type === "ANIME" ? "anime" : "manga"}/${row.id}`,
    trailerUrl: trailer,
    metadata: {
      episodes: row.episodes,
      chapters: row.chapters,
      volumes: row.volumes,
      format: row.format,
      status: row.status,
      studios: row.studios?.nodes,
      tags: (row.tags || []).filter((t) => !t.isMediaSpoiler && t.rank >= 60).slice(0, 10).map((t) => t.name),
      endDate: dateFromParts(row.endDate?.year, row.endDate?.month, row.endDate?.day)
    }
  };
}
async function anilistRequest(query, variables) {
  return requestJson(
    "https://graphql.anilist.co",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables })
    },
    18e3
  );
}
async function searchAniList(query, type) {
  const data = await anilistRequest(ANILIST_QUERY, { search: query, type });
  return (data.data?.Page?.media || []).map((row) => normalizeAniList(row, type));
}
async function detailAniList(id, type) {
  const numeric = Number(id);
  if (!Number.isFinite(numeric)) return null;
  const data = await anilistRequest(ANILIST_DETAIL, { id: numeric, type });
  return data.data?.Media ? normalizeAniList(data.data.Media, type) : null;
}
var igdbToken = null;
async function getIgdbToken() {
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) return null;
  if (igdbToken && igdbToken.expiresAt > Date.now() + 6e4) return igdbToken.value;
  const url = new URL("https://id.twitch.tv/oauth2/token");
  url.searchParams.set("client_id", env.IGDB_CLIENT_ID);
  url.searchParams.set("client_secret", env.IGDB_CLIENT_SECRET);
  url.searchParams.set("grant_type", "client_credentials");
  const data = await requestJson(url.toString(), { method: "POST" }, 15e3);
  igdbToken = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 120) * 1e3
  };
  return igdbToken.value;
}
async function igdbRequest(body) {
  const token = await getIgdbToken();
  if (!token) return [];
  return requestJson(
    "https://api.igdb.com/v4/games",
    {
      method: "POST",
      headers: { "Client-ID": env.IGDB_CLIENT_ID, Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
      body
    },
    18e3
  );
}
function normalizeIgdb(row) {
  const video = (row.videos || [])[0]?.video_id;
  return {
    provider: "IGDB",
    externalId: String(row.id),
    mediaType: "GAME",
    title: row.name || `Game ${row.id}`,
    originalTitle: row.name || null,
    description: compact(row.summary || row.storyline),
    coverUrl: igdbImage(row.cover?.image_id),
    backdropUrl: igdbImage(row.artworks?.[0]?.image_id, "t_1080p"),
    releaseDate: row.first_release_date ? new Date(row.first_release_date * 1e3).toISOString().slice(0, 10) : null,
    genres: (row.genres || []).map((g) => g.name).filter(Boolean),
    rating: typeof row.rating === "number" ? row.rating / 10 : null,
    sourceUrl: row.url || `https://www.igdb.com/games/${row.slug || row.id}`,
    trailerUrl: video ? `https://www.youtube.com/watch?v=${video}` : null,
    metadata: {
      platforms: (row.platforms || []).map((p) => p.name),
      companies: (row.involved_companies || []).map((c) => c.company?.name).filter(Boolean),
      slug: row.slug
    }
  };
}
async function searchIgdb(query) {
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) return [];
  const safe = query.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const rows = await igdbRequest(
    `search "${safe}"; fields name,summary,storyline,slug,url,cover.image_id,first_release_date,genres.name,rating,platforms.name,videos.video_id,artworks.image_id,involved_companies.company.name; limit 8;`
  );
  return rows.map(normalizeIgdb);
}
async function detailIgdb(id) {
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) return null;
  const numeric = Number(id);
  if (!Number.isFinite(numeric)) return null;
  const rows = await igdbRequest(
    `fields name,summary,storyline,slug,url,cover.image_id,first_release_date,genres.name,rating,platforms.name,videos.video_id,artworks.image_id,involved_companies.company.name,involved_companies.developer,involved_companies.publisher; where id = ${numeric}; limit 1;`
  );
  return rows[0] ? normalizeIgdb(rows[0]) : null;
}
function providerAvailability() {
  return {
    TMDB: Boolean(env.TMDB_READ_TOKEN),
    ANILIST: true,
    IGDB: Boolean(env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET)
  };
}
async function searchCatalog(query, type) {
  const normalized = query.trim();
  const cacheKey = `catalog:search:${type || "ALL"}:${normalized.toLowerCase()}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;
  const localRows = await prisma.mediaCatalogItem.findMany({
    where: { title: { contains: normalized }, ...type ? { mediaType: type } : {} },
    orderBy: { updatedAt: "desc" },
    take: 8
  }).catch(() => []);
  const localItems = localRows.map((row) => ({
    provider: row.provider,
    externalId: row.externalId,
    mediaType: row.mediaType,
    title: row.title,
    originalTitle: row.originalTitle,
    description: row.description,
    coverUrl: row.coverUrl,
    backdropUrl: row.backdropUrl,
    releaseDate: row.releaseDate ? row.releaseDate.toISOString().slice(0, 10) : null,
    genres: Array.isArray(row.genres) ? row.genres : [],
    rating: row.rating,
    sourceUrl: row.sourceUrl,
    trailerUrl: row.trailerUrl,
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {}
  }));
  const tasks = [];
  if ((!type || type === "MOVIE") && env.TMDB_READ_TOKEN) tasks.push(searchTmdb(normalized, "MOVIE"));
  if ((!type || type === "SERIES") && env.TMDB_READ_TOKEN) tasks.push(searchTmdb(normalized, "SERIES"));
  if (!type || type === "ANIME") tasks.push(searchAniList(normalized, "ANIME"));
  if (!type || type === "MANGA") tasks.push(searchAniList(normalized, "MANGA"));
  if ((!type || type === "GAME") && env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET) tasks.push(searchIgdb(normalized));
  const settled = await Promise.allSettled(tasks);
  const external = settled.flatMap((r) => r.status === "fulfilled" ? r.value : []).filter((i) => i.title);
  const seen = /* @__PURE__ */ new Set();
  const items = [...localItems, ...external].filter((item) => {
    const key2 = `${item.provider}:${item.mediaType}:${item.externalId}`;
    if (seen.has(key2)) return false;
    seen.add(key2);
    return true;
  }).slice(0, 24);
  await setCache(cacheKey, items, 600);
  return items;
}
async function getCatalogDetails(provider, type, externalId) {
  const cacheKey = `catalog:detail:${provider}:${type}:${externalId}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;
  const local = await prisma.mediaCatalogItem.findUnique({ where: { provider_externalId_mediaType: { provider, externalId, mediaType: type } } }).catch(() => null);
  if (local) {
    const localItem = {
      provider: local.provider,
      externalId: local.externalId,
      mediaType: local.mediaType,
      title: local.title,
      originalTitle: local.originalTitle,
      description: local.description,
      coverUrl: local.coverUrl,
      backdropUrl: local.backdropUrl,
      releaseDate: local.releaseDate ? local.releaseDate.toISOString().slice(0, 10) : null,
      genres: Array.isArray(local.genres) ? local.genres : [],
      rating: local.rating,
      sourceUrl: local.sourceUrl,
      trailerUrl: local.trailerUrl,
      metadata: local.metadata && typeof local.metadata === "object" ? local.metadata : {}
    };
    await setCache(cacheKey, localItem, env.MEDIA_CATALOG_CACHE_HOURS * 3600);
    return localItem;
  }
  let item = null;
  if (provider === "TMDB" && (type === "MOVIE" || type === "SERIES")) item = await detailTmdb(externalId, type);
  else if (provider === "ANILIST" && (type === "ANIME" || type === "MANGA"))
    item = await detailAniList(externalId, type);
  else if (provider === "IGDB" && type === "GAME") item = await detailIgdb(externalId);
  if (item) await setCache(cacheKey, item, env.MEDIA_CATALOG_CACHE_HOURS * 3600);
  return item;
}
async function cacheCatalogItem(item) {
  const releaseDate = item.releaseDate && /^\d{4}-\d{2}-\d{2}/.test(item.releaseDate) ? /* @__PURE__ */ new Date(`${item.releaseDate.slice(0, 10)}T00:00:00.000Z`) : null;
  return prisma.mediaCatalogItem.upsert({
    where: {
      provider_externalId_mediaType: {
        provider: item.provider,
        externalId: item.externalId,
        mediaType: item.mediaType
      }
    },
    update: {
      title: item.title,
      originalTitle: item.originalTitle || null,
      slug: slugify(item.title),
      description: item.description || null,
      coverUrl: item.coverUrl || null,
      backdropUrl: item.backdropUrl || null,
      releaseDate,
      genres: item.genres,
      sourceUrl: item.sourceUrl || null,
      trailerUrl: item.trailerUrl || null,
      rating: item.rating ?? null,
      metadata: item.metadata || {}
    },
    create: {
      provider: item.provider,
      externalId: item.externalId,
      mediaType: item.mediaType,
      title: item.title,
      originalTitle: item.originalTitle || null,
      slug: slugify(item.title),
      description: item.description || null,
      coverUrl: item.coverUrl || null,
      backdropUrl: item.backdropUrl || null,
      releaseDate,
      genres: item.genres,
      sourceUrl: item.sourceUrl || null,
      trailerUrl: item.trailerUrl || null,
      rating: item.rating ?? null,
      metadata: item.metadata || {}
    }
  });
}
var ANILIST_RELEASES = `query ($type:MediaType!,$from:FuzzyDateInt!,$to:FuzzyDateInt!){
  Page(page:1,perPage:30){media(type:$type,isAdult:false,startDate_greater:$from,startDate_lesser:$to,sort:[START_DATE]){
    id title{romaji english native} description(asHtml:false) coverImage{extraLarge large} bannerImage
    startDate{year month day} genres averageScore episodes chapters volumes format status siteUrl trailer{id site thumbnail}
  }}
}`;
function dateOnly(value) {
  const match = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!match) throw new Error("Data inv\xE1lida");
  return value;
}
function utcDate(value) {
  return /* @__PURE__ */ new Date(`${dateOnly(value)}T00:00:00.000Z`);
}
function fuzzyDate(value, offsetDays = 0) {
  const d = utcDate(value);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return Number(
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`
  );
}
async function releasesTmdb(from, to, type) {
  const headers = tmdbHeaders();
  if (!headers) return [];
  const endpoint = type === "MOVIE" ? "movie" : "tv";
  const url = new URL(`https://api.themoviedb.org/3/discover/${endpoint}`);
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("include_adult", "false");
  url.searchParams.set("page", "1");
  url.searchParams.set("sort_by", type === "MOVIE" ? "primary_release_date.asc" : "first_air_date.asc");
  url.searchParams.set(type === "MOVIE" ? "primary_release_date.gte" : "first_air_date.gte", from);
  url.searchParams.set(type === "MOVIE" ? "primary_release_date.lte" : "first_air_date.lte", to);
  const data = await requestJson(url.toString(), { headers }, 18e3);
  return (data.results || []).slice(0, 30).map((row) => ({
    provider: "TMDB",
    externalId: String(row.id),
    mediaType: type,
    title: String(type === "MOVIE" ? row.title : row.name || ""),
    originalTitle: type === "MOVIE" ? row.original_title : row.original_name,
    description: compact(row.overview),
    coverUrl: tmdbImage(row.poster_path),
    backdropUrl: tmdbImage(row.backdrop_path, "w780"),
    releaseDate: type === "MOVIE" ? row.release_date : row.first_air_date,
    genres: [],
    rating: typeof row.vote_average === "number" ? row.vote_average : null,
    sourceUrl: `https://www.themoviedb.org/${endpoint}/${row.id}`,
    metadata: { popularity: row.popularity, originalLanguage: row.original_language }
  })).filter((x) => x.releaseDate);
}
async function releasesAniList(from, to, type) {
  const data = await anilistRequest(ANILIST_RELEASES, { type, from: fuzzyDate(from, -1), to: fuzzyDate(to, 1) });
  return (data.data?.Page?.media || []).map((row) => normalizeAniList(row, type)).filter((item) => Boolean(item.releaseDate && item.releaseDate >= from && item.releaseDate <= to));
}
async function releasesIgdb(from, to) {
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) return [];
  const fromUnix = Math.floor(utcDate(from).getTime() / 1e3);
  const toDate = utcDate(to);
  toDate.setUTCHours(23, 59, 59, 999);
  const toUnix = Math.floor(toDate.getTime() / 1e3);
  const rows = await igdbRequest(
    `fields name,summary,storyline,slug,url,cover.image_id,first_release_date,genres.name,rating,platforms.name,videos.video_id,artworks.image_id,involved_companies.company.name; where first_release_date >= ${fromUnix} & first_release_date <= ${toUnix}; sort first_release_date asc; limit 30;`
  );
  return rows.map(normalizeIgdb).filter((item) => Boolean(item.releaseDate));
}
async function getCatalogReleases(from, to, type) {
  dateOnly(from);
  dateOnly(to);
  if (from > to) throw new Error("Intervalo de datas inv\xE1lido");
  const cacheKey = `catalog:releases:${type || "ALL"}:${from}:${to}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;
  const local = await prisma.mediaCatalogItem.findMany({
    where: {
      releaseDate: { gte: utcDate(from), lte: /* @__PURE__ */ new Date(`${to}T23:59:59.999Z`) },
      ...type ? { mediaType: type } : {}
    },
    orderBy: { releaseDate: "asc" },
    take: 100
  }).catch(() => []);
  const localItems = local.map((row) => ({
    provider: row.provider,
    externalId: row.externalId,
    mediaType: row.mediaType,
    title: row.title,
    originalTitle: row.originalTitle,
    description: row.description,
    coverUrl: row.coverUrl,
    backdropUrl: row.backdropUrl,
    releaseDate: row.releaseDate ? row.releaseDate.toISOString().slice(0, 10) : null,
    genres: Array.isArray(row.genres) ? row.genres : [],
    rating: row.rating,
    sourceUrl: row.sourceUrl,
    trailerUrl: row.trailerUrl,
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {}
  }));
  const tasks = [];
  if ((!type || type === "MOVIE") && env.TMDB_READ_TOKEN) tasks.push(releasesTmdb(from, to, "MOVIE"));
  if ((!type || type === "SERIES") && env.TMDB_READ_TOKEN) tasks.push(releasesTmdb(from, to, "SERIES"));
  if (!type || type === "ANIME") tasks.push(releasesAniList(from, to, "ANIME"));
  if (!type || type === "MANGA") tasks.push(releasesAniList(from, to, "MANGA"));
  if ((!type || type === "GAME") && env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET) tasks.push(releasesIgdb(from, to));
  const settled = await Promise.allSettled(tasks);
  const external = settled.flatMap((r) => r.status === "fulfilled" ? r.value : []);
  const seen = /* @__PURE__ */ new Set();
  const items = [...localItems, ...external].filter((item) => {
    if (!item.releaseDate || item.releaseDate < from || item.releaseDate > to) return false;
    const key2 = `${item.provider}:${item.mediaType}:${item.externalId}`;
    if (seen.has(key2)) return false;
    seen.add(key2);
    return true;
  }).sort((a, b) => (a.releaseDate || "9999").localeCompare(b.releaseDate || "9999")).slice(0, 120);
  await setCache(cacheKey, items, 1800);
  return items;
}
async function getWatchProviders(provider, type, externalId, region = env.WATCH_PROVIDERS_REGION) {
  if (provider !== "TMDB" || type !== "MOVIE" && type !== "SERIES" || !/^\d{1,12}$/.test(externalId)) return null;
  const headers = tmdbHeaders();
  if (!headers) return null;
  const cacheKey = `catalog:watch:${type}:${externalId}:${region}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;
  const endpoint = type === "MOVIE" ? "movie" : "tv";
  try {
    const data = await requestJson(
      `https://api.themoviedb.org/3/${endpoint}/${encodeURIComponent(externalId)}/watch/providers`,
      { headers }
    );
    const r = data?.results?.[region] || {};
    const map = (list) => (list || []).sort((a, b) => (a.display_priority ?? 99) - (b.display_priority ?? 99)).map((p) => ({
      id: Number(p.provider_id),
      name: String(p.provider_name),
      logoUrl: tmdbImage(p.logo_path, "w92")
    }));
    const result = {
      region,
      link: typeof r.link === "string" ? r.link : null,
      flatrate: map(r.flatrate),
      rent: map(r.rent),
      buy: map(r.buy),
      free: map(r.free),
      ads: map(r.ads)
    };
    await setCache(cacheKey, result, 12 * 3600);
    return result;
  } catch {
    return null;
  }
}

// src/routes/library.ts
var statuses = [
  "WATCHING",
  "WANT_TO_WATCH",
  "COMPLETED",
  "DROPPED",
  "READING",
  "WANT_TO_READ",
  "PLAYING",
  "WANT_TO_PLAY"
];
var providers = ["TMDB", "IGDB", "ANILIST"];
var libraryRoutes = async (app2) => {
  app2.get("/library", { preHandler: authenticate }, async (req) => {
    const { status } = z5.object({ status: z5.enum(statuses).optional() }).parse(req.query);
    return prisma.libraryItem.findMany({
      where: { userId: req.authUser.id, ...status ? { status } : {} },
      include: {
        catalogItem: {
          select: {
            id: true,
            provider: true,
            externalId: true,
            mediaType: true,
            description: true,
            backdropUrl: true,
            releaseDate: true,
            genres: true,
            rating: true,
            sourceUrl: true,
            trailerUrl: true,
            metadata: true
          }
        }
      },
      orderBy: { updatedAt: "desc" }
    });
  });
  app2.post("/library/from-catalog", { preHandler: authenticate }, async (req, reply) => {
    const body = z5.object({
      provider: z5.enum(providers),
      externalId: z5.string().min(1).max(120),
      mediaType: z5.enum(mediaTypes),
      status: z5.enum(statuses),
      notes: z5.string().max(1e3).optional().nullable(),
      rating: z5.number().int().min(1).max(10).optional().nullable()
    }).parse(req.body);
    const details = await getCatalogDetails(body.provider, body.mediaType, body.externalId);
    if (!details)
      return reply.code(404).send({ error: "N\xE3o foi poss\xEDvel carregar os dados completos deste item do cat\xE1logo." });
    const catalog = await cacheCatalogItem(details);
    const externalId = `${body.provider}:${body.externalId}`;
    const item = await prisma.libraryItem.upsert({
      where: { userId_externalId_mediaType: { userId: req.authUser.id, externalId, mediaType: body.mediaType } },
      update: {
        title: details.title,
        coverUrl: details.coverUrl || null,
        status: body.status,
        notes: body.notes,
        rating: body.rating,
        catalogItemId: catalog.id
      },
      create: {
        userId: req.authUser.id,
        externalId,
        title: details.title,
        mediaType: body.mediaType,
        coverUrl: details.coverUrl || null,
        status: body.status,
        notes: body.notes,
        rating: body.rating,
        catalogItemId: catalog.id
      },
      include: { catalogItem: true }
    });
    return reply.code(201).send(item);
  });
  app2.post("/library", { preHandler: authenticate }, async (req, reply) => {
    const b = z5.object({
      externalId: z5.string().min(1),
      title: z5.string().min(1),
      mediaType: z5.enum(mediaTypes),
      coverUrl: z5.string().url().optional().nullable(),
      status: z5.enum(statuses),
      notes: z5.string().max(1e3).optional().nullable(),
      rating: z5.number().int().min(1).max(10).optional().nullable()
    }).parse(req.body);
    if (b.coverUrl && !isManagedUploadUrl(b.coverUrl, ["library"]))
      return reply.code(400).send({ error: "A capa manual deve ser enviada pelo upload seguro do Hypeverso." });
    return prisma.libraryItem.upsert({
      where: {
        userId_externalId_mediaType: { userId: req.authUser.id, externalId: b.externalId, mediaType: b.mediaType }
      },
      update: { title: b.title, coverUrl: b.coverUrl, status: b.status, notes: b.notes, rating: b.rating },
      create: { userId: req.authUser.id, ...b }
    });
  });
  app2.patch("/library/:id", { preHandler: authenticate }, async (req, reply) => {
    const { id } = z5.object({ id: z5.string() }).parse(req.params);
    const b = z5.object({
      title: z5.string().min(1).optional(),
      coverUrl: z5.string().url().optional().nullable(),
      status: z5.enum(statuses).optional(),
      notes: z5.string().max(1e3).optional().nullable(),
      rating: z5.number().int().min(1).max(10).optional().nullable()
    }).parse(req.body);
    if (b.coverUrl && !isManagedUploadUrl(b.coverUrl, ["library"]))
      return reply.code(400).send({ error: "A capa manual deve ser enviada pelo upload seguro do Hypeverso." });
    const item = await prisma.libraryItem.findFirst({ where: { id, userId: req.authUser.id } });
    if (!item) return reply.code(404).send({ error: "Item n\xE3o encontrado" });
    return prisma.libraryItem.update({ where: { id }, data: b });
  });
  app2.delete("/library/:id", { preHandler: authenticate }, async (req, reply) => {
    const { id } = z5.object({ id: z5.string() }).parse(req.params);
    await prisma.libraryItem.deleteMany({ where: { id, userId: req.authUser.id } });
    return reply.code(204).send();
  });
};
var library_default = libraryRoutes;

// src/routes/catalog.ts
import { z as z6 } from "zod";
var providers2 = ["TMDB", "IGDB", "ANILIST"];
var dateSchema = z6.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD");
var catalogRoutes = async (app2) => {
  app2.get("/catalog/providers", async () => ({ providers: providerAvailability() }));
  app2.get("/catalog/search", { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } }, async (req) => {
    const { q, type } = z6.object({ q: z6.string().trim().min(2).max(120), type: z6.enum(mediaTypes).optional() }).parse(req.query);
    const items = await searchCatalog(q, type);
    return { items, providers: providerAvailability() };
  });
  app2.get("/catalog/releases", { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } }, async (req) => {
    const { from, to, type } = z6.object({ from: dateSchema, to: dateSchema, type: z6.enum(mediaTypes).optional() }).parse(req.query);
    const items = await getCatalogReleases(from, to, type);
    return { items, providers: providerAvailability(), from, to, type: type || null };
  });
  app2.get(
    "/catalog/:provider/:type/:externalId",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { provider, type, externalId } = z6.object({ provider: z6.enum(providers2), type: z6.enum(mediaTypes), externalId: z6.string().min(1).max(120) }).parse(req.params);
      const item = await getCatalogDetails(provider, type, externalId);
      if (!item) return reply.code(404).send({ error: "Item n\xE3o encontrado no cat\xE1logo" });
      const cached = await cacheCatalogItem(item);
      return { ...item, catalogId: cached.id };
    }
  );
  app2.get("/catalog/items/:id", async (req, reply) => {
    const { id } = z6.object({ id: z6.string().min(1) }).parse(req.params);
    const item = await prisma.mediaCatalogItem.findUnique({ where: { id } });
    if (!item) return reply.code(404).send({ error: "Item do cat\xE1logo n\xE3o encontrado" });
    return item;
  });
  app2.get("/catalog/items/:id/related-posts", async (req, reply) => {
    const { id } = z6.object({ id: z6.string().min(1) }).parse(req.params);
    const item = await prisma.mediaCatalogItem.findUnique({ where: { id } });
    if (!item) return reply.code(404).send({ error: "Item do cat\xE1logo n\xE3o encontrado" });
    const terms = [item.title, item.originalTitle || ""].flatMap((v) => v.split(/[^\p{L}\p{N}]+/u)).map((v) => v.trim()).filter((v) => v.length >= 4).filter((v, i, a) => a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i).slice(0, 5);
    const or = [{ title: { contains: item.title } }];
    if (item.originalTitle && item.originalTitle !== item.title)
      or.push({ title: { contains: item.originalTitle } });
    for (const term of terms) {
      or.push({ title: { contains: term } });
      or.push({ description: { contains: term } });
      or.push({ tags: { some: { tag: { name: { contains: term } } } } });
    }
    const posts = await prisma.post.findMany({
      where: { status: "PUBLISHED", OR: or },
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        coverImageUrl: true,
        publishedAt: true,
        category: { select: { name: true, slug: true } }
      },
      orderBy: { publishedAt: "desc" },
      take: 6
    });
    return { posts };
  });
  app2.get("/catalog/reminders", { preHandler: authenticate }, async (req) => {
    return prisma.mediaReleaseReminder.findMany({
      where: { userId: req.authUser.id },
      include: { catalogItem: true },
      orderBy: [{ notifiedAt: "asc" }, { createdAt: "desc" }],
      take: 200
    });
  });
  app2.get("/catalog/reminders/:catalogItemId", { preHandler: authenticate }, async (req) => {
    const { catalogItemId } = z6.object({ catalogItemId: z6.string().min(1) }).parse(req.params);
    const reminder = await prisma.mediaReleaseReminder.findUnique({
      where: { userId_catalogItemId: { userId: req.authUser.id, catalogItemId } }
    });
    return { reminder };
  });
  app2.post("/catalog/reminders", { preHandler: authenticate }, async (req, reply) => {
    const body = z6.object({
      catalogItemId: z6.string().optional(),
      provider: z6.enum(providers2).optional(),
      externalId: z6.string().min(1).max(120).optional(),
      mediaType: z6.enum(mediaTypes).optional(),
      remindBeforeDays: z6.number().int().min(0).max(30).default(1)
    }).refine((v) => Boolean(v.catalogItemId || v.provider && v.externalId && v.mediaType), {
      message: "Informe catalogItemId ou provider/externalId/mediaType"
    }).parse(req.body);
    let catalog = body.catalogItemId ? await prisma.mediaCatalogItem.findUnique({ where: { id: body.catalogItemId } }) : null;
    if (!catalog && body.provider && body.externalId && body.mediaType) {
      const details = await getCatalogDetails(body.provider, body.mediaType, body.externalId);
      if (!details) return reply.code(404).send({ error: "N\xE3o foi poss\xEDvel carregar este lan\xE7amento." });
      catalog = await cacheCatalogItem(details);
    }
    if (!catalog) return reply.code(404).send({ error: "Item do cat\xE1logo n\xE3o encontrado" });
    if (!catalog.releaseDate)
      return reply.code(400).send({ error: "Este item ainda n\xE3o possui uma data de lan\xE7amento definida." });
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
    const release = new Date(catalog.releaseDate);
    release.setHours(0, 0, 0, 0);
    if (release.getTime() < today.getTime()) return reply.code(400).send({ error: "Este lan\xE7amento j\xE1 ocorreu." });
    const reminder = await prisma.mediaReleaseReminder.upsert({
      where: { userId_catalogItemId: { userId: req.authUser.id, catalogItemId: catalog.id } },
      update: { remindBeforeDays: body.remindBeforeDays, notifiedAt: null },
      create: { userId: req.authUser.id, catalogItemId: catalog.id, remindBeforeDays: body.remindBeforeDays },
      include: { catalogItem: true }
    });
    return reply.code(201).send(reminder);
  });
  app2.delete("/catalog/reminders/:catalogItemId", { preHandler: authenticate }, async (req, reply) => {
    const { catalogItemId } = z6.object({ catalogItemId: z6.string().min(1) }).parse(req.params);
    await prisma.mediaReleaseReminder.deleteMany({ where: { userId: req.authUser.id, catalogItemId } });
    return reply.code(204).send();
  });
};
var catalog_default = catalogRoutes;

// src/routes/search.ts
import { z as z7 } from "zod";
var postSelect = {
  id: true,
  title: true,
  slug: true,
  description: true,
  coverImageUrl: true,
  isPremium: true,
  publishedAt: true,
  category: { select: { id: true, name: true, slug: true } },
  author: { select: { name: true, username: true } },
  tags: { select: { tag: { select: { name: true, slug: true } } } }
};
async function databasePostSearch(input) {
  const page = Math.max(1, input.page || 1);
  const limit = Math.min(50, Math.max(1, input.limit || 20));
  const now = /* @__PURE__ */ new Date();
  const where = {
    status: "PUBLISHED",
    publishedAt: { lte: now, ...input.from ? { gte: input.from } : {}, ...input.to ? { lte: input.to } : {} },
    OR: [
      { title: { contains: input.q } },
      { description: { contains: input.q } },
      // Conteúdo premium não pode ser sondado via busca textual.
      { isPremium: false, content: { contains: input.q } },
      { tags: { some: { tag: { name: { contains: input.q } } } } }
    ]
  };
  if (input.category) where.category = { slug: input.category };
  if (input.tag) where.tags = { some: { tag: { slug: input.tag } } };
  if (input.premium !== void 0) where.isPremium = input.premium;
  const orderBy = input.sort === "oldest" ? [{ publishedAt: "asc" }] : input.sort === "title" ? [{ title: "asc" }] : [{ publishedAt: "desc" }];
  const [posts, total] = await Promise.all([
    prisma.post.findMany({ where, select: postSelect, orderBy, skip: (page - 1) * limit, take: limit }),
    prisma.post.count({ where })
  ]);
  return { posts, total, page, pages: Math.ceil(total / limit), facets: {}, engine: "mysql" };
}
var searchRoutes = async (app2) => {
  app2.get("/search/suggest", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
    const { q } = z7.object({ q: z7.string().trim().min(1).max(100) }).parse(req.query);
    try {
      const result = await searchPostsWithMeili({ q, page: 1, limit: 8, sort: "relevance" });
      return { posts: result.posts, engine: result.engine };
    } catch {
      const rows = await prisma.post.findMany({
        where: {
          status: "PUBLISHED",
          publishedAt: { lte: /* @__PURE__ */ new Date() },
          OR: [{ title: { contains: q } }, { description: { contains: q } }]
        },
        select: postSelect,
        take: 16,
        orderBy: { publishedAt: "desc" }
      });
      const needle = q.toLocaleLowerCase("pt-BR");
      const posts = rows.sort((a, b) => {
        const at = a.title.toLocaleLowerCase("pt-BR");
        const bt = b.title.toLocaleLowerCase("pt-BR");
        return (at.startsWith(needle) ? 0 : 1) - (bt.startsWith(needle) ? 0 : 1) || at.localeCompare(bt, "pt-BR");
      }).slice(0, 8);
      return { posts, engine: "mysql" };
    }
  });
  app2.get("/search", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const query = z7.object({
      q: z7.string().trim().min(1).max(100),
      type: z7.enum(["all", "posts", "users", "categories", "tags"]).default("all"),
      category: z7.string().trim().optional(),
      tag: z7.string().trim().optional(),
      premium: z7.enum(["true", "false"]).optional(),
      from: z7.string().datetime().optional(),
      to: z7.string().datetime().optional(),
      sort: z7.enum(["relevance", "recent", "oldest", "title"]).default("relevance"),
      page: z7.coerce.number().int().min(1).default(1),
      limit: z7.coerce.number().int().min(1).max(50).default(20)
    }).parse(req.query);
    let userId;
    try {
      userId = (await req.jwtVerify()).sub;
    } catch {
    }
    if (userId && query.q.length >= 2) {
      await prisma.searchHistory.create({ data: { userId, query: query.q } }).catch(() => void 0);
    }
    const postInput = {
      q: query.q,
      category: query.category,
      tag: query.tag,
      premium: query.premium === void 0 ? void 0 : query.premium === "true",
      from: query.from ? new Date(query.from) : void 0,
      to: query.to ? new Date(query.to) : void 0,
      page: query.page,
      limit: query.limit,
      sort: query.sort
    };
    let postResult = {
      posts: [],
      total: 0,
      page: query.page,
      pages: 0,
      facets: {},
      engine: "mysql"
    };
    if (["all", "posts"].includes(query.type)) {
      try {
        postResult = await searchPostsWithMeili(postInput);
      } catch {
        postResult = await databasePostSearch(postInput);
      }
    }
    const [users, categories, tags] = await Promise.all([
      ["all", "users"].includes(query.type) ? prisma.user.findMany({
        where: {
          status: "ACTIVE",
          OR: [
            { name: { contains: query.q } },
            { username: { contains: query.q } }
          ]
        },
        select: { id: true, name: true, username: true, avatarUrl: true, bio: true, level: true },
        take: 12
      }) : [],
      ["all", "categories"].includes(query.type) ? prisma.category.findMany({
        where: { name: { contains: query.q } },
        take: 10,
        orderBy: { name: "asc" }
      }) : [],
      ["all", "tags"].includes(query.type) ? prisma.tag.findMany({
        where: { name: { contains: query.q } },
        take: 20,
        orderBy: { name: "asc" }
      }) : []
    ]);
    return {
      posts: postResult.posts,
      users,
      categories,
      tags,
      meta: {
        engine: postResult.engine,
        total: postResult.total,
        page: postResult.page,
        pages: postResult.pages,
        facets: postResult.facets
      }
    };
  });
  app2.get("/search/status", async () => {
    const search = await searchIndexHealth();
    return { ok: search.ok, engine: search.ok ? "meilisearch" : "mysql-fallback", search };
  });
  app2.get("/search/history", async (req, reply) => {
    try {
      const p = await req.jwtVerify();
      return prisma.searchHistory.findMany({ where: { userId: p.sub }, orderBy: { createdAt: "desc" }, take: 20 });
    } catch {
      return reply.code(401).send({ error: "N\xE3o autenticado" });
    }
  });
};
var search_default = searchRoutes;

// src/routes/recommendations.ts
var selectPost = {
  id: true,
  title: true,
  slug: true,
  description: true,
  coverImageUrl: true,
  publishedAt: true,
  categoryId: true,
  category: { select: { id: true, name: true, slug: true } },
  _count: { select: { favorites: true, comments: true, interactions: true } }
};
function daysAgo(date) {
  if (!date) return 365;
  return Math.max(0, (Date.now() - date.getTime()) / 864e5);
}
var recommendationsRoutes = async (app2) => {
  app2.get("/recommendations", async (req) => {
    let userId;
    try {
      userId = (await req.jwtVerify()).sub;
    } catch {
    }
    if (!userId) {
      const posts = await prisma.post.findMany({
        where: { status: "PUBLISHED", publishedAt: { lte: /* @__PURE__ */ new Date() } },
        select: selectPost,
        orderBy: { publishedAt: "desc" },
        take: 12
      });
      return posts.map((post) => ({
        ...post,
        recommendationReason: "Em destaque no Hypeverso",
        recommendationStrategy: "recent"
      }));
    }
    const [favs, interactions, preferences, semantic] = await Promise.all([
      prisma.favorite.findMany({ where: { userId }, select: { postId: true, post: { select: { categoryId: true } } } }),
      prisma.userInteraction.findMany({
        where: { userId, createdAt: { gte: new Date(Date.now() - 120 * 864e5) } },
        select: { postId: true, weight: true, type: true, post: { select: { categoryId: true } } },
        orderBy: { createdAt: "desc" },
        take: 250
      }),
      prisma.userNewsCategoryPreference.findMany({
        where: { userId },
        select: { categoryId: true, category: { select: { name: true } } }
      }),
      semanticCandidates(userId, 36)
    ]);
    const categoryScore = /* @__PURE__ */ new Map();
    const categoryNames = /* @__PURE__ */ new Map();
    for (const fav of favs) categoryScore.set(fav.post.categoryId, (categoryScore.get(fav.post.categoryId) || 0) + 8);
    for (const item of interactions)
      categoryScore.set(
        item.post.categoryId,
        (categoryScore.get(item.post.categoryId) || 0) + Math.max(1, item.weight)
      );
    for (const pref of preferences) {
      categoryScore.set(pref.categoryId, (categoryScore.get(pref.categoryId) || 0) + 10);
      categoryNames.set(pref.categoryId, pref.category.name);
    }
    const topCategories = [...categoryScore.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
    const semanticMap = new Map(semantic.map((row) => [row.id, Math.max(0, Math.min(1, row.similarity))]));
    const seenIds = /* @__PURE__ */ new Set([
      ...favs.map((f) => f.postId),
      ...interactions.filter((i) => i.type === "VIEW").slice(0, 100).map((i) => i.postId)
    ]);
    const semanticIds = semantic.map((row) => row.id);
    const categoryCandidates = await prisma.post.findMany({
      where: {
        status: "PUBLISHED",
        publishedAt: { lte: /* @__PURE__ */ new Date() },
        ...topCategories.length ? { categoryId: { in: topCategories } } : {},
        id: { notIn: [...seenIds].slice(0, 300) }
      },
      select: selectPost,
      orderBy: { publishedAt: "desc" },
      take: 30
    });
    const semanticPosts = semanticIds.length ? await prisma.post.findMany({
      where: { id: { in: semanticIds }, status: "PUBLISHED", publishedAt: { lte: /* @__PURE__ */ new Date() } },
      select: selectPost
    }) : [];
    const byId = /* @__PURE__ */ new Map();
    for (const post of [...semanticPosts, ...categoryCandidates]) byId.set(post.id, post);
    const maxCategory = Math.max(1, ...categoryScore.values());
    const scored = [...byId.values()].map((post) => {
      const similarity = semanticMap.get(post.id) || 0;
      const affinity = (categoryScore.get(post.categoryId) || 0) / maxCategory;
      const freshness = Math.max(0, 1 - daysAgo(post.publishedAt) / 90);
      const popularityRaw = post._count.favorites * 3 + post._count.comments * 2 + Math.min(post._count.interactions, 25);
      const popularity = Math.min(1, popularityRaw / 40);
      const score = similarity * 0.6 + affinity * 0.22 + freshness * 0.12 + popularity * 0.06;
      let recommendationReason = "Selecionado para voc\xEA";
      if (similarity >= 0.55) recommendationReason = "Parecido com conte\xFAdos que voc\xEA curtiu";
      else if (categoryScore.get(post.categoryId))
        recommendationReason = `Porque voc\xEA acompanha ${categoryNames.get(post.categoryId) || post.category.name}`;
      else if (freshness > 0.85) recommendationReason = "Novidade que combina com seu perfil";
      return {
        ...post,
        recommendationReason,
        recommendationStrategy: semantic.length ? "hybrid-semantic" : "category-affinity",
        recommendationScore: Number(score.toFixed(4))
      };
    });
    const result = scored.sort((a, b) => b.recommendationScore - a.recommendationScore).slice(0, 12);
    if (result.length) return result;
    const fallback = await prisma.post.findMany({
      where: { status: "PUBLISHED", publishedAt: { lte: /* @__PURE__ */ new Date() } },
      select: selectPost,
      orderBy: { publishedAt: "desc" },
      take: 12
    });
    return fallback.map((post) => ({
      ...post,
      recommendationReason: "Novidade no Hypeverso",
      recommendationStrategy: "fallback"
    }));
  });
  app2.get("/recommendations/status", async () => {
    const [embeddings, published] = await Promise.all([
      prisma.postEmbedding.count(),
      prisma.post.count({ where: { status: "PUBLISHED", publishedAt: { lte: /* @__PURE__ */ new Date() } } })
    ]);
    return { ok: true, embeddings, published, coverage: published ? Number((embeddings / published).toFixed(3)) : 1 };
  });
};
var recommendations_default = recommendationsRoutes;

// src/routes/admin.ts
import { z as z8 } from "zod";

// src/services/community-moderation.ts
var COMMUNITY_MOD = {
  minLevel: 5,
  minAccountDays: 14,
  minReputation: -10,
  hideThreshold: 4,
  rewardCorrect: 2,
  penaltyWrong: 3
};
function voteWeight(reputation) {
  return Math.min(3, Math.max(1, 1 + Math.floor(reputation / 20)));
}
async function moderationEligibility(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      status: true,
      level: true,
      createdAt: true,
      emailVerifiedAt: true,
      moderationReputation: true
    }
  });
  if (!user) return { eligible: false, reasons: ["Usu\xE1rio n\xE3o encontrado"], reputation: 0, weight: 0 };
  if (user.role !== "USER")
    return { eligible: true, staff: true, reasons: [], reputation: user.moderationReputation, weight: 3 };
  const reasons = [];
  if (user.status !== "ACTIVE") reasons.push("Conta inativa");
  if (user.level < COMMUNITY_MOD.minLevel) reasons.push(`Alcance o n\xEDvel ${COMMUNITY_MOD.minLevel}`);
  if (!user.emailVerifiedAt) reasons.push("Confirme seu e-mail");
  const days = (Date.now() - user.createdAt.getTime()) / 864e5;
  if (days < COMMUNITY_MOD.minAccountDays) reasons.push(`Conta com pelo menos ${COMMUNITY_MOD.minAccountDays} dias`);
  if (user.moderationReputation < COMMUNITY_MOD.minReputation) reasons.push("Reputa\xE7\xE3o de modera\xE7\xE3o muito baixa");
  return {
    eligible: reasons.length === 0,
    staff: false,
    reasons,
    reputation: user.moderationReputation,
    weight: voteWeight(user.moderationReputation)
  };
}
async function evaluateReport(reportId) {
  const votes = await prisma.reportVote.findMany({ where: { reportId }, select: { verdict: true, weight: true } });
  const violates = votes.filter((v) => v.verdict === "VIOLATES").reduce((s, v) => s + v.weight, 0);
  const ok = votes.filter((v) => v.verdict === "OK").reduce((s, v) => s + v.weight, 0);
  const report = await prisma.commentReport.findUnique({
    where: { id: reportId },
    select: { commentId: true, status: true }
  });
  if (!report || report.status !== "OPEN") return { violates, ok, action: "none" };
  if (violates >= COMMUNITY_MOD.hideThreshold && violates > ok) {
    await prisma.$transaction([
      prisma.comment.update({
        where: { id: report.commentId },
        data: { hiddenAt: /* @__PURE__ */ new Date(), hiddenReason: "community-triage" }
      }),
      prisma.commentReport.update({ where: { id: reportId }, data: { status: "REVIEWED" } })
    ]);
    return { violates, ok, action: "hidden" };
  }
  if (ok >= COMMUNITY_MOD.hideThreshold && ok > violates) {
    await prisma.commentReport.update({ where: { id: reportId }, data: { status: "REVIEWED" } });
    return { violates, ok, action: "kept" };
  }
  return { violates, ok, action: "pending" };
}
async function applyStaffDecision(reportId, status, staffId) {
  if (status === "REVIEWED") return;
  const report = await prisma.commentReport.findUnique({
    where: { id: reportId },
    select: { commentId: true, votes: { select: { userId: true, verdict: true } } }
  });
  if (!report) return;
  const violation = status === "RESOLVED";
  await prisma.comment.update({
    where: { id: report.commentId },
    data: violation ? { hiddenAt: /* @__PURE__ */ new Date(), hiddenReason: `staff:${staffId}` } : { hiddenAt: null, hiddenReason: null }
  });
  const correct = report.votes.filter((v) => v.verdict === "VIOLATES" === violation).map((v) => v.userId);
  const wrong = report.votes.filter((v) => v.verdict === "VIOLATES" !== violation).map((v) => v.userId);
  await prisma.$transaction([
    prisma.user.updateMany({
      where: { id: { in: correct } },
      data: { moderationReputation: { increment: COMMUNITY_MOD.rewardCorrect } }
    }),
    prisma.user.updateMany({
      where: { id: { in: wrong } },
      data: { moderationReputation: { decrement: COMMUNITY_MOD.penaltyWrong } }
    })
  ]);
}

// src/routes/admin.ts
var adminRoutes = async (app2) => {
  const admin = async (req, reply) => requireRole("ADMIN")(req, reply);
  const moderation = async (req, reply) => requireRole("MODERATOR", "ADMIN")(req, reply);
  app2.get("/admin/dashboard", { preHandler: admin }, async () => {
    const since = new Date(Date.now() - 30 * 864e5);
    const [users, posts, published, comments, community, views, newUsers, premium, reports] = await prisma.$transaction(
      [
        prisma.user.count(),
        prisma.post.count(),
        prisma.post.count({ where: { status: "PUBLISHED" } }),
        prisma.comment.count(),
        prisma.communityPost.count(),
        prisma.analyticsEvent.count({ where: { type: "POST_VIEW", createdAt: { gte: since } } }),
        prisma.user.count({ where: { createdAt: { gte: since } } }),
        prisma.subscription.count({ where: { status: "ACTIVE" } }),
        prisma.commentReport.count({ where: { status: "OPEN" } })
      ]
    );
    const recentUsers = await prisma.user.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true },
      take: 1e5
    });
    const perDay = /* @__PURE__ */ new Map();
    for (const u of recentUsers) {
      const day = u.createdAt.toISOString().slice(0, 10);
      perDay.set(day, (perDay.get(day) || 0) + 1);
    }
    const growth = [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day: /* @__PURE__ */ new Date(`${day}T00:00:00.000Z`), count }));
    return {
      totals: { users, posts, published, comments, community, premium, reports },
      last30Days: { views, newUsers, userGrowth: growth.map((r) => ({ day: r.day, count: Number(r.count) })) }
    };
  });
  app2.get("/admin/users", { preHandler: admin }, async (req) => {
    const q = z8.object({
      q: z8.string().max(100).optional(),
      page: z8.coerce.number().min(1).default(1),
      limit: z8.coerce.number().min(1).max(100).default(30)
    }).parse(req.query);
    return prisma.user.findMany({
      where: q.q ? {
        OR: [
          { name: { contains: q.q } },
          { email: { contains: q.q } },
          { username: { contains: q.q } }
        ]
      } : void 0,
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        role: true,
        status: true,
        level: true,
        xp: true,
        createdAt: true,
        subscription: true
      },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { createdAt: "desc" }
    });
  });
  app2.patch("/admin/users/:id", { preHandler: admin }, async (req) => {
    const { id } = z8.object({ id: z8.string() }).parse(req.params);
    const b = z8.object({
      role: z8.enum(["USER", "MODERATOR", "EDITOR", "ADMIN"]).optional(),
      status: z8.enum(["ACTIVE", "SUSPENDED", "BANNED"]).optional()
    }).parse(req.body);
    if (id === req.authUser.id && (b.role && b.role !== "ADMIN" || b.status && b.status !== "ACTIVE")) {
      const e = new Error("Voc\xEA n\xE3o pode rebaixar ou bloquear a pr\xF3pria conta.");
      e.statusCode = 400;
      throw e;
    }
    if (b.role && b.role !== "ADMIN") {
      const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
      if (target?.role === "ADMIN" && await prisma.user.count({ where: { role: "ADMIN", status: "ACTIVE" } }) <= 1) {
        const e = new Error("O sistema precisa manter ao menos um administrador ativo.");
        e.statusCode = 400;
        throw e;
      }
    }
    const updated = await prisma.user.update({
      where: { id },
      data: b,
      select: { id: true, name: true, username: true, email: true, role: true, status: true }
    });
    if (b.status && b.status !== "ACTIVE" || b.role) {
      await prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: /* @__PURE__ */ new Date() } });
    }
    req.log.info({ adminId: req.authUser.id, targetId: id, changes: b }, "Admin alterou usu\xE1rio");
    return updated;
  });
  app2.get("/admin/reports", { preHandler: moderation }, async () => {
    const reports = await prisma.commentReport.findMany({
      include: {
        comment: {
          include: { user: { select: { name: true, username: true } }, post: { select: { title: true, slug: true } } }
        },
        reporter: { select: { name: true, username: true } },
        votes: { select: { verdict: true, weight: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 500
    });
    return reports.map(({ votes, ...r }) => ({
      ...r,
      community: {
        violates: votes.filter((v) => v.verdict === "VIOLATES").reduce((s, v) => s + v.weight, 0),
        ok: votes.filter((v) => v.verdict === "OK").reduce((s, v) => s + v.weight, 0),
        voters: votes.length
      }
    }));
  });
  app2.patch("/admin/reports/:id", { preHandler: moderation }, async (req) => {
    const { id } = z8.object({ id: z8.string() }).parse(req.params);
    const { status } = z8.object({ status: z8.enum(["REVIEWED", "RESOLVED", "DISMISSED"]) }).parse(req.body);
    const report = await prisma.commentReport.update({ where: { id }, data: { status } });
    await applyStaffDecision(id, status, req.authUser.id);
    return report;
  });
};
var admin_default = adminRoutes;

// src/routes/uploads.ts
import { createWriteStream } from "fs";
import { mkdir, unlink as unlink2 } from "fs/promises";
import { pipeline } from "stream/promises";
import path from "path";
import { nanoid } from "nanoid";
import { z as z9 } from "zod";

// src/lib/image-processing.ts
import sharp from "sharp";
import { rename, unlink } from "fs/promises";
var MAX_DIMENSION = 4096;
sharp.cache(false);
sharp.concurrency(1);
async function reencodeImage(path2, format) {
  const animated = format === "gif" || format === "webp";
  let pipeline2 = sharp(path2, { animated, limitInputPixels: 5e7, failOn: "error" }).rotate().resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true });
  if (format === "jpg") pipeline2 = pipeline2.jpeg({ quality: 85, mozjpeg: true });
  else if (format === "png") pipeline2 = pipeline2.png({ compressionLevel: 9 });
  else if (format === "webp") pipeline2 = pipeline2.webp({ quality: 85 });
  else if (format === "gif") pipeline2 = pipeline2.gif();
  else pipeline2 = pipeline2.avif({ quality: 60 });
  const tmp = `${path2}.processing`;
  try {
    const info = await pipeline2.toFile(tmp);
    await rename(tmp, path2);
    return { format, width: info.width, height: info.height, bytes: info.size };
  } catch (error) {
    await unlink(tmp).catch(() => void 0);
    throw error;
  }
}

// src/routes/uploads.ts
import { open as openFile } from "fs/promises";
var IMAGE_FORMATS = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif"
};
var MAX_IMAGE_BYTES = 15 * 1024 * 1024;
var MODERATED_PURPOSES = /* @__PURE__ */ new Set(["avatar", "library", "community"]);
var STAFF_ONLY_PURPOSES = /* @__PURE__ */ new Set(["article", "shop"]);
async function detectImageFormat(file) {
  const handle = await openFile(file, "r");
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buf, 0, 16, 0);
    const b = buf.subarray(0, bytesRead);
    if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return "jpg";
    if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      return "png";
    if (b.length >= 6 && (b.subarray(0, 6).toString("ascii") === "GIF87a" || b.subarray(0, 6).toString("ascii") === "GIF89a"))
      return "gif";
    if (b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP")
      return "webp";
    if (b.length >= 12 && b.subarray(4, 8).toString("ascii") === "ftyp" && /^(avif|avis)$/.test(b.subarray(8, 12).toString("ascii")))
      return "avif";
    return null;
  } finally {
    await handle.close();
  }
}
var uploadRoutes = async (app2) => {
  app2.get("/uploads/moderation-health", { preHandler: authenticate }, async (_req, reply) => {
    const health = await checkImageModerationHealth();
    return reply.code(health.ok ? 200 : 503).send(health);
  });
  app2.post(
    "/uploads",
    { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const { purpose } = z9.object({
        purpose: z9.enum(["article", "avatar", "library", "community", "shop"]).default("article")
      }).parse(req.query ?? {});
      if (STAFF_ONLY_PURPOSES.has(purpose) && !["EDITOR", "ADMIN"].includes(req.authUser.role)) {
        return reply.code(403).send({ error: "Apenas a equipe editorial pode enviar imagens de artigos." });
      }
      const staff = ["EDITOR", "ADMIN", "MODERATOR"].includes(req.authUser.role);
      const modSettings = (await getAllSettings()).moderation;
      if (!staff && (purpose === "community" || purpose === "library") && modSettings.imageMinLevel > 1) {
        const me = await prisma.user.findUnique({ where: { id: req.authUser.id }, select: { level: true } });
        if ((me?.level ?? 1) < modSettings.imageMinLevel)
          return reply.code(403).send({
            error: `Envio de imagens liberado a partir do n\xEDvel ${modSettings.imageMinLevel}. Participe da comunidade para subir de n\xEDvel!`,
            code: "IMAGE_LEVEL_REQUIRED"
          });
      }
      const part = await req.file({ limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });
      if (!part) return reply.code(400).send({ error: "Arquivo ausente" });
      const ext = IMAGE_FORMATS[part.mimetype.toLowerCase()];
      if (!ext) {
        part.file.resume();
        return reply.code(415).send({
          error: "Formato de imagem n\xE3o suportado. Use JPG, PNG, WebP, GIF ou AVIF.",
          supportedFormats: Object.keys(IMAGE_FORMATS)
        });
      }
      const name = `${purpose}-${Date.now()}-${nanoid(12)}.${ext}`;
      const destination = path.join(TMP_DIR, name);
      await mkdir(TMP_DIR, { recursive: true });
      try {
        await pipeline(part.file, createWriteStream(destination, { flags: "wx" }));
        if (part.file.truncated) {
          await unlink2(destination).catch(() => {
          });
          return reply.code(413).send({ error: "A imagem excede o limite de 15 MB." });
        }
        const realFormat = await detectImageFormat(destination);
        if (!realFormat || realFormat !== ext && !(realFormat === "jpg" && ext === "jpg")) {
          await unlink2(destination).catch(() => {
          });
          return reply.code(415).send({ error: "O conte\xFAdo do arquivo n\xE3o corresponde a uma imagem v\xE1lida." });
        }
        let processed;
        try {
          processed = await reencodeImage(destination, ext);
        } catch (error) {
          req.log.warn({ err: error }, "Imagem rejeitada no reprocessamento");
          await unlink2(destination).catch(() => {
          });
          return reply.code(415).send({ error: "N\xE3o foi poss\xEDvel processar esta imagem. Tente outro arquivo." });
        }
        let moderation;
        const inlineModeration = env.IMAGE_MODERATION_ENABLED.toLowerCase() === "true";
        const deferredModeration = MODERATED_PURPOSES.has(purpose) && !inlineModeration && !staff && modSettings.enabled;
        if (MODERATED_PURPOSES.has(purpose) && inlineModeration) {
          moderation = await moderateImageFile(destination, part.mimetype, part.filename);
          if (!moderation.allowed) {
            await unlink2(destination).catch(() => {
            });
            return reply.code(422).send({
              error: "A imagem foi recusada pela modera\xE7\xE3o de seguran\xE7a. Escolha outra imagem.",
              code: "IMAGE_MODERATION_REJECTED"
            });
          }
        }
        const mimeType = `image/${ext === "jpg" ? "jpeg" : ext}`;
        const url = await saveMediaFile(name, destination, {
          mimeType,
          purpose,
          width: processed.width,
          height: processed.height,
          uploadedById: req.authUser.id,
          moderationStatus: deferredModeration ? "PENDING" : moderation ? "APPROVED" : "NOT_REQUIRED"
        });
        return {
          url,
          format: ext,
          mimeType: part.mimetype,
          originalName: path.basename(part.filename || "").slice(0, 200),
          moderated: Boolean(moderation),
          moderationPending: deferredModeration,
          width: processed.width,
          height: processed.height,
          bytes: processed.bytes
        };
      } catch (error) {
        await unlink2(destination).catch(() => {
        });
        throw error;
      }
    }
  );
};
var uploads_default = uploadRoutes;

// src/routes/billing.ts
import Stripe from "stripe";
var stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;
var billingRoutes = async (app2) => {
  app2.post(
    "/billing/checkout",
    { preHandler: authenticate, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!stripe || !env.STRIPE_PREMIUM_PRICE_ID)
        return reply.code(503).send({ error: "Stripe ainda n\xE3o configurado" });
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: req.authUser.id },
        include: { subscription: true }
      });
      let customerId = user.subscription?.stripeCustomerId;
      if (!customerId) {
        const c = await stripe.customers.create({ email: user.email, name: user.name, metadata: { userId: user.id } });
        customerId = c.id;
        await prisma.subscription.upsert({
          where: { userId: user.id },
          create: { userId: user.id, stripeCustomerId: customerId },
          update: { stripeCustomerId: customerId }
        });
      }
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: env.STRIPE_PREMIUM_PRICE_ID, quantity: 1 }],
        success_url: `${env.PUBLIC_WEB_URL}/premium?success=1`,
        cancel_url: `${env.PUBLIC_WEB_URL}/premium?canceled=1`,
        metadata: { userId: user.id }
      });
      return { url: session.url };
    }
  );
  app2.post("/billing/webhook", { config: { rawBody: true } }, async (req, reply) => {
    if (!stripe || !env.STRIPE_WEBHOOK_SECRET) return reply.code(503).send({ error: "Stripe n\xE3o configurado" });
    const sig = req.headers["stripe-signature"];
    if (!sig || Array.isArray(sig)) return reply.code(400).send({ error: "Assinatura ausente" });
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
    } catch {
      return reply.code(400).send({ error: "Webhook inv\xE1lido" });
    }
    if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(
      event.type
    )) {
      const sub = event.data.object;
      const customerId = String(sub.customer);
      const status = sub.status === "active" || sub.status === "trialing" ? "ACTIVE" : sub.status === "past_due" ? "PAST_DUE" : sub.status === "canceled" ? "CANCELED" : "FREE";
      await prisma.subscription.updateMany({
        where: { stripeCustomerId: customerId },
        data: {
          stripeSubscriptionId: sub.id,
          status,
          currentPeriodEnd: new Date(sub.current_period_end * 1e3)
        }
      });
    }
    return { received: true };
  });
};
var billing_default = billingRoutes;

// src/routes/analytics.ts
import { z as z10 } from "zod";
var analyticsRoutes = async (app2) => {
  app2.post("/analytics/event", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const b = z10.object({
      type: z10.string().min(2).max(80).regex(/^[A-Za-z0-9_.:-]+$/),
      path: z10.string().max(300).optional(),
      referrer: z10.string().max(500).optional(),
      postId: z10.string().max(40).optional(),
      metadata: z10.record(z10.string().max(60), z10.union([z10.string().max(300), z10.number(), z10.boolean(), z10.null()])).refine((m) => Object.keys(m).length <= 20, "metadata muito grande").optional()
    }).parse(req.body);
    let userId;
    try {
      const p = await req.jwtVerify();
      userId = p.sub;
    } catch {
    }
    await prisma.analyticsEvent.create({ data: { ...b, userId } });
    return reply.code(202).send({ ok: true });
  });
};
var analytics_default = analyticsRoutes;

// src/routes/ai-news.ts
import { z as z11 } from "zod";
var aiNewsRoutes = async (app2) => {
  const editor = async (req, reply) => requireRole("EDITOR", "ADMIN")(req, reply);
  app2.get("/admin/ai-news/health", { preHandler: editor }, async () => getAiNewsHealth());
  app2.post("/admin/ai-news/repair", { preHandler: editor }, async (_req, reply) => {
    try {
      const target = new URL("/repair", env.AI_NEWS_WORKER_HEALTH_URL).toString();
      const response = await fetch(target, {
        method: "POST",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8e3)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return reply.code(503).send({ error: "O worker ainda n\xE3o respondeu ao reparo", detail: body });
      return reply.code(202).send({
        ok: true,
        message: "Reparo solicitado. O worker est\xE1 revalidando Ollama, modelo e busca.",
        worker: body
      });
    } catch (error) {
      return reply.code(503).send({
        error: "N\xE3o foi poss\xEDvel acionar o worker de IA. O Docker continuar\xE1 tentando reinici\xE1-lo automaticamente.",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  });
  app2.get("/admin/ai-news/jobs", { preHandler: editor }, async (req) => {
    const q = z11.object({ limit: z11.coerce.number().min(1).max(100).default(30) }).parse(req.query);
    return prisma.aiNewsJob.findMany({
      where: { hiddenAt: null },
      take: q.limit,
      orderBy: { createdAt: "desc" },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        requestedBy: { select: { id: true, name: true, username: true } },
        drafts: {
          include: {
            post: { select: { id: true, title: true, slug: true, status: true, coverImageUrl: true, updatedAt: true } },
            sources: { select: { id: true, title: true, url: true, publisher: true } }
          },
          orderBy: { createdAt: "desc" }
        }
      }
    });
  });
  app2.get("/admin/ai-news/drafts/:postId", { preHandler: editor }, async (req, reply) => {
    const { postId } = z11.object({ postId: z11.string() }).parse(req.params);
    const draft = await prisma.aiNewsDraft.findUnique({
      where: { postId },
      include: {
        sources: { orderBy: { createdAt: "asc" } },
        job: { select: { id: true, model: true, query: true, timeRange: true, createdAt: true } }
      }
    });
    if (!draft) return reply.code(404).send({ error: "Este conte\xFAdo n\xE3o foi gerado pelo AI News Studio" });
    return draft;
  });
  app2.post("/admin/ai-news/jobs", { preHandler: editor }, async (req, reply) => {
    const body = z11.object({
      categoryId: z11.string().optional().nullable(),
      query: z11.string().trim().min(2).max(180).optional().nullable(),
      requestedDrafts: z11.coerce.number().int().min(1).max(5).default(1),
      timeRange: z11.enum(["day", "week", "month"]).default("day"),
      language: z11.literal("pt-BR").default("pt-BR")
    }).parse(req.body);
    if (body.categoryId) {
      const category = await prisma.category.findUnique({ where: { id: body.categoryId }, select: { id: true } });
      if (!category) return reply.code(400).send({ error: "Categoria inv\xE1lida" });
    }
    const job = await prisma.aiNewsJob.create({
      data: {
        requestedById: req.authUser.id,
        categoryId: body.categoryId || null,
        query: body.query || null,
        requestedDrafts: body.requestedDrafts,
        language: body.language,
        timeRange: body.timeRange,
        model: getActiveAiModel(),
        stageMessage: "Aguardando BullMQ"
      }
    });
    try {
      await enqueueAiNewsJob(job.id);
    } catch (error) {
      await prisma.aiNewsJob.update({
        where: { id: job.id },
        data: {
          stageMessage: "Redis/BullMQ temporariamente indispon\xEDvel; o reconciliador tentar\xE1 novamente",
          error: error instanceof Error ? error.message : String(error)
        }
      }).catch(() => void 0);
    }
    return reply.code(202).send(job);
  });
  app2.post("/admin/ai-news/jobs/:id/retry", { preHandler: editor }, async (req, reply) => {
    const { id } = z11.object({ id: z11.string() }).parse(req.params);
    const current = await prisma.aiNewsJob.findFirst({ where: { id, hiddenAt: null } });
    if (!current) return reply.code(404).send({ error: "Processamento n\xE3o encontrado" });
    if (current.status === "PROCESSING")
      return reply.code(409).send({ error: "Este processamento ainda est\xE1 em andamento" });
    const job = await prisma.aiNewsJob.update({
      where: { id },
      data: {
        status: "PENDING",
        stage: "QUEUED",
        stageMessage: "Aguardando nova tentativa no BullMQ",
        progress: 0,
        error: null,
        startedAt: null,
        finishedAt: null,
        lastHeartbeatAt: null,
        cancelRequestedAt: null,
        hiddenAt: null,
        model: getActiveAiModel()
      }
    });
    await removeAiNewsQueueJob(id).catch(() => false);
    await enqueueAiNewsJob(id).catch(async (error) => {
      await prisma.aiNewsJob.update({
        where: { id },
        data: {
          stageMessage: "BullMQ indispon\xEDvel; nova tentativa ser\xE1 reconciliada automaticamente",
          error: error instanceof Error ? error.message : String(error)
        }
      }).catch(() => void 0);
    });
    return reply.code(202).send(job);
  });
  app2.post("/admin/ai-news/jobs/:id/cancel", { preHandler: editor }, async (req, reply) => {
    const { id } = z11.object({ id: z11.string() }).parse(req.params);
    const current = await prisma.aiNewsJob.findFirst({ where: { id, hiddenAt: null } });
    if (!current) return reply.code(404).send({ error: "Processamento n\xE3o encontrado" });
    if (["COMPLETED", "FAILED", "CANCELED"].includes(current.status)) {
      return reply.send(current);
    }
    const now = /* @__PURE__ */ new Date();
    await prisma.aiNewsJob.updateMany({
      where: { id, hiddenAt: null, status: { in: ["PENDING", "PROCESSING"] } },
      data: {
        status: "CANCELED",
        stage: "CANCELED",
        stageMessage: "Processamento cancelado pelo usu\xE1rio",
        cancelRequestedAt: now,
        finishedAt: now,
        lastHeartbeatAt: now,
        error: null
      }
    });
    await removeAiNewsQueueJob(id).catch(() => false);
    const job = await prisma.aiNewsJob.findUnique({ where: { id } });
    if (!job || job.hiddenAt) return reply.code(404).send({ error: "Processamento n\xE3o encontrado" });
    return reply.send(job);
  });
  const removeJob = async (req, reply) => {
    const { id } = z11.object({ id: z11.string() }).parse(req.params);
    const now = /* @__PURE__ */ new Date();
    const hidden = await prisma.aiNewsJob.updateMany({
      where: { id, hiddenAt: null },
      data: { hiddenAt: now, cancelRequestedAt: now, lastHeartbeatAt: now }
    });
    await prisma.aiNewsJob.updateMany({
      where: { id, status: { in: ["PENDING", "PROCESSING"] } },
      data: {
        status: "CANCELED",
        stage: "CANCELED",
        stageMessage: "Processamento removido da fila pelo usu\xE1rio",
        finishedAt: now,
        error: null
      }
    }).catch(() => void 0);
    await removeAiNewsQueueJob(id).catch(() => false);
    return reply.send({ ok: true, id, removed: hidden.count > 0 });
  };
  app2.patch("/admin/ai-news/jobs/:id/remove", { preHandler: editor }, removeJob);
  app2.post("/admin/ai-news/jobs/:id/remove", { preHandler: editor }, removeJob);
  app2.delete("/admin/ai-news/jobs/:id", { preHandler: editor }, removeJob);
  app2.patch("/admin/ai-news/jobs/cleanup", { preHandler: editor }, async (_req, reply) => {
    const now = /* @__PURE__ */ new Date();
    const rows = await prisma.aiNewsJob.findMany({
      where: { hiddenAt: null, status: { in: ["FAILED", "CANCELED"] } },
      select: { id: true },
      take: 500
    });
    const ids = rows.map((row) => row.id);
    const result = ids.length ? await prisma.aiNewsJob.updateMany({
      where: { id: { in: ids } },
      data: { hiddenAt: now, cancelRequestedAt: now, lastHeartbeatAt: now }
    }) : { count: 0 };
    await Promise.allSettled(ids.map((id) => removeAiNewsQueueJob(id)));
    return reply.send({ ok: true, removed: result.count });
  });
};
var ai_news_default = aiNewsRoutes;

// src/routes/queues.ts
import { z as z12 } from "zod";
var queueKeySchema = z12.enum(["aiNews", "system", "discovery"]);
var stateSchema = z12.enum(["failed", "waiting", "active", "delayed", "completed", "prioritized"]);
var queueRoutes = async (app2) => {
  const admin = async (req, reply) => requireRole("ADMIN")(req, reply);
  app2.get("/admin/queues", { preHandler: admin }, async () => {
    if (!bullEnabled()) return { enabled: false, mode: "legacy", queues: [] };
    const queues = await Promise.all(Object.keys(queueNames).map((key2) => queueSnapshot(key2)));
    return { enabled: true, mode: "bullmq-community", pro: false, queues };
  });
  app2.get("/admin/queues/:queue/jobs", { preHandler: admin }, async (req) => {
    const { queue } = z12.object({ queue: queueKeySchema }).parse(req.params);
    const q = z12.object({ state: stateSchema.default("failed"), limit: z12.coerce.number().int().min(1).max(100).default(30) }).parse(req.query);
    const bullState = q.state === "waiting" ? "wait" : q.state;
    const jobs = await getBullQueue(queue).getJobs([bullState], 0, q.limit - 1, false);
    return jobs.map((job) => ({
      id: job.id,
      name: job.name,
      data: job.data,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      attempts: job.opts.attempts || 1,
      failedReason: job.failedReason || null,
      timestamp: job.timestamp,
      processedOn: job.processedOn || null,
      finishedOn: job.finishedOn || null,
      state: q.state
    }));
  });
  app2.post("/admin/queues/:queue/jobs/:jobId/retry", { preHandler: admin }, async (req, reply) => {
    const { queue, jobId } = z12.object({ queue: queueKeySchema, jobId: z12.string().min(1) }).parse(req.params);
    const job = await getBullQueue(queue).getJob(jobId);
    if (!job) return reply.code(404).send({ error: "Job n\xE3o encontrado" });
    try {
      await job.retry();
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
    return { ok: true };
  });
  app2.delete("/admin/queues/:queue/jobs/:jobId", { preHandler: admin }, async (req, reply) => {
    const { queue, jobId } = z12.object({ queue: queueKeySchema, jobId: z12.string().min(1) }).parse(req.params);
    const job = await getBullQueue(queue).getJob(jobId);
    if (!job) return reply.send({ ok: true, removed: false });
    try {
      await job.remove();
      return { ok: true, removed: true };
    } catch (error) {
      return reply.code(409).send({
        error: "Jobs ativos n\xE3o podem ser removidos at\xE9 liberarem o lock.",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  });
  app2.post("/admin/queues/:queue/pause", { preHandler: admin }, async (req) => {
    const { queue } = z12.object({ queue: queueKeySchema }).parse(req.params);
    await getBullQueue(queue).pause();
    return { ok: true, paused: true };
  });
  app2.post("/admin/queues/:queue/resume", { preHandler: admin }, async (req) => {
    const { queue } = z12.object({ queue: queueKeySchema }).parse(req.params);
    await getBullQueue(queue).resume();
    return { ok: true, paused: false };
  });
  app2.delete("/admin/queues/:queue/failed", { preHandler: admin }, async (req) => {
    const { queue } = z12.object({ queue: queueKeySchema }).parse(req.params);
    const removed = await getBullQueue(queue).clean(0, 1e3, "failed");
    return { ok: true, removed: removed.length };
  });
};
var queues_default = queueRoutes;

// src/routes/mfa.ts
import { z as z13 } from "zod";
import QRCode from "qrcode";
var mfaRoutes = async (app2) => {
  const limited = { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } };
  app2.get("/me/mfa", { preHandler: authenticate }, async (req) => {
    const user = await prisma.user.findUnique({
      where: { id: req.authUser.id },
      select: { totpEnabledAt: true, totpRecoveryCodes: true, role: true }
    });
    return {
      enabled: Boolean(user?.totpEnabledAt),
      enabledAt: user?.totpEnabledAt ?? null,
      recoveryCodesLeft: stringList(user?.totpRecoveryCodes).length,
      required: mfaRequiredForStaff && MFA_ROLES.includes(user?.role || "USER"),
      sessionVerified: Boolean(req.authUser.mfa)
    };
  });
  app2.post("/me/mfa/setup", limited, async (req, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: req.authUser.id },
      select: { email: true, totpEnabledAt: true }
    });
    if (!user) return reply.code(404).send({ error: "Usu\xE1rio n\xE3o encontrado" });
    if (user.totpEnabledAt) return reply.code(409).send({ error: "A verifica\xE7\xE3o em duas etapas j\xE1 est\xE1 ativa." });
    const secret2 = generateTotpSecret();
    await prisma.user.update({ where: { id: req.authUser.id }, data: { totpPendingSecret: seal(secret2) } });
    const url = otpauthUrl(secret2, user.email, env.MFA_ISSUER);
    const qrCode = await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: "M" });
    reply.header("cache-control", "no-store");
    return { secret: secret2, otpauthUrl: url, qrCode };
  });
  app2.post("/me/mfa/enable", limited, async (req, reply) => {
    const { code } = z13.object({ code: z13.string().trim().min(6).max(10) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.authUser.id } });
    if (!user?.totpPendingSecret) return reply.code(400).send({ error: "Inicie a configura\xE7\xE3o novamente." });
    const secret2 = open(user.totpPendingSecret);
    const step = verifyTotp(secret2, code);
    if (step == null)
      return reply.code(400).send({ error: "C\xF3digo inv\xE1lido. Confira o hor\xE1rio do celular.", code: "MFA_INVALID" });
    const recoveryCodes = generateRecoveryCodes();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecret: seal(secret2),
        totpPendingSecret: null,
        totpEnabledAt: /* @__PURE__ */ new Date(),
        totpLastStep: step,
        totpRecoveryCodes: recoveryCodes.map((c) => sha256(c))
      }
    });
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: /* @__PURE__ */ new Date() }
    });
    await issueTokens(app2, user, req, reply, { mfa: true });
    req.log.info({ userId: user.id }, "2FA ativado");
    reply.header("cache-control", "no-store");
    return { enabled: true, recoveryCodes };
  });
  app2.post("/me/mfa/recovery-codes", limited, async (req, reply) => {
    const { code } = z13.object({ code: z13.string().trim().min(6).max(10) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.authUser.id } });
    if (!user?.totpSecret) return reply.code(400).send({ error: "A verifica\xE7\xE3o em duas etapas n\xE3o est\xE1 ativa." });
    const step = verifyTotp(open(user.totpSecret), code, user.totpLastStep);
    if (step == null) return reply.code(400).send({ error: "C\xF3digo inv\xE1lido.", code: "MFA_INVALID" });
    const recoveryCodes = generateRecoveryCodes();
    await prisma.user.update({
      where: { id: user.id },
      data: { totpLastStep: step, totpRecoveryCodes: recoveryCodes.map((c) => sha256(c)) }
    });
    reply.header("cache-control", "no-store");
    return { recoveryCodes };
  });
  app2.post("/me/mfa/disable", limited, async (req, reply) => {
    const { password, code } = z13.object({ password: z13.string().min(1).max(128), code: z13.string().trim().min(6).max(10) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.authUser.id } });
    if (!user?.totpSecret) return reply.code(400).send({ error: "A verifica\xE7\xE3o em duas etapas n\xE3o est\xE1 ativa." });
    if (mfaRequiredForStaff && MFA_ROLES.includes(user.role))
      return reply.code(403).send({ error: "Contas de administra\xE7\xE3o e edi\xE7\xE3o precisam manter o 2FA ativo." });
    if (!await verifyPassword(user.passwordHash, password)) return reply.code(403).send({ error: "Senha incorreta" });
    if (verifyTotp(open(user.totpSecret), code, user.totpLastStep) == null)
      return reply.code(400).send({ error: "C\xF3digo inv\xE1lido.", code: "MFA_INVALID" });
    await prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecret: null,
        totpPendingSecret: null,
        totpEnabledAt: null,
        totpLastStep: null,
        totpRecoveryCodes: []
      }
    });
    req.log.warn({ userId: user.id }, "2FA desativado");
    return { enabled: false };
  });
};
var mfa_default = mfaRoutes;

// src/routes/engagement.ts
import { z as z14 } from "zod";
var TOPIC = z14.string().regex(/^(news|releases|cat:[a-z0-9]{8,40})$/);
var engagementRoutes = async (app2) => {
  async function validCategoryIds(ids) {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const rows = await prisma.category.findMany({ where: { id: { in: unique } }, select: { id: true } });
    return rows.map((r) => r.id);
  }
  app2.post(
    "/newsletter/subscribe",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const body = z14.object({
        email: z14.string().email().max(254),
        categoryIds: z14.array(z14.string().max(40)).max(50).default([]),
        captchaToken: z14.string().max(2048).optional(),
        consent: z14.literal(true, { message: "\xC9 necess\xE1rio concordar em receber a newsletter." })
      }).parse(req.body);
      const viewer = await optionalUser(req);
      if (!viewer && !await verifyCaptcha(body.captchaToken, clientIp(req))) throw captchaError();
      const email = body.email.toLowerCase();
      const categoryIds = await validCategoryIds(body.categoryIds);
      const user = viewer ? await prisma.user.findUnique({ where: { id: viewer.id }, select: { email: true, emailVerifiedAt: true } }) : null;
      const verifiedOwner = !!user && user.email === email && !!user.emailVerifiedAt;
      const existing = await prisma.newsletterSubscription.findUnique({ where: { email } });
      if (existing?.status === "CONFIRMED") {
        await prisma.newsletterSubscription.update({ where: { email }, data: { categoryIds } });
        return { status: "confirmed" };
      }
      const raw = randomToken();
      const data = {
        categoryIds,
        userId: verifiedOwner ? viewer.id : existing?.userId ?? null,
        status: verifiedOwner ? "CONFIRMED" : "PENDING",
        confirmTokenHash: verifiedOwner ? null : sha256(raw),
        confirmTokenExpiresAt: verifiedOwner ? null : new Date(Date.now() + 48 * 36e5),
        confirmedAt: verifiedOwner ? /* @__PURE__ */ new Date() : null,
        unsubscribedAt: null,
        consentIp: sha256(`${clientIp(req)}`).slice(0, 32)
      };
      await prisma.newsletterSubscription.upsert({
        where: { email },
        create: { email, unsubscribeToken: randomToken(), ...data },
        update: data
      });
      if (!verifiedOwner) await sendConfirmationEmail(email, raw);
      return reply.code(202).send({ status: verifiedOwner ? "confirmed" : "pending" });
    }
  );
  app2.post(
    "/newsletter/confirm",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const { token } = z14.object({ token: z14.string().min(20).max(200) }).parse(req.body);
      const sub = await prisma.newsletterSubscription.findUnique({ where: { confirmTokenHash: sha256(token) } });
      if (!sub || !sub.confirmTokenExpiresAt || sub.confirmTokenExpiresAt < /* @__PURE__ */ new Date())
        return reply.code(400).send({ error: "Link inv\xE1lido ou expirado. Inscreva-se novamente." });
      await prisma.newsletterSubscription.update({
        where: { id: sub.id },
        data: { status: "CONFIRMED", confirmedAt: /* @__PURE__ */ new Date(), confirmTokenHash: null, confirmTokenExpiresAt: null }
      });
      return { status: "confirmed", unsubscribeUrl: unsubscribeLinks(sub.unsubscribeToken).url };
    }
  );
  const unsubscribe = async (token) => {
    const sub = await prisma.newsletterSubscription.findUnique({ where: { unsubscribeToken: token } });
    if (!sub) return false;
    await prisma.newsletterSubscription.update({
      where: { id: sub.id },
      data: { status: "UNSUBSCRIBED", unsubscribedAt: /* @__PURE__ */ new Date() }
    });
    return true;
  };
  app2.post(
    "/newsletter/unsubscribe",
    { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const q = z14.object({ token: z14.string().min(20).max(200).optional() }).parse(req.query ?? {});
      const b = z14.object({ token: z14.string().min(20).max(200).optional() }).parse(typeof req.body === "object" && req.body ? req.body : {});
      const token = b.token || q.token;
      if (!token || !await unsubscribe(token)) return reply.code(404).send({ error: "Inscri\xE7\xE3o n\xE3o encontrada." });
      return { status: "unsubscribed" };
    }
  );
  app2.get("/newsletter/me", { preHandler: authenticate }, async (req) => {
    const user = await prisma.user.findUnique({ where: { id: req.authUser.id }, select: { email: true } });
    const sub = user ? await prisma.newsletterSubscription.findFirst({
      where: { OR: [{ userId: req.authUser.id }, { email: user.email }] },
      select: { status: true, categoryIds: true, email: true, confirmedAt: true }
    }) : null;
    return { subscription: sub, email: user?.email };
  });
  app2.put(
    "/newsletter/me",
    { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const body = z14.object({ subscribed: z14.boolean(), categoryIds: z14.array(z14.string().max(40)).max(50).default([]) }).parse(req.body);
      const user = await prisma.user.findUnique({
        where: { id: req.authUser.id },
        select: { id: true, email: true, emailVerifiedAt: true }
      });
      if (!user) return reply.code(404).send({ error: "Usu\xE1rio n\xE3o encontrado" });
      const categoryIds = await validCategoryIds(body.categoryIds);
      const existing = await prisma.newsletterSubscription.findUnique({ where: { email: user.email } });
      if (!body.subscribed) {
        if (existing)
          await prisma.newsletterSubscription.update({
            where: { id: existing.id },
            data: { status: "UNSUBSCRIBED", unsubscribedAt: /* @__PURE__ */ new Date(), categoryIds }
          });
        return { status: "unsubscribed" };
      }
      const raw = randomToken();
      const confirmed = !!user.emailVerifiedAt;
      const data = {
        userId: user.id,
        categoryIds,
        status: confirmed ? "CONFIRMED" : "PENDING",
        confirmedAt: confirmed ? existing?.confirmedAt || /* @__PURE__ */ new Date() : null,
        confirmTokenHash: confirmed ? null : sha256(raw),
        confirmTokenExpiresAt: confirmed ? null : new Date(Date.now() + 48 * 36e5),
        unsubscribedAt: null
      };
      await prisma.newsletterSubscription.upsert({
        where: { email: user.email },
        create: { email: user.email, unsubscribeToken: randomToken(), ...data },
        update: data
      });
      if (!confirmed) await sendConfirmationEmail(user.email, raw);
      return { status: confirmed ? "confirmed" : "pending" };
    }
  );
  app2.get("/push/public-key", async () => ({
    enabled: pushEnabled(),
    publicKey: pushEnabled() ? env.VAPID_PUBLIC_KEY : null
  }));
  const subscriptionSchema = z14.object({
    endpoint: z14.string().url().max(1e3),
    keys: z14.object({ p256dh: z14.string().min(20).max(200), auth: z14.string().min(8).max(100) }),
    topics: z14.array(TOPIC).max(60).default(["news"])
  });
  app2.post("/push/subscribe", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
    if (!pushEnabled()) return reply.code(503).send({ error: "Notifica\xE7\xF5es push n\xE3o configuradas." });
    const body = subscriptionSchema.parse(req.body);
    if (!isAllowedPushEndpoint(body.endpoint)) return reply.code(400).send({ error: "Servi\xE7o de push n\xE3o suportado." });
    const viewer = await optionalUser(req);
    const topics = [...new Set(body.topics)].filter((t) => viewer || t !== "releases");
    const data = {
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      topics,
      userId: viewer?.id ?? null,
      userAgent: String(req.headers["user-agent"] || "").slice(0, 200),
      failures: 0
    };
    await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: { endpoint: body.endpoint, ...data },
      update: data
    });
    return { ok: true, topics };
  });
  app2.post("/push/unsubscribe", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (req) => {
    const { endpoint } = z14.object({ endpoint: z14.string().url().max(1e3) }).parse(req.body);
    await prisma.pushSubscription.deleteMany({ where: { endpoint } });
    return { ok: true };
  });
  app2.post("/push/status", async (req) => {
    const { endpoint } = z14.object({ endpoint: z14.string().url().max(1e3) }).parse(req.body);
    const sub = await prisma.pushSubscription.findUnique({ where: { endpoint }, select: { topics: true } });
    return { subscribed: !!sub, topics: stringList(sub?.topics) };
  });
};
var engagement_default = engagementRoutes;

// src/routes/social-catalog.ts
import { z as z16 } from "zod";

// src/lib/catalog-ref.ts
import { z as z15 } from "zod";
var catalogRefSchema = z15.union([
  z15.object({ catalogItemId: z15.string().min(1).max(40) }),
  z15.object({
    provider: z15.enum(["TMDB", "IGDB", "ANILIST"]),
    mediaType: z15.enum(mediaTypes),
    externalId: z15.string().min(1).max(120)
  })
]);
async function resolveCatalogItem(ref) {
  if ("catalogItemId" in ref) {
    return prisma.mediaCatalogItem.findUnique({ where: { id: ref.catalogItemId }, select: { id: true, title: true } });
  }
  const details = await getCatalogDetails(ref.provider, ref.mediaType, ref.externalId);
  if (!details) return null;
  const cached = await cacheCatalogItem(details);
  return { id: cached.id, title: details.title };
}
var catalogCardSelect = {
  id: true,
  provider: true,
  externalId: true,
  mediaType: true,
  title: true,
  coverUrl: true,
  releaseDate: true
};

// src/routes/social-catalog.ts
var userCard = { id: true, name: true, username: true, avatarUrl: true, level: true };
var isStaff = (role) => role === "ADMIN" || role === "MODERATOR";
function httpError(message, statusCode, code) {
  const e = new Error(message);
  e.statusCode = statusCode;
  e.code = code;
  return e;
}
var socialCatalogRoutes = async (app2) => {
  app2.get("/catalog/items/:id/reviews", async (req) => {
    const { id } = z16.object({ id: z16.string().min(1).max(40) }).parse(req.params);
    const { page } = z16.object({ page: z16.coerce.number().int().min(1).max(500).default(1) }).parse(req.query);
    const viewer = await optionalUser(req);
    const where = { catalogItemId: id, hiddenAt: null };
    const [agg, groups, items, mine] = await Promise.all([
      prisma.catalogReview.aggregate({ where, _avg: { rating: true }, _count: { _all: true } }),
      prisma.catalogReview.groupBy({ by: ["rating"], where, _count: { _all: true } }),
      prisma.catalogReview.findMany({
        where,
        include: { user: { select: userCard } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * 20,
        take: 20
      }),
      viewer ? prisma.catalogReview.findUnique({ where: { catalogItemId_userId: { catalogItemId: id, userId: viewer.id } } }) : null
    ]);
    const distribution = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, 0]));
    for (const g of groups) distribution[g.rating] = g._count._all;
    return {
      summary: {
        average: agg._avg.rating ? Number(agg._avg.rating.toFixed(1)) : null,
        count: agg._count._all,
        distribution
      },
      items,
      viewerReview: mine,
      page
    };
  });
  app2.put(
    "/catalog/items/:id/reviews",
    { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req) => {
      const { id } = z16.object({ id: z16.string().min(1).max(40) }).parse(req.params);
      const body = z16.object({
        rating: z16.number().int().min(1).max(10),
        title: z16.string().trim().max(120).optional().nullable(),
        body: z16.string().trim().max(5e3).optional().nullable(),
        spoiler: z16.boolean().default(false)
      }).parse(req.body);
      await assertVerifiedEmail(req.authUser.id);
      const item = await prisma.mediaCatalogItem.findUnique({ where: { id }, select: { id: true } });
      if (!item) throw httpError("Item do cat\xE1logo n\xE3o encontrado", 404);
      const data = { rating: body.rating, title: body.title || null, body: body.body || null, spoiler: body.spoiler };
      return prisma.catalogReview.upsert({
        where: { catalogItemId_userId: { catalogItemId: id, userId: req.authUser.id } },
        create: { catalogItemId: id, userId: req.authUser.id, ...data },
        update: data,
        include: { user: { select: userCard } }
      });
    }
  );
  app2.delete("/catalog/items/:id/reviews", { preHandler: authenticate }, async (req, reply) => {
    const { id } = z16.object({ id: z16.string().min(1).max(40) }).parse(req.params);
    await prisma.catalogReview.deleteMany({ where: { catalogItemId: id, userId: req.authUser.id } });
    return reply.code(204).send();
  });
  app2.delete("/reviews/:id", { preHandler: authenticate }, async (req, reply) => {
    const { id } = z16.object({ id: z16.string().min(1).max(40) }).parse(req.params);
    const review = await prisma.catalogReview.findUnique({ where: { id }, select: { userId: true } });
    if (!review) return reply.code(404).send({ error: "Avalia\xE7\xE3o n\xE3o encontrada" });
    if (review.userId !== req.authUser.id && !isStaff(req.authUser.role))
      return reply.code(403).send({ error: "Acesso negado" });
    if (review.userId === req.authUser.id) await prisma.catalogReview.delete({ where: { id } });
    else await prisma.catalogReview.update({ where: { id }, data: { hiddenAt: /* @__PURE__ */ new Date() } });
    return reply.code(204).send();
  });
  app2.get(
    "/catalog/:provider/:type/:externalId/watch-providers",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { provider, type, externalId } = z16.object({
        provider: z16.enum(["TMDB", "IGDB", "ANILIST"]),
        type: z16.enum(mediaTypes),
        externalId: z16.string().min(1).max(120)
      }).parse(req.params);
      const { region } = z16.object({
        region: z16.string().regex(/^[A-Z]{2}$/).optional()
      }).parse(req.query);
      const data = await getWatchProviders(provider, type, externalId, region);
      reply.header("cache-control", "public, max-age=3600");
      return { available: !!data, providers: data, attribution: "JustWatch" };
    }
  );
  const threadSelect = {
    id: true,
    kind: true,
    title: true,
    description: true,
    season: true,
    episode: true,
    startsAt: true,
    lockedAt: true,
    lastMessageAt: true,
    createdAt: true,
    createdBy: { select: userCard },
    catalogItem: { select: catalogCardSelect },
    _count: { select: { messages: true } }
  };
  app2.get("/catalog/items/:id/threads", async (req) => {
    const { id } = z16.object({ id: z16.string().min(1).max(40) }).parse(req.params);
    return prisma.discussionThread.findMany({
      where: { catalogItemId: id },
      select: threadSelect,
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 50
    });
  });
  app2.get("/threads", async (req) => {
    const q = z16.object({
      kind: z16.enum(["EPISODE", "WATCH_PARTY", "GENERAL"]).optional(),
      upcoming: z16.enum(["1", "true"]).optional()
    }).parse(req.query);
    return prisma.discussionThread.findMany({
      where: {
        ...q.kind ? { kind: q.kind } : {},
        ...q.upcoming ? { startsAt: { gte: new Date(Date.now() - 3 * 36e5) } } : {}
      },
      select: threadSelect,
      orderBy: q.upcoming ? { startsAt: "asc" } : { createdAt: "desc" },
      take: 50
    });
  });
  app2.post(
    "/threads",
    { preHandler: authenticate, config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const body = z16.object({
        catalogItemId: z16.string().min(1).max(40).optional().nullable(),
        kind: z16.enum(["EPISODE", "WATCH_PARTY", "GENERAL"]).default("GENERAL"),
        title: z16.string().trim().min(3).max(160),
        description: z16.string().trim().max(2e3).optional().nullable(),
        season: z16.number().int().min(0).max(200).optional().nullable(),
        episode: z16.number().int().min(0).max(5e3).optional().nullable(),
        startsAt: z16.string().datetime().optional().nullable()
      }).parse(req.body);
      await assertVerifiedEmail(req.authUser.id);
      if (body.kind === "WATCH_PARTY" && (!body.startsAt || new Date(body.startsAt) < new Date(Date.now() - 6e4)))
        return reply.code(400).send({ error: "Informe uma data futura para a watch party." });
      if (body.catalogItemId && !await prisma.mediaCatalogItem.findUnique({ where: { id: body.catalogItemId }, select: { id: true } }))
        return reply.code(404).send({ error: "Item do cat\xE1logo n\xE3o encontrado" });
      const thread = await prisma.discussionThread.create({
        data: {
          catalogItemId: body.catalogItemId || null,
          kind: body.kind,
          title: body.title,
          description: body.description || null,
          season: body.season ?? null,
          episode: body.episode ?? null,
          startsAt: body.startsAt ? new Date(body.startsAt) : null,
          createdById: req.authUser.id
        },
        select: threadSelect
      });
      return reply.code(201).send(thread);
    }
  );
  app2.get("/threads/:id", async (req, reply) => {
    const { id } = z16.object({ id: z16.string().min(1).max(40) }).parse(req.params);
    const thread = await prisma.discussionThread.findUnique({ where: { id }, select: threadSelect });
    if (!thread) return reply.code(404).send({ error: "Discuss\xE3o n\xE3o encontrada" });
    return thread;
  });
  app2.get("/threads/:id/messages", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = z16.object({ id: z16.string().min(1).max(40) }).parse(req.params);
    const q = z16.object({ after: z16.string().datetime().optional() }).parse(req.query);
    const rows = await prisma.threadMessage.findMany({
      where: { threadId: id, ...q.after ? { createdAt: { gt: new Date(q.after) } } : {} },
      include: { user: { select: userCard } },
      orderBy: { createdAt: q.after ? "asc" : "desc" },
      take: q.after ? 200 : 100
    });
    const items = q.after ? rows : rows.reverse();
    return items.map((m) => m.hiddenAt ? { ...m, content: "", hidden: true } : { ...m, hidden: false });
  });
  app2.post(
    "/threads/:id/messages",
    { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { id } = z16.object({ id: z16.string().min(1).max(40) }).parse(req.params);
      const body = z16.object({ content: z16.string().trim().min(1).max(2e3), spoiler: z16.boolean().default(false) }).parse(req.body);
      await assertVerifiedEmail(req.authUser.id);
      const thread = await prisma.discussionThread.findUnique({ where: { id }, select: { id: true, lockedAt: true } });
      if (!thread) return reply.code(404).send({ error: "Discuss\xE3o n\xE3o encontrada" });
      if (thread.lockedAt) return reply.code(423).send({ error: "Esta discuss\xE3o est\xE1 trancada." });
      const [message] = await prisma.$transaction([
        prisma.threadMessage.create({
          data: { threadId: id, userId: req.authUser.id, content: body.content, spoiler: body.spoiler },
          include: { user: { select: userCard } }
        }),
        prisma.discussionThread.update({ where: { id }, data: { lastMessageAt: /* @__PURE__ */ new Date() } })
      ]);
      return reply.code(201).send({ ...message, hidden: false });
    }
  );
  app2.delete("/threads/messages/:id", { preHandler: authenticate }, async (req, reply) => {
    const { id } = z16.object({ id: z16.string().min(1).max(40) }).parse(req.params);
    const msg = await prisma.threadMessage.findUnique({ where: { id }, select: { userId: true } });
    if (!msg) return reply.code(404).send({ error: "Mensagem n\xE3o encontrada" });
    if (msg.userId !== req.authUser.id && !isStaff(req.authUser.role))
      return reply.code(403).send({ error: "Acesso negado" });
    await prisma.threadMessage.update({ where: { id }, data: { hiddenAt: /* @__PURE__ */ new Date() } });
    return reply.code(204).send();
  });
  app2.patch("/threads/:id/lock", { preHandler: authenticate }, async (req, reply) => {
    const { id } = z16.object({ id: z16.string().min(1).max(40) }).parse(req.params);
    const { locked } = z16.object({ locked: z16.boolean() }).parse(req.body);
    const thread = await prisma.discussionThread.findUnique({ where: { id }, select: { createdById: true } });
    if (!thread) return reply.code(404).send({ error: "Discuss\xE3o n\xE3o encontrada" });
    if (thread.createdById !== req.authUser.id && !isStaff(req.authUser.role))
      return reply.code(403).send({ error: "Acesso negado" });
    return prisma.discussionThread.update({
      where: { id },
      data: { lockedAt: locked ? /* @__PURE__ */ new Date() : null },
      select: threadSelect
    });
  });
  const listSelect = {
    id: true,
    title: true,
    slug: true,
    description: true,
    isPublic: true,
    viewCount: true,
    createdAt: true,
    updatedAt: true,
    user: { select: userCard },
    _count: { select: { items: true } },
    items: {
      take: 4,
      orderBy: { position: "asc" },
      select: { catalogItem: { select: { coverUrl: true, title: true } } }
    }
  };
  async function uniqueListSlug(userId, title, currentId) {
    const base = slugify(title).slice(0, 80) || "lista";
    for (let i = 0; i < 50; i++) {
      const slug = i ? `${base}-${i + 1}` : base;
      const row = await prisma.userList.findUnique({ where: { userId_slug: { userId, slug } }, select: { id: true } });
      if (!row || row.id === currentId) return slug;
    }
    return `${base}-${Date.now().toString(36)}`;
  }
  async function ownedList(id, userId) {
    const list = await prisma.userList.findUnique({ where: { id }, select: { id: true, userId: true } });
    if (!list) throw httpError("Lista n\xE3o encontrada", 404);
    if (list.userId !== userId) throw httpError("Acesso negado", 403);
    return list;
  }
  app2.get("/lists", async (req) => {
    const q = z16.object({
      sort: z16.enum(["recent", "popular"]).default("recent"),
      page: z16.coerce.number().int().min(1).max(200).default(1)
    }).parse(req.query);
    const where = { isPublic: true, items: { some: {} } };
    const [items, total] = await Promise.all([
      prisma.userList.findMany({
        where,
        select: listSelect,
        orderBy: q.sort === "popular" ? [{ viewCount: "desc" }, { updatedAt: "desc" }] : { updatedAt: "desc" },
        skip: (q.page - 1) * 24,
        take: 24
      }),
      prisma.userList.count({ where })
    ]);
    return { items, total, page: q.page, pages: Math.max(1, Math.ceil(total / 24)) };
  });
  app2.get("/sitemap/lists", async (_req, reply) => {
    const items = await prisma.userList.findMany({
      where: { isPublic: true, items: { some: {} } },
      select: { id: true, slug: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 5e3
    });
    reply.header("cache-control", "public, max-age=900");
    return { items };
  });
  app2.get(
    "/lists/mine",
    { preHandler: authenticate },
    async (req) => prisma.userList.findMany({
      where: { userId: req.authUser.id },
      select: listSelect,
      orderBy: { updatedAt: "desc" }
    })
  );
  app2.get("/users/:username/lists", async (req) => {
    const { username } = z16.object({ username: z16.string().max(40) }).parse(req.params);
    return prisma.userList.findMany({
      where: { isPublic: true, user: { username, status: "ACTIVE" } },
      select: listSelect,
      orderBy: { updatedAt: "desc" },
      take: 50
    });
  });
  app2.get("/lists/:id", async (req, reply) => {
    const { id } = z16.object({ id: z16.string().min(1).max(40) }).parse(req.params);
    const viewer = await optionalUser(req);
    const list = await prisma.userList.findUnique({
      where: { id },
      select: {
        ...listSelect,
        userId: true,
        items: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            note: true,
            position: true,
            catalogItem: { select: { ...catalogCardSelect, description: true, rating: true } }
          }
        }
      }
    });
    if (!list || !list.isPublic && list.userId !== viewer?.id)
      return reply.code(404).send({ error: "Lista n\xE3o encontrada" });
    const { userId, ...rest } = list;
    return { ...rest, isOwner: userId === viewer?.id };
  });
  app2.post("/lists/:id/view", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = z16.object({ id: z16.string().min(1).max(40) }).parse(req.params);
    const viewer = await optionalUser(req);
    const key2 = `list:seen:${id}:${viewerKey(viewer?.id, clientIp(req), String(req.headers["user-agent"] || ""))}`;
    const fresh = await redis.set(key2, "1", "EX", 86400, "NX").catch(() => null);
    if (fresh)
      await prisma.userList.updateMany({
        where: { id, isPublic: true, NOT: { userId: viewer?.id ?? "" } },
        data: { viewCount: { increment: 1 } }
      });
    return { ok: true };
  });
  const listBody = z16.object({
    title: z16.string().trim().min(3).max(120),
    description: z16.string().trim().max(1e3).optional().nullable(),
    isPublic: z16.boolean().default(true)
  });
  app2.post(
    "/lists",
    { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const body = listBody.parse(req.body);
      if (body.isPublic) await assertVerifiedEmail(req.authUser.id);
      const count = await prisma.userList.count({ where: { userId: req.authUser.id } });
      if (count >= 100) return reply.code(400).send({ error: "Limite de 100 listas atingido." });
      const list = await prisma.userList.create({
        data: {
          userId: req.authUser.id,
          title: body.title,
          description: body.description || null,
          isPublic: body.isPublic,
          slug: await uniqueListSlug(req.authUser.id, body.title)
        },
        select: listSelect
      });
      return reply.code(201).send(list);
    }
  );
  app2.patch("/lists/:id", { preHandler: authenticate }, async (req) => {
    const { id } = z16.object({ id: z16.string().min(1).max(40) }).parse(req.params);
    const body = listBody.partial().parse(req.body);
    await ownedList(id, req.authUser.id);
    if (body.isPublic) await assertVerifiedEmail(req.authUser.id);
    return prisma.userList.update({
      where: { id },
      data: {
        ...body.title ? { title: body.title, slug: await uniqueListSlug(req.authUser.id, body.title, id) } : {},
        ...body.description !== void 0 ? { description: body.description || null } : {},
        ...body.isPublic !== void 0 ? { isPublic: body.isPublic } : {}
      },
      select: listSelect
    });
  });
  app2.delete("/lists/:id", { preHandler: authenticate }, async (req, reply) => {
    const { id } = z16.object({ id: z16.string().min(1).max(40) }).parse(req.params);
    await ownedList(id, req.authUser.id);
    await prisma.userList.delete({ where: { id } });
    return reply.code(204).send();
  });
  app2.post(
    "/lists/:id/items",
    { preHandler: authenticate, config: { rateLimit: { max: 60, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const { id } = z16.object({ id: z16.string().min(1).max(40) }).parse(req.params);
      const body = z16.intersection(catalogRefSchema, z16.object({ note: z16.string().trim().max(500).optional().nullable() })).parse(req.body);
      await ownedList(id, req.authUser.id);
      const total = await prisma.userListItem.count({ where: { listId: id } });
      if (total >= 500) return reply.code(400).send({ error: "Uma lista pode ter at\xE9 500 itens." });
      const item = await resolveCatalogItem(body);
      if (!item) return reply.code(404).send({ error: "Item do cat\xE1logo n\xE3o encontrado" });
      const row = await prisma.userListItem.upsert({
        where: { listId_catalogItemId: { listId: id, catalogItemId: item.id } },
        create: { listId: id, catalogItemId: item.id, position: total, note: body.note || null },
        update: { note: body.note ?? void 0 },
        select: { id: true, position: true, note: true, catalogItem: { select: catalogCardSelect } }
      });
      await prisma.userList.update({ where: { id }, data: { updatedAt: /* @__PURE__ */ new Date() } });
      return reply.code(201).send(row);
    }
  );
  app2.delete("/lists/:id/items/:itemId", { preHandler: authenticate }, async (req, reply) => {
    const { id, itemId } = z16.object({ id: z16.string().min(1).max(40), itemId: z16.string().min(1).max(40) }).parse(req.params);
    await ownedList(id, req.authUser.id);
    await prisma.userListItem.deleteMany({ where: { id: itemId, listId: id } });
    return reply.code(204).send();
  });
  app2.put("/lists/:id/order", { preHandler: authenticate }, async (req) => {
    const { id } = z16.object({ id: z16.string().min(1).max(40) }).parse(req.params);
    const { itemIds } = z16.object({ itemIds: z16.array(z16.string().min(1).max(40)).max(500) }).parse(req.body);
    await ownedList(id, req.authUser.id);
    await prisma.$transaction(
      itemIds.map(
        (itemId, position) => prisma.userListItem.updateMany({ where: { id: itemId, listId: id }, data: { position } })
      )
    );
    return { ok: true };
  });
};
var social_catalog_default = socialCatalogRoutes;

// src/routes/community-moderation.ts
import { z as z17 } from "zod";
var communityModerationRoutes = async (app2) => {
  app2.get("/community-mod/status", { preHandler: authenticate }, async (req) => ({
    ...await moderationEligibility(req.authUser.id),
    rules: COMMUNITY_MOD
  }));
  app2.get("/community-mod/queue", { preHandler: authenticate }, async (req, reply) => {
    const status = await moderationEligibility(req.authUser.id);
    if (!status.eligible)
      return reply.code(403).send({ error: "Voc\xEA ainda n\xE3o pode participar da triagem.", reasons: status.reasons });
    const userId = req.authUser.id;
    const reports = await prisma.commentReport.findMany({
      where: {
        status: "OPEN",
        reporterId: { not: userId },
        comment: { userId: { not: userId }, hiddenAt: null },
        votes: { none: { userId } }
      },
      select: {
        id: true,
        reason: true,
        details: true,
        createdAt: true,
        comment: {
          select: { id: true, content: true, createdAt: true, post: { select: { title: true, slug: true } } }
        },
        _count: { select: { votes: true } }
      },
      orderBy: { createdAt: "asc" },
      take: 20
    });
    return { items: reports, weight: status.weight, reputation: status.reputation };
  });
  app2.post(
    "/community-mod/reports/:id/vote",
    { preHandler: authenticate, config: { rateLimit: { max: 60, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const { id } = z17.object({ id: z17.string().min(1).max(40) }).parse(req.params);
      const { verdict } = z17.object({ verdict: z17.enum(["VIOLATES", "OK"]) }).parse(req.body);
      const status = await moderationEligibility(req.authUser.id);
      if (!status.eligible) return reply.code(403).send({ error: "Voc\xEA ainda n\xE3o pode participar da triagem." });
      const report = await prisma.commentReport.findUnique({
        where: { id },
        select: { status: true, reporterId: true, comment: { select: { userId: true } } }
      });
      if (!report || report.status !== "OPEN") return reply.code(404).send({ error: "Den\xFAncia n\xE3o est\xE1 mais aberta." });
      if (report.reporterId === req.authUser.id || report.comment.userId === req.authUser.id)
        return reply.code(403).send({ error: "Voc\xEA n\xE3o pode votar nesta den\xFAncia." });
      try {
        await prisma.reportVote.create({
          data: { reportId: id, userId: req.authUser.id, verdict, weight: status.weight }
        });
      } catch {
        return reply.code(409).send({ error: "Voc\xEA j\xE1 votou nesta den\xFAncia." });
      }
      return evaluateReport(id);
    }
  );
};
var community_moderation_default = communityModerationRoutes;

// src/routes/revenue.ts
import { z as z18 } from "zod";

// src/services/revenue.ts
import Stripe2 from "stripe";
var stripe2 = env.STRIPE_SECRET_KEY ? new Stripe2(env.STRIPE_SECRET_KEY) : null;
async function stripeSummary() {
  if (!stripe2) return { configured: false };
  const monthly = (amount, interval, count) => {
    const per = { day: 365 / 12, week: 52 / 12, month: 1, year: 1 / 12 }[interval] ?? 1;
    return amount * per / Math.max(1, count);
  };
  let mrrCents = 0;
  let active = 0;
  let currency = "brl";
  for await (const sub of stripe2.subscriptions.list({ status: "active", limit: 100 })) {
    active++;
    for (const item of sub.items.data) {
      const price = item.price;
      if (!price?.unit_amount || !price.recurring) continue;
      currency = price.currency;
      mrrCents += monthly(
        price.unit_amount * (item.quantity || 1),
        price.recurring.interval,
        price.recurring.interval_count
      );
    }
    if (active >= 5e3) break;
  }
  const since = Math.floor((Date.now() - 30 * 864e5) / 1e3);
  let revenue30Cents = 0;
  const daily = /* @__PURE__ */ new Map();
  for await (const inv of stripe2.invoices.list({ status: "paid", created: { gte: since }, limit: 100 })) {
    revenue30Cents += inv.amount_paid;
    const day = new Date(inv.created * 1e3).toISOString().slice(0, 10);
    daily.set(day, (daily.get(day) || 0) + inv.amount_paid);
  }
  const canceled30 = await prisma.subscription.count({
    where: { status: "CANCELED", updatedAt: { gte: new Date(since * 1e3) } }
  });
  return {
    configured: true,
    currency: currency.toUpperCase(),
    activeSubscriptions: active,
    mrr: Math.round(mrrCents) / 100,
    revenue30d: revenue30Cents / 100,
    canceled30d: canceled30,
    daily: [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, cents2]) => ({ date, amount: cents2 / 100 }))
  };
}
async function googleAccessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN,
      grant_type: "refresh_token"
    }),
    signal: AbortSignal.timeout(1e4)
  });
  if (!res.ok) throw new Error(`OAuth Google falhou (HTTP ${res.status})`);
  return (await res.json()).access_token;
}
async function adsenseSummary() {
  const configured = Boolean(
    env.ADSENSE_ACCOUNT_ID && env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REFRESH_TOKEN
  );
  if (!configured) return { configured: false };
  const account = env.ADSENSE_ACCOUNT_ID.startsWith("accounts/") ? env.ADSENSE_ACCOUNT_ID : `accounts/${env.ADSENSE_ACCOUNT_ID}`;
  if (!/^accounts\/pub-\d{10,20}$/.test(account))
    return { configured: false, error: "ADSENSE_ACCOUNT_ID inv\xE1lido" };
  const token = await googleAccessToken();
  const url = new URL(`https://adsense.googleapis.com/v2/${account}/reports:generate`);
  url.searchParams.set("dateRange", "LAST_30_DAYS");
  url.searchParams.append("dimensions", "DATE");
  for (const m of ["ESTIMATED_EARNINGS", "PAGE_VIEWS", "PAGE_VIEWS_RPM", "IMPRESSIONS", "CLICKS"])
    url.searchParams.append("metrics", m);
  url.searchParams.set("currencyCode", "BRL");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15e3) });
  if (!res.ok) throw new Error(`AdSense API falhou (HTTP ${res.status})`);
  const data = await res.json();
  const num = (v) => v ? Number(v) : 0;
  const rows = (data.rows || []).map((r) => ({
    date: r.cells[0]?.value || "",
    earnings: num(r.cells[1]?.value),
    pageViews: num(r.cells[2]?.value),
    rpm: num(r.cells[3]?.value),
    impressions: num(r.cells[4]?.value),
    clicks: num(r.cells[5]?.value)
  }));
  const totals = rows.reduce(
    (acc, r) => ({
      earnings: acc.earnings + r.earnings,
      pageViews: acc.pageViews + r.pageViews,
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks
    }),
    { earnings: 0, pageViews: 0, impressions: 0, clicks: 0 }
  );
  return {
    configured: true,
    currency: "BRL",
    rows,
    totals: { ...totals, rpm: totals.pageViews ? totals.earnings / totals.pageViews * 1e3 : 0 }
  };
}
async function revenueOverview(fresh = false) {
  const key2 = "admin:revenue:v1";
  if (!fresh) {
    const cached = await getCache(key2);
    if (cached) return { ...cached, cached: true };
  }
  const since = new Date(Date.now() - 30 * 864e5);
  const [stripeData, adsense, pageViews30d, premiumUsers, affiliateClicks30d] = await Promise.all([
    stripeSummary().catch((error) => ({
      configured: true,
      error: error instanceof Error ? error.message : String(error)
    })),
    adsenseSummary().catch((error) => ({
      configured: true,
      error: error instanceof Error ? error.message : String(error)
    })),
    prisma.analyticsEvent.count({ where: { type: "POST_VIEW", createdAt: { gte: since } } }),
    prisma.subscription.count({ where: { status: "ACTIVE" } }),
    prisma.analyticsEvent.count({ where: { type: "AFFILIATE_CLICK", createdAt: { gte: since } } })
  ]);
  const result = {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    stripe: stripeData,
    adsense,
    site: { pageViews30d, premiumUsers, affiliateClicks30d }
  };
  await setCache(key2, result, 30 * 60);
  return { ...result, cached: false };
}

// src/routes/revenue.ts
var revenueRoutes = async (app2) => {
  app2.get("/admin/revenue", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
    const { fresh } = z18.object({ fresh: z18.enum(["1", "true"]).optional() }).parse(req.query);
    reply.header("cache-control", "no-store");
    return revenueOverview(Boolean(fresh));
  });
  app2.get("/admin/newsletter", { preHandler: requireRole("ADMIN") }, async () => {
    const [confirmed, pending, unsubscribed, push] = await Promise.all([
      prisma.newsletterSubscription.count({ where: { status: "CONFIRMED" } }),
      prisma.newsletterSubscription.count({ where: { status: "PENDING" } }),
      prisma.newsletterSubscription.count({ where: { status: "UNSUBSCRIBED" } }),
      prisma.pushSubscription.count()
    ]);
    return { newsletter: { confirmed, pending, unsubscribed }, pushSubscriptions: push };
  });
  app2.post(
    "/admin/newsletter/send",
    { preHandler: requireRole("ADMIN"), config: { rateLimit: { max: 2, timeWindow: "1 hour" } } },
    async (req) => sendWeeklyDigest(req.log, true)
  );
};
var revenue_default = revenueRoutes;

// src/routes/shop.ts
import { z as z19 } from "zod";
import { nanoid as nanoid2 } from "nanoid";

// src/services/shop.ts
var STORES = [
  { match: /(^|\.)amazon\.[a-z.]+$|(^|\.)amzn\.(to|com)$|(^|\.)a\.co$/i, name: "Amazon" },
  { match: /(^|\.)mercadoli(vre|bre)\.[a-z.]+$|(^|\.)meli\.la$/i, name: "Mercado Livre" },
  { match: /(^|\.)shopee\.[a-z.]+$|(^|\.)shope\.ee$/i, name: "Shopee" },
  { match: /aliexpress\.[a-z.]+$/i, name: "AliExpress" },
  { match: /(^|\.)magazineluiza\.com\.br$|(^|\.)magazinevoce\.com\.br$|(^|\.)magalu\.com(\.br)?$/i, name: "Magalu" },
  { match: /(^|\.)kabum\.com\.br$/i, name: "KaBuM!" },
  { match: /(^|\.)americanas\.com\.br$/i, name: "Americanas" },
  { match: /(^|\.)casasbahia\.com\.br$/i, name: "Casas Bahia" },
  { match: /(^|\.)submarino\.com\.br$/i, name: "Submarino" },
  { match: /(^|\.)netshoes\.com\.br$/i, name: "Netshoes" },
  { match: /(^|\.)nuuvem\.com$/i, name: "Nuuvem" },
  { match: /(^|\.)panini\.com\.br$/i, name: "Panini" },
  { match: /(^|\.)piticas\.com\.br$/i, name: "Piticas" },
  { match: /(^|\.)hotmart\.com$/i, name: "Hotmart" }
];
function detectStore(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    const known = STORES.find((s) => s.match.test(host));
    if (known) return known.name;
    const parts = host.replace(/^www\./, "").split(".");
    const base = parts.length > 2 && parts.at(-2).length <= 3 ? parts.at(-3) : parts.at(-2) || parts[0];
    return base ? base.charAt(0).toUpperCase() + base.slice(1) : "Loja parceira";
  } catch {
    return "Loja parceira";
  }
}
function isAcceptableAffiliateUrl(raw) {
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    return !(host === "localhost" || host.endsWith(".local") || /^(127\.|10\.|192\.168\.|0\.)/.test(host));
  } catch {
    return false;
  }
}

// src/routes/shop.ts
var PUBLIC_CACHE_KEY = "shop:public:v1";
var PUBLIC_CACHE_TTL = 60;
var publicSelect2 = {
  id: true,
  slug: true,
  title: true,
  description: true,
  imageUrl: true,
  store: true,
  category: true,
  badge: true,
  priceCents: true,
  originalPriceCents: true,
  currency: true,
  couponCode: true,
  highlights: true,
  featured: true,
  updatedAt: true
};
var httpUrl = z19.string().trim().max(2048).refine((v) => {
  try {
    return ["http:", "https:"].includes(new URL(v).protocol);
  } catch {
    return false;
  }
}, "Informe uma URL http(s) v\xE1lida");
var optionalText = (max) => z19.string().trim().max(max).nullish().transform((v) => v ? v : null);
var cents = z19.coerce.number().int().min(0).max(1e9).nullish();
var productFields = {
  affiliateUrl: httpUrl,
  title: z19.string().trim().min(2).max(200),
  description: optionalText(1e3),
  imageUrl: z19.union([httpUrl, z19.literal("")]).nullish().transform((v) => v ? v : null),
  store: optionalText(60),
  category: optionalText(60),
  badge: optionalText(40),
  priceCents: cents,
  originalPriceCents: cents,
  currency: z19.string().trim().length(3).toUpperCase(),
  couponCode: optionalText(60),
  highlights: z19.array(z19.string().trim().min(2).max(140)).max(8).nullish(),
  featured: z19.boolean(),
  active: z19.boolean(),
  sortOrder: z19.coerce.number().int().min(-1e4).max(1e4)
};
var productCreate = z19.object({
  ...productFields,
  currency: productFields.currency.default("BRL"),
  featured: productFields.featured.default(false),
  active: productFields.active.default(true),
  sortOrder: productFields.sortOrder.default(0)
});
var productPatch = z19.object(productFields).partial();
async function uniqueSlug(title, ignoreId) {
  const base = slugify(title).slice(0, 80) || "produto";
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? base : `${base}-${nanoid2(6).toLowerCase()}`;
    const exists = await prisma.shopProduct.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!exists || exists.id === ignoreId) return candidate;
  }
  return `${base}-${nanoid2(10).toLowerCase()}`;
}
async function invalidatePublicCache() {
  await delCache("shop:public:*").catch(() => void 0);
}
async function activeProducts() {
  let all = await getCache(PUBLIC_CACHE_KEY).catch(() => null);
  if (!all) {
    all = await prisma.shopProduct.findMany({
      where: { active: true },
      orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
      select: publicSelect2,
      take: 500
    });
    await setCache(PUBLIC_CACHE_KEY, all, PUBLIC_CACHE_TTL).catch(() => void 0);
  }
  return all;
}
async function publicCollections() {
  const key2 = "shop:public:collections";
  const cached = await getCache(key2).catch(() => null);
  if (cached) return cached;
  const rows = await prisma.shopCollection.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] });
  await setCache(key2, rows, PUBLIC_CACHE_TTL).catch(() => void 0);
  return rows;
}
function publicCollection(c) {
  return { slug: c.slug, title: c.title, description: c.description, emoji: c.emoji };
}
function collectionItems(c, all) {
  const manual = stringList(c.productIds);
  const picked = manual.map((id) => all.find((p) => p.id === id)).filter((p) => Boolean(p));
  const hasFilter = Boolean(c.category || c.store || c.maxPriceCents || c.onlyDiscount);
  const filtered = hasFilter ? all.filter(
    (p) => !manual.includes(p.id) && (!c.category || p.category === c.category) && (!c.store || p.store === c.store) && (!c.maxPriceCents || p.priceCents !== null && p.priceCents <= c.maxPriceCents) && (!c.onlyDiscount || p.originalPriceCents !== null && p.priceCents !== null && p.originalPriceCents > p.priceCents)
  ) : [];
  return [...picked, ...filtered];
}
var collectionFields = {
  title: z19.string().trim().min(2).max(120),
  slug: z19.string().trim().max(80).regex(/^[a-z0-9-]*$/, "Use letras min\xFAsculas, n\xFAmeros e h\xEDfen"),
  description: optionalText(1e3),
  emoji: optionalText(16),
  category: optionalText(60),
  store: optionalText(60),
  maxPriceCents: z19.coerce.number().int().min(0).max(1e9).nullish(),
  onlyDiscount: z19.boolean(),
  productIds: z19.array(z19.string().max(40)).max(200),
  active: z19.boolean(),
  showOnShop: z19.boolean(),
  sortOrder: z19.coerce.number().int().min(-1e4).max(1e4)
};
var collectionInput = z19.object({
  ...collectionFields,
  slug: collectionFields.slug.optional(),
  onlyDiscount: collectionFields.onlyDiscount.default(false),
  productIds: collectionFields.productIds.default([]),
  active: collectionFields.active.default(true),
  showOnShop: collectionFields.showOnShop.default(true),
  sortOrder: collectionFields.sortOrder.default(0)
});
var collectionPatch = z19.object(collectionFields).partial();
var shopRoutes = async (app2) => {
  const editor = async (req, reply) => requireRole("EDITOR", "ADMIN")(req, reply);
  app2.get("/shop/products", async (req, reply) => {
    const q = z19.object({
      category: z19.string().trim().max(60).optional(),
      store: z19.string().trim().max(60).optional(),
      q: z19.string().trim().max(80).optional(),
      /** Lista de IDs ou slugs (produtos dentro de artigos): devolve nessa ordem. */
      ids: z19.string().trim().max(1e3).optional()
    }).parse(req.query ?? {});
    reply.header("cache-control", "public, max-age=30, stale-while-revalidate=120");
    const all = await activeProducts();
    if (q.ids) {
      const wanted = q.ids.split(",").map((v) => v.trim()).filter(Boolean).slice(0, 20);
      const items2 = wanted.map((key2) => all.find((p) => p.id === key2 || p.slug === key2)).filter((p) => Boolean(p));
      return { items: items2, categories: [], stores: [], collections: [], total: items2.length };
    }
    const term = q.q?.toLowerCase();
    const items = all.filter(
      (p) => (!q.category || p.category === q.category) && (!q.store || p.store === q.store) && (!term || `${p.title} ${p.description || ""} ${p.store} ${p.category || ""}`.toLowerCase().includes(term))
    );
    const uniq = (values) => [...new Set(values.filter((v) => Boolean(v)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    const collections = await publicCollections();
    return {
      items,
      categories: uniq(all.map((p) => p.category)),
      stores: uniq(all.map((p) => p.store)),
      collections: collections.filter((c) => c.showOnShop).map(({ slug, title, emoji }) => ({ slug, title, emoji })),
      total: items.length
    };
  });
  app2.get("/shop/collections/:slug", async (req, reply) => {
    const { slug } = z19.object({ slug: z19.string().trim().min(1).max(120) }).parse(req.params);
    const collection = (await publicCollections()).find((c) => c.slug === slug);
    if (!collection) return reply.code(404).send({ error: "Cole\xE7\xE3o n\xE3o encontrada" });
    reply.header("cache-control", "public, max-age=30, stale-while-revalidate=120");
    const all = await activeProducts();
    return { collection: publicCollection(collection), items: collectionItems(collection, all) };
  });
  app2.get("/shop/go/:id", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { id } = z19.object({ id: z19.string().min(1).max(120) }).parse(req.params);
    const { src } = z19.object({ src: z19.string().max(300).optional() }).parse(req.query ?? {});
    const source = src && /^\/[A-Za-z0-9/_\-.%]*$/.test(src) ? src : "/shop";
    const product = await prisma.shopProduct.findFirst({
      where: { OR: [{ id }, { slug: id }], active: true },
      select: { id: true, affiliateUrl: true, store: true }
    });
    reply.header("cache-control", "no-store");
    reply.header("x-robots-tag", "noindex, nofollow");
    if (!product) return reply.redirect("/shop", 302);
    let count = true;
    try {
      const viewer = sha256(`${clientIp(req)}|${req.headers["user-agent"] || ""}`).slice(0, 24);
      count = await redis.set(`shop:click:${product.id}:${viewer}`, "1", "EX", 1800, "NX") === "OK";
    } catch {
    }
    if (count) {
      const viewer = await optionalUser(req);
      await prisma.$transaction([
        prisma.shopProduct.update({
          where: { id: product.id },
          data: { clicks: { increment: 1 }, lastClickedAt: /* @__PURE__ */ new Date() }
        }),
        prisma.analyticsEvent.create({
          data: {
            type: "AFFILIATE_CLICK",
            path: source,
            userId: viewer?.id,
            metadata: { store: product.store, productId: product.id, source: "shop" }
          }
        })
      ]).catch((error) => req.log.warn({ err: error }, "Falha ao contabilizar clique da Shop"));
    }
    return reply.redirect(product.affiliateUrl, 302);
  });
  app2.get("/admin/shop/products", { preHandler: editor }, async () => {
    const items = await prisma.shopProduct.findMany({
      orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
      take: 1e3
    });
    const since = new Date(Date.now() - 30 * 864e5);
    const clicks30d = await prisma.analyticsEvent.count({
      where: { type: "AFFILIATE_CLICK", createdAt: { gte: since } }
    });
    return {
      items,
      stats: {
        total: items.length,
        active: items.filter((p) => p.active).length,
        clicks: items.reduce((sum, p) => sum + p.clicks, 0),
        clicks30d,
        alerts: items.filter((p) => ["BROKEN", "OUT_OF_STOCK"].includes(p.checkStatus)).length
      }
    };
  });
  app2.post("/admin/shop/products", { preHandler: editor }, async (req, reply) => {
    const data = productCreate.parse(req.body);
    if (!isAcceptableAffiliateUrl(data.affiliateUrl))
      return reply.code(400).send({ error: "Link de afiliado inv\xE1lido." });
    const product = await prisma.shopProduct.create({
      data: {
        ...data,
        highlights: data.highlights ?? void 0,
        store: data.store || detectStore(data.affiliateUrl),
        slug: await uniqueSlug(data.title),
        createdById: req.authUser.id
      }
    });
    await invalidatePublicCache();
    return reply.code(201).send(product);
  });
  app2.patch("/admin/shop/products/:id", { preHandler: editor }, async (req) => {
    const { id } = z19.object({ id: z19.string().min(1).max(40) }).parse(req.params);
    const body = productPatch.parse(req.body);
    const current = await prisma.shopProduct.findUniqueOrThrow({ where: { id } });
    if (body.affiliateUrl && !isAcceptableAffiliateUrl(body.affiliateUrl))
      throw Object.assign(new Error("Link de afiliado inv\xE1lido."), { statusCode: 400 });
    const { store, highlights, ...data } = body;
    const updated = await prisma.shopProduct.update({
      where: { id },
      data: {
        ...data,
        ...highlights !== void 0 ? { highlights: highlights ?? db_exports.Prisma.DbNull } : {},
        // Mudança manual de visibilidade tira o controle automático.
        ...data.active !== void 0 ? { autoHidden: false } : {},
        // Loja apagada no formulário = detectar de novo pelo domínio do link.
        ...store !== void 0 ? { store: store || detectStore(data.affiliateUrl || current.affiliateUrl) } : {},
        ...data.title && data.title !== current.title ? { slug: await uniqueSlug(data.title, id) } : {}
      }
    });
    await invalidatePublicCache();
    return updated;
  });
  app2.delete("/admin/shop/products/:id", { preHandler: editor }, async (_req, reply) => {
    const { id } = z19.object({ id: z19.string().min(1).max(40) }).parse(_req.params);
    await prisma.shopProduct.delete({ where: { id } });
    await invalidatePublicCache();
    return reply.code(204).send();
  });
  const checkResultInput = z19.object({
    status: z19.enum(["OK", "PRICE_CHANGED", "OUT_OF_STOCK", "BROKEN", "BLOCKED"]),
    message: z19.string().max(500),
    priceCents: z19.number().int().min(0).nullable(),
    originalPriceCents: z19.number().int().min(0).nullable(),
    available: z19.boolean().nullable(),
    checkedAt: z19.string().max(40)
  });
  app2.post("/admin/shop/products/:id/check-result", { preHandler: editor }, async (req) => {
    const { id } = z19.object({ id: z19.string().min(1).max(40) }).parse(req.params);
    const result = checkResultInput.parse(req.body);
    return applyCheckResult(id, result);
  });
  app2.get("/admin/shop/products/:id/history", { preHandler: editor }, async (req) => {
    const { id } = z19.object({ id: z19.string().min(1).max(40) }).parse(req.params);
    return prisma.shopPriceHistory.findMany({ where: { productId: id }, orderBy: { checkedAt: "asc" }, take: 365 });
  });
  app2.get("/admin/shop/report", { preHandler: editor }, async (req) => {
    const { days } = z19.object({ days: z19.coerce.number().int().min(1).max(365).default(30) }).parse(req.query ?? {});
    const since = new Date(Date.now() - days * 864e5);
    const events = await prisma.analyticsEvent.findMany({
      where: { type: "AFFILIATE_CLICK", createdAt: { gte: since } },
      select: { createdAt: true, path: true, metadata: true },
      take: 2e5
    });
    const products = await prisma.shopProduct.findMany({
      select: { id: true, title: true, store: true, imageUrl: true, priceCents: true, clicks: true }
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const perDay = /* @__PURE__ */ new Map();
    const perStore = /* @__PURE__ */ new Map();
    const perProduct = /* @__PURE__ */ new Map();
    const perSource = /* @__PURE__ */ new Map();
    for (const e of events) {
      const day = e.createdAt.toISOString().slice(0, 10);
      perDay.set(day, (perDay.get(day) || 0) + 1);
      const meta = e.metadata || {};
      const store = String(meta.store || "Outros");
      perStore.set(store, (perStore.get(store) || 0) + 1);
      if (typeof meta.productId === "string") perProduct.set(meta.productId, (perProduct.get(meta.productId) || 0) + 1);
      const source = (e.path || "/shop").split("?")[0];
      perSource.set(source, (perSource.get(source) || 0) + 1);
    }
    const days_ = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      days_.push({ day, clicks: perDay.get(day) || 0 });
    }
    const sort = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
    return {
      days,
      total: events.length,
      perDay: days_,
      perStore: sort(perStore).map(([store, clicks]) => ({ store, clicks })),
      perSource: sort(perSource).slice(0, 30).map(([source, clicks]) => ({ source, clicks })),
      topProducts: sort(perProduct).slice(0, 30).map(([id, clicks]) => ({ id, clicks, product: byId.get(id) || null }))
    };
  });
  app2.get("/admin/shop/collections", { preHandler: editor }, async () => {
    const [rows, all] = await Promise.all([
      prisma.shopCollection.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] }),
      prisma.shopProduct.findMany({
        where: { active: true },
        select: { id: true, category: true, store: true, priceCents: true, originalPriceCents: true }
      })
    ]);
    return rows.map((r) => ({ ...r, productIds: stringList(r.productIds), count: collectionItems(r, all).length }));
  });
  async function uniqueCollectionSlug(base, ignoreId) {
    const root = slugify(base).slice(0, 70) || "colecao";
    for (let i = 0; i < 20; i++) {
      const candidate = i === 0 ? root : `${root}-${i + 1}`;
      const exists = await prisma.shopCollection.findUnique({ where: { slug: candidate }, select: { id: true } });
      if (!exists || exists.id === ignoreId) return candidate;
    }
    return `${root}-${nanoid2(6).toLowerCase()}`;
  }
  app2.post("/admin/shop/collections", { preHandler: editor }, async (req, reply) => {
    const body = collectionInput.parse(req.body);
    const created = await prisma.shopCollection.create({
      data: { ...body, slug: await uniqueCollectionSlug(body.slug || body.title) }
    });
    await invalidatePublicCache();
    return reply.code(201).send(created);
  });
  app2.patch("/admin/shop/collections/:id", { preHandler: editor }, async (req) => {
    const { id } = z19.object({ id: z19.string().min(1).max(40) }).parse(req.params);
    const body = collectionPatch.parse(req.body);
    const updated = await prisma.shopCollection.update({
      where: { id },
      data: { ...body, ...body.slug ? { slug: await uniqueCollectionSlug(body.slug, id) } : {} }
    });
    await invalidatePublicCache();
    return updated;
  });
  app2.delete("/admin/shop/collections/:id", { preHandler: editor }, async (req, reply) => {
    const { id } = z19.object({ id: z19.string().min(1).max(40) }).parse(req.params);
    await prisma.shopCollection.delete({ where: { id } });
    await invalidatePublicCache();
    return reply.code(204).send();
  });
};
var shop_default = shopRoutes;

// src/routes/settings.ts
import { z as z20 } from "zod";
var settingsRoutes = async (app2) => {
  const editor = async (req, reply) => requireRole("EDITOR", "ADMIN")(req, reply);
  const admin = async (req, reply) => requireRole("ADMIN")(req, reply);
  app2.get("/settings/public", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=60, stale-while-revalidate=300");
    return getPublicSettings();
  });
  app2.get("/admin/settings", { preHandler: editor }, async (_req, reply) => {
    reply.header("cache-control", "no-store");
    return getAllSettings();
  });
  app2.put("/admin/settings/:key", { preHandler: admin }, async (req) => {
    const { key: key2 } = z20.object({ key: z20.enum(Object.keys(settingSchemas)) }).parse(req.params);
    return { key: key2, value: await saveSetting(key2, req.body ?? {}) };
  });
};
var settings_default = settingsRoutes;

// src/routes/media.ts
import { z as z21 } from "zod";
var mediaRoutes = async (app2) => {
  const moderator = async (req, reply) => requireRole("MODERATOR", "EDITOR", "ADMIN")(req, reply);
  app2.get("/admin/media/moderation", { preHandler: moderator }, async (req) => {
    const { status } = z21.object({ status: z21.enum(["PENDING", "REJECTED", "APPROVED"]).default("PENDING") }).parse(req.query ?? {});
    const [counts, items] = await Promise.all([
      prisma.mediaAsset.groupBy({ by: ["moderationStatus"], _count: { _all: true } }),
      prisma.mediaAsset.findMany({
        where: { moderationStatus: status },
        orderBy: { createdAt: "desc" },
        take: 60,
        select: {
          id: true,
          name: true,
          purpose: true,
          createdAt: true,
          moderatedAt: true,
          moderationScore: true,
          uploadedById: true
        }
      })
    ]);
    const users = await prisma.user.findMany({
      where: { id: { in: items.map((i) => i.uploadedById).filter((v) => Boolean(v)) } },
      select: { id: true, name: true, username: true }
    });
    const byUser = new Map(users.map((u) => [u.id, u]));
    return {
      counts: Object.fromEntries(counts.map((c) => [c.moderationStatus, c._count._all])),
      items: items.map((i) => ({ ...i, uploadedBy: i.uploadedById ? byUser.get(i.uploadedById) || null : null }))
    };
  });
  app2.get("/admin/media/:id/raw", { preHandler: moderator }, async (req, reply) => {
    const { id } = z21.object({ id: z21.string().min(1).max(40) }).parse(req.params);
    const asset = await prisma.mediaAsset.findUnique({ where: { id }, select: { data: true, mimeType: true } });
    if (!asset) return reply.code(404).send({ error: "Imagem n\xE3o encontrada" });
    return reply.header("content-type", asset.mimeType).header("cache-control", "private, no-store").header("x-content-type-options", "nosniff").send(Buffer.from(asset.data));
  });
  app2.post("/admin/media/:id/:decision", { preHandler: moderator }, async (req) => {
    const { id, decision } = z21.object({ id: z21.string().min(1).max(40), decision: z21.enum(["approve", "reject"]) }).parse(req.params);
    await setModeration(id, decision === "approve" ? "APPROVED" : "REJECTED");
    return { ok: true };
  });
};
var media_default = mediaRoutes;

// src/app.ts
import { Redis } from "ioredis";

// src/lib/validation.ts
import { ZodError } from "zod";
function isZodError(e) {
  return e instanceof ZodError;
}

// src/app.ts
async function buildApp() {
  const app2 = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: { paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'], remove: true }
    },
    bodyLimit: 1 * 1024 * 1024,
    trustProxy: trustProxySetting
  });
  app2.addHook("onRequest", async (req, reply) => {
    reply.header("x-request-id", String(req.id));
    reply.header("x-nexverse-api-version", "v17-bullmq-community");
  });
  app2.setErrorHandler((error, req, reply) => {
    const requestId = String(req.id);
    if (isZodError(error))
      return reply.code(400).send({ error: "Dados inv\xE1lidos", message: "Dados inv\xE1lidos", issues: error.issues, requestId });
    const code = String(error.code || "");
    const explicitStatus = Number(error.statusCode || 0);
    if (explicitStatus >= 400 && explicitStatus < 500) {
      return reply.code(explicitStatus).send({ error: error.message, message: error.message, code: code || "REQUEST_ERROR", requestId });
    }
    if (code.startsWith("IMAGE_MODERATION_")) {
      const status = explicitStatus >= 500 && explicitStatus < 600 ? explicitStatus : 503;
      req.log.warn(
        { err: error, method: req.method, url: req.url, requestId, code },
        "Servi\xE7o local de modera\xE7\xE3o indispon\xEDvel"
      );
      return reply.code(status).send({ error: error.message, message: error.message, code, requestId });
    }
    if (code === "P2002")
      return reply.code(409).send({
        error: "J\xE1 existe um registro com estes dados.",
        message: "J\xE1 existe um registro com estes dados.",
        code,
        requestId
      });
    if (code === "P2003")
      return reply.code(400).send({
        error: "Um dos v\xEDnculos enviados n\xE3o existe mais no banco. Atualize a p\xE1gina e tente novamente.",
        message: "Um dos v\xEDnculos enviados n\xE3o existe mais no banco. Atualize a p\xE1gina e tente novamente.",
        code,
        requestId
      });
    if (code === "P2025")
      return reply.code(404).send({ error: "Registro n\xE3o encontrado.", message: "Registro n\xE3o encontrado.", code, requestId });
    if (code === "P2021" || code === "P2022")
      return reply.code(503).send({
        error: "O banco de dados est\xE1 desatualizado em rela\xE7\xE3o ao projeto. Execute a sincroniza\xE7\xE3o/migra\xE7\xE3o do Prisma e reinicie a API.",
        message: "O banco de dados est\xE1 desatualizado em rela\xE7\xE3o ao projeto. Execute a sincroniza\xE7\xE3o/migra\xE7\xE3o do Prisma e reinicie a API.",
        code,
        requestId
      });
    if (code === "P1001" || code === "P1002" || code === "P2024")
      return reply.code(503).send({
        error: "Banco de dados temporariamente indispon\xEDvel ou sem conex\xE3o livre. Tente novamente em alguns segundos.",
        message: "Banco de dados temporariamente indispon\xEDvel ou sem conex\xE3o livre. Tente novamente em alguns segundos.",
        code,
        requestId
      });
    if (code === "FST_ERR_CTP_BODY_TOO_LARGE")
      return reply.code(413).send({
        error: "O artigo excedeu o tamanho m\xE1ximo permitido pela API.",
        message: "O artigo excedeu o tamanho m\xE1ximo permitido pela API.",
        code,
        requestId
      });
    if (code === "P2034" || code === "P2028")
      return reply.code(409).send({
        error: "N\xE3o foi poss\xEDvel concluir a transa\xE7\xE3o do artigo. Tente salvar novamente.",
        message: "N\xE3o foi poss\xEDvel concluir a transa\xE7\xE3o do artigo. Tente salvar novamente.",
        code,
        requestId
      });
    req.log.error({ err: error, method: req.method, url: req.url, requestId }, "Falha na requisi\xE7\xE3o");
    const message = env.NODE_ENV === "production" ? "N\xE3o foi poss\xEDvel concluir a opera\xE7\xE3o. Consulte o requestId nos logs da API." : error.message || "Falha interna na API";
    return reply.code(500).send({
      error: message,
      message,
      code: code || "INTERNAL_ERROR",
      requestId
    });
  });
  await app2.register(helmet, {
    contentSecurityPolicy: swaggerEnabled ? false : { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], imgSrc: ["'self'", "data:"] } },
    crossOriginResourcePolicy: { policy: "same-site" },
    hsts: env.NODE_ENV === "production" ? { maxAge: 31536e3, includeSubDomains: true } : false
  });
  await app2.register(cors, {
    origin: (origin, cb) => {
      cb(null, !origin || allowedOrigins.includes(origin));
    },
    credentials: true
  });
  const rateLimitRedis = redisConfigured && env.RATE_LIMIT_REDIS === "true" && env.NODE_ENV !== "test" ? new Redis(
    env.REDIS_URL,
    redisOptions({ connectTimeout: 500, maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false })
  ) : void 0;
  rateLimitRedis?.on("error", () => void 0);
  if (rateLimitRedis) app2.addHook("onClose", async () => void rateLimitRedis.quit().catch(() => void 0));
  await app2.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
    keyGenerator: (req) => clientIp(req),
    // Renderização do servidor do site (SSR/ISR na Hostinger) sai sempre do mesmo IP;
    // ela se identifica com o segredo do gateway e não entra no limite por visitante.
    allowList: (req) => isTrustedGateway(req) && !req.headers[GATEWAY_CLIENT_IP_HEADER],
    ...rateLimitRedis ? { redis: rateLimitRedis, nameSpace: "hv-rl:", skipOnError: true } : {}
  });
  await app2.register(cookie);
  app2.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 4096 },
    (_req, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(String(body))));
      } catch (error) {
        done(error, void 0);
      }
    }
  );
  app2.addHook("preHandler", csrfGuard);
  await app2.register(rawBody, { field: "rawBody", global: false, encoding: "utf8", runFirst: true });
  await app2.register(jwt, { secret: env.JWT_ACCESS_SECRET, cookie: { cookieName: ACCESS_COOKIE, signed: false } });
  await app2.register(multipart, {
    limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 10, parts: 12, fieldSize: 100 * 1024 }
  });
  if (swaggerEnabled) {
    await app2.register(swagger, { openapi: { info: { title: "Hypeverso API", version: "1.0.0" } } });
    await app2.register(swaggerUi, { routePrefix: "/docs" });
  }
  registerUploadServing(app2);
  app2.get("/health", async () => ({ status: "ok", service: "nexverse-api", time: (/* @__PURE__ */ new Date()).toISOString() }));
  await app2.register(auth_default, { prefix: "/api/auth" });
  await app2.register(mfa_default, { prefix: "/api" });
  await app2.register(engagement_default, { prefix: "/api" });
  await app2.register(social_catalog_default, { prefix: "/api" });
  await app2.register(community_moderation_default, { prefix: "/api" });
  await app2.register(revenue_default, { prefix: "/api" });
  await app2.register(content_default, { prefix: "/api" });
  await app2.register(ai_news_default, { prefix: "/api" });
  await app2.register(queues_default, { prefix: "/api" });
  await app2.register(users_default, { prefix: "/api" });
  await app2.register(community_default, { prefix: "/api" });
  await app2.register(library_default, { prefix: "/api" });
  await app2.register(catalog_default, { prefix: "/api" });
  await app2.register(search_default, { prefix: "/api" });
  await app2.register(recommendations_default, { prefix: "/api" });
  await app2.register(admin_default, { prefix: "/api" });
  await app2.register(uploads_default, { prefix: "/api" });
  await app2.register(billing_default, { prefix: "/api" });
  await app2.register(analytics_default, { prefix: "/api" });
  await app2.register(shop_default, { prefix: "/api" });
  await app2.register(settings_default, { prefix: "/api" });
  await app2.register(media_default, { prefix: "/api" });
  return app2;
}

// src/server.ts
var app = await buildApp();
process.on("unhandledRejection", (reason) => {
  app.log.error({ err: reason }, "Unhandled promise rejection; API continuar\xE1 ativa");
});
process.on("uncaughtException", (error) => {
  app.log.fatal({ err: error }, "Uncaught exception; o container ser\xE1 reiniciado pelo Docker");
  setTimeout(() => process.exit(1), 500).unref();
});
try {
  await prisma.$connect();
  try {
    await redis.connect();
  } catch (error) {
    app.log.warn({ err: error }, "Redis indispon\xEDvel na inicializa\xE7\xE3o; API continuar\xE1 sem cache at\xE9 reconectar");
  }
  await delCache("categories").catch(
    (error) => app.log.warn({ err: error }, "N\xE3o foi poss\xEDvel limpar cache de categorias")
  );
  await delCache("posts:*").catch((error) => app.log.warn({ err: error }, "N\xE3o foi poss\xEDvel limpar cache de posts"));
  if (!bullEnabled()) {
    const publishScheduled = async () => {
      try {
        const due = await prisma.post.findMany({
          where: { status: "SCHEDULED", scheduledAt: { lte: /* @__PURE__ */ new Date() } },
          select: { id: true, publishedAt: true },
          take: 100
        });
        for (const row of due) {
          const updated = await prisma.post.updateMany({
            where: { id: row.id, status: "SCHEDULED" },
            data: { status: "PUBLISHED", publishedAt: row.publishedAt ?? /* @__PURE__ */ new Date() }
          });
          if (updated.count) {
            if (!row.publishedAt)
              await notifyNewsPublished(row.id).catch(
                (error) => app.log.error({ err: error, postId: row.id }, "Falha ao notificar publica\xE7\xE3o agendada")
              );
            void syncPostToSearchIndex(row.id).catch(
              (error) => app.log.warn(
                { err: error, postId: row.id },
                "Publica\xE7\xE3o agendada ficar\xE1 para a pr\xF3xima reconcilia\xE7\xE3o da busca"
              )
            );
          }
        }
        if (due.length) await delCache("posts:*").catch(() => void 0);
      } catch (error) {
        app.log.error({ err: error }, "Falha ao publicar posts agendados; a API continuar\xE1 ativa");
      }
    };
    await publishScheduled();
    setInterval(() => void publishScheduled(), 6e4).unref();
    const processReleaseReminders = async () => {
      try {
        const sent = await processMediaReleaseReminders();
        if (sent) app.log.info({ sent }, "Lembretes de lan\xE7amentos enviados");
      } catch (error) {
        app.log.error({ err: error }, "Falha ao processar lembretes de lan\xE7amentos; a API continuar\xE1 ativa");
      }
    };
    await processReleaseReminders();
    setInterval(() => void processReleaseReminders(), 15 * 6e4).unref();
    setInterval(() => {
      if (isNewsletterSlot())
        void sendWeeklyDigest(app.log).catch((error) => app.log.error({ err: error }, "Falha na newsletter"));
    }, 10 * 6e4).unref();
  } else {
    app.log.info("BullMQ Community ativo: publica\xE7\xF5es agendadas e lembretes ser\xE3o processados pelo queue-worker");
  }
  if (!bullEnabled()) startAiNewsWorker();
  else app.log.info("BullMQ Community ativo: AI News ser\xE1 processado pelo ai-worker");
  setInterval(() => void flushViews(app.log), env.VIEW_FLUSH_MS).unref();
  await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
var shutdown = async () => {
  stopAiNewsWorker();
  await flushViews(app.log).catch(() => 0);
  await app.close();
  await prisma.$disconnect();
  try {
    redis.disconnect();
  } catch {
  }
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
//# sourceMappingURL=server.js.map