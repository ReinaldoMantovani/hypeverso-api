import { prisma } from '../db.js';

/** Versão desta API e funções que ela oferece (o CMS confere para avisar quando falta deploy). */
export const API_VERSION = '3.2.0';
export const API_FEATURES = ['translations', 'comics', 'shop-v2', 'catalog-diagnostics'];

/** Tabelas que as funções novas exigem. */
const REQUIRED_TABLES = [
  'ContentTranslation',
  'ShopProduct',
  'ShopCollection',
  'ShopPriceHistory',
  'SiteSetting',
  'MediaAsset',
];

let cached: { at: number; value: { ok: boolean; missing: string[] } } | null = null;

export async function databaseSchemaStatus() {
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  try {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`;
    const have = new Set(rows.map(r => r.name.toLowerCase()));
    const missing = REQUIRED_TABLES.filter(t => !have.has(t.toLowerCase()));
    cached = { at: Date.now(), value: { ok: missing.length === 0, missing } };
  } catch {
    cached = { at: Date.now(), value: { ok: true, missing: [] } }; // sem permissão de leitura: não alarma
  }
  return cached.value;
}
