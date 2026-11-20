import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
import {
  env,
  redisConfigured
} from "./chunk-AFZENULZ.js";

// src/lib/redis.ts
import { readFileSync } from "fs";
import { Redis } from "ioredis";
function redisOptions(extra = {}) {
  const tls = env.REDIS_URL.startsWith("rediss://") ? {
    tls: {
      rejectUnauthorized: env.REDIS_TLS_REJECT_UNAUTHORIZED !== "false",
      ...env.REDIS_TLS_CA_FILE ? { ca: readFileSync(env.REDIS_TLS_CA_FILE) } : {}
    }
  } : {};
  return { ...tls, ...extra };
}
var MemoryRedis = class {
  store = /* @__PURE__ */ new Map();
  sweeper = setInterval(() => this.sweep(), 6e4);
  status = "ready";
  constructor() {
    this.sweeper.unref?.();
  }
  sweep() {
    const now = Date.now();
    for (const [k, e] of this.store) if (e.expiresAt !== null && e.expiresAt <= now) this.store.delete(k);
    if (this.store.size > 5e4) {
      const drop = this.store.size - 4e4;
      let i = 0;
      for (const k of this.store.keys()) {
        if (i++ >= drop) break;
        this.store.delete(k);
      }
    }
  }
  live(key) {
    const e = this.store.get(key);
    if (!e) return void 0;
    if (e.expiresAt !== null && e.expiresAt <= Date.now()) {
      this.store.delete(key);
      return void 0;
    }
    return e;
  }
  async connect() {
  }
  disconnect() {
    clearInterval(this.sweeper);
  }
  async quit() {
    this.disconnect();
    return "OK";
  }
  on() {
    return this;
  }
  async get(key) {
    const e = this.live(key);
    return typeof e?.value === "string" ? e.value : null;
  }
  async set(key, value, ...args) {
    let ttl = null;
    let nx = false;
    for (let i = 0; i < args.length; i++) {
      const a = String(args[i]).toUpperCase();
      if (a === "EX") ttl = Number(args[++i]) * 1e3;
      else if (a === "PX") ttl = Number(args[++i]);
      else if (a === "NX") nx = true;
    }
    if (nx && this.live(key)) return null;
    this.store.set(key, { value: String(value), expiresAt: ttl ? Date.now() + ttl : null });
    return "OK";
  }
  async unlink(...keys) {
    let n = 0;
    for (const k of keys) if (this.store.delete(k)) n++;
    return n;
  }
  del(...keys) {
    return this.unlink(...keys);
  }
  async scan(_cursor, ...args) {
    const idx = args.findIndex((a) => String(a).toUpperCase() === "MATCH");
    const pattern = idx >= 0 ? String(args[idx + 1]) : "*";
    const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    const keys = [...this.store.keys()].filter((k) => re.test(k) && this.live(k));
    return ["0", keys];
  }
  async rename(from, to) {
    const e = this.live(from);
    if (!e) throw new Error("ERR no such key");
    this.store.delete(from);
    this.store.set(to, e);
    return "OK";
  }
  async hincrby(key, field, by) {
    const e = this.live(key);
    const map = e?.value instanceof Map ? e.value : /* @__PURE__ */ new Map();
    const next = (map.get(field) || 0) + by;
    map.set(field, next);
    this.store.set(key, { value: map, expiresAt: e?.expiresAt ?? null });
    return next;
  }
  async hgetall(key) {
    const e = this.live(key);
    const out = {};
    if (e?.value instanceof Map) for (const [k, v] of e.value) out[k] = String(v);
    return out;
  }
  async rpush(key, ...values) {
    const e = this.live(key);
    const list = Array.isArray(e?.value) ? e.value : [];
    list.push(...values);
    this.store.set(key, { value: list, expiresAt: e?.expiresAt ?? null });
    return list.length;
  }
  async lpop(key, count) {
    const e = this.live(key);
    const list = Array.isArray(e?.value) ? e.value : [];
    if (!list.length) return null;
    if (count === void 0) return list.shift() ?? null;
    return list.splice(0, count);
  }
  /** multi() mínimo: enfileira hincrby/rpush e executa em ordem. */
  multi() {
    const ops = [];
    const chain = {
      hincrby: (k, f, n) => (ops.push(() => this.hincrby(k, f, n)), chain),
      rpush: (k, ...v) => (ops.push(() => this.rpush(k, ...v)), chain),
      exec: async () => {
        const results = [];
        for (const op of ops) results.push([null, await op()]);
        return results;
      }
    };
    return chain;
  }
};
var redis = redisConfigured ? new Redis(env.REDIS_URL, redisOptions({ maxRetriesPerRequest: 2, enableReadyCheck: true, lazyConnect: true })) : new MemoryRedis();
async function getCache(key) {
  try {
    const v = await redis.get(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}
async function setCache(key, value, ttl = 60) {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttl);
  } catch {
  }
}
async function delCache(pattern) {
  try {
    if (!pattern.includes("*")) {
      await redis.unlink(pattern);
      return;
    }
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 500);
      cursor = next;
      if (keys.length) await redis.unlink(...keys);
    } while (cursor !== "0");
  } catch {
  }
}

export {
  redisOptions,
  redis,
  getCache,
  setCache,
  delCache
};
//# sourceMappingURL=chunk-ZIMWUEV2.js.map