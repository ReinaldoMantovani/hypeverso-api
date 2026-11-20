import { readFileSync } from 'node:fs';
import { Redis, type RedisOptions } from 'ioredis';
import { env, redisConfigured } from '../config/env.js';

/**
 * Opções comuns de conexão. A senha vem no próprio REDIS_URL
 * (redis://:senha@host:6379). Com rediss:// a conexão usa TLS.
 */
export function redisOptions(extra: RedisOptions = {}): RedisOptions {
  const tls = env.REDIS_URL.startsWith('rediss://')
    ? {
        tls: {
          rejectUnauthorized: env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false',
          ...(env.REDIS_TLS_CA_FILE ? { ca: readFileSync(env.REDIS_TLS_CA_FILE) } : {}),
        },
      }
    : {};
  return { ...tls, ...extra };
}

type Entry = { value: unknown; expiresAt: number | null };

/**
 * Substituto em memória do Redis para hospedagem sem Redis (Hostinger Business).
 * Implementa só os comandos que a API usa. Vale para um processo: perfeito para
 * cache, deduplicação de views/cliques e trava simples. Os dados somem quando o
 * Node reinicia (ok: tudo aqui é descartável).
 */
class MemoryRedis {
  private store = new Map<string, Entry>();
  private sweeper = setInterval(() => this.sweep(), 60_000);
  status = 'ready';

  constructor() {
    this.sweeper.unref?.();
  }

  private sweep() {
    const now = Date.now();
    for (const [k, e] of this.store) if (e.expiresAt !== null && e.expiresAt <= now) this.store.delete(k);
    // Limite de segurança de memória.
    if (this.store.size > 50_000) {
      const drop = this.store.size - 40_000;
      let i = 0;
      for (const k of this.store.keys()) {
        if (i++ >= drop) break;
        this.store.delete(k);
      }
    }
  }

  private live(key: string) {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== null && e.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return e;
  }

  async connect() {}
  disconnect() {
    clearInterval(this.sweeper);
  }
  async quit() {
    this.disconnect();
    return 'OK';
  }
  on() {
    return this;
  }

  async get(key: string) {
    const e = this.live(key);
    return typeof e?.value === 'string' ? e.value : null;
  }

  async set(key: string, value: string, ...args: (string | number)[]) {
    let ttl: number | null = null;
    let nx = false;
    for (let i = 0; i < args.length; i++) {
      const a = String(args[i]).toUpperCase();
      if (a === 'EX') ttl = Number(args[++i]) * 1000;
      else if (a === 'PX') ttl = Number(args[++i]);
      else if (a === 'NX') nx = true;
    }
    if (nx && this.live(key)) return null;
    this.store.set(key, { value: String(value), expiresAt: ttl ? Date.now() + ttl : null });
    return 'OK';
  }

  async unlink(...keys: string[]) {
    let n = 0;
    for (const k of keys) if (this.store.delete(k)) n++;
    return n;
  }
  del(...keys: string[]) {
    return this.unlink(...keys);
  }

  async scan(_cursor: string, ...args: (string | number)[]) {
    const idx = args.findIndex(a => String(a).toUpperCase() === 'MATCH');
    const pattern = idx >= 0 ? String(args[idx + 1]) : '*';
    const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    const keys = [...this.store.keys()].filter(k => re.test(k) && this.live(k));
    return ['0', keys] as [string, string[]];
  }

  async rename(from: string, to: string) {
    const e = this.live(from);
    if (!e) throw new Error('ERR no such key');
    this.store.delete(from);
    this.store.set(to, e);
    return 'OK';
  }

  async hincrby(key: string, field: string, by: number) {
    const e = this.live(key);
    const map = (e?.value instanceof Map ? e.value : new Map()) as Map<string, number>;
    const next = (map.get(field) || 0) + by;
    map.set(field, next);
    this.store.set(key, { value: map, expiresAt: e?.expiresAt ?? null });
    return next;
  }

  async hgetall(key: string) {
    const e = this.live(key);
    const out: Record<string, string> = {};
    if (e?.value instanceof Map) for (const [k, v] of e.value as Map<string, number>) out[k] = String(v);
    return out;
  }

  async rpush(key: string, ...values: string[]) {
    const e = this.live(key);
    const list = (Array.isArray(e?.value) ? e!.value : []) as string[];
    list.push(...values);
    this.store.set(key, { value: list, expiresAt: e?.expiresAt ?? null });
    return list.length;
  }

  async lpop(key: string, count?: number) {
    const e = this.live(key);
    const list = (Array.isArray(e?.value) ? e!.value : []) as string[];
    if (!list.length) return null;
    if (count === undefined) return list.shift() ?? null;
    return list.splice(0, count);
  }

  /** multi() mínimo: enfileira hincrby/rpush e executa em ordem. */
  multi() {
    const ops: (() => Promise<unknown>)[] = [];
    const chain = {
      hincrby: (k: string, f: string, n: number) => (ops.push(() => this.hincrby(k, f, n)), chain),
      rpush: (k: string, ...v: string[]) => (ops.push(() => this.rpush(k, ...v)), chain),
      exec: async () => {
        const results: [null, unknown][] = [];
        for (const op of ops) results.push([null, await op()]);
        return results;
      },
    };
    return chain;
  }
}

export const redis: Redis = redisConfigured
  ? new Redis(env.REDIS_URL, redisOptions({ maxRetriesPerRequest: 2, enableReadyCheck: true, lazyConnect: true }))
  : (new MemoryRedis() as unknown as Redis);

export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const v = await redis.get(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}
export async function setCache(key: string, value: unknown, ttl = 60) {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttl);
  } catch {}
}

/**
 * Remove uma chave ou um padrão. Usa SCAN incremental (não bloqueia o Redis
 * como KEYS) e apaga em lotes com UNLINK.
 */
export async function delCache(pattern: string) {
  try {
    if (!pattern.includes('*')) {
      await redis.unlink(pattern);
      return;
    }
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      cursor = next;
      if (keys.length) await redis.unlink(...keys);
    } while (cursor !== '0');
  } catch {}
}
