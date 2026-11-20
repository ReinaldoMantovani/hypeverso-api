import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
import {
  delCache,
  getCache,
  setCache
} from "./chunk-ZIMWUEV2.js";
import {
  db_exports,
  prisma
} from "./chunk-AFZENULZ.js";

// src/services/settings.ts
import { z } from "zod";
var text = (max, fallback = "") => z.string().trim().max(max).catch(fallback).default(fallback);
var id = (max = 120) => z.string().trim().max(max).regex(/^[A-Za-z0-9_.:@-]*$/, "Use s\xF3 letras, n\xFAmeros, ponto, h\xEDfen, sublinhado ou @").default("");
var affiliateSchema = z.object({
  /** Amazon Associados: tag de rastreamento (ex.: hypeverso-20). */
  amazonTag: id(60),
  /** Mercado Livre Afiliados: parâmetros matt_tool e matt_word do seu link. */
  mercadoLivreTool: id(60),
  mercadoLivreWord: id(80),
  /** Shopee Afiliados: ID de afiliado (an_XXXXXXXX) e sub ID opcional. */
  shopeeAffiliateId: id(60),
  shopeeSubId: id(60),
  /** AliExpress Portals: tracking ID. */
  aliexpressTrackingId: id(80),
  /** Parceiro Magalu: nome da sua loja em magazinevoce.com.br/magazine<NOME>. */
  magaluStore: id(60),
  /** Redes (Awin, Lomadee) para lojas como KaBuM!, Americanas, Casas Bahia… */
  awinPublisherId: id(40),
  lomadeeSourceId: id(40),
  /** Aplicar automaticamente seus dados quando colar um link comum de produto. */
  autoApply: z.boolean().default(true),
  /** Lojas extras para os botões "comprar" do catálogo de obras ({query} = título buscado). */
  extraStores: z.array(
    z.object({
      name: z.string().trim().min(2).max(40),
      template: z.string().trim().max(500).regex(/^https:\/\/.*\{query\}/, "O modelo precisa come\xE7ar com https:// e conter {query}"),
      types: z.array(z.enum(["MOVIE", "SERIES", "ANIME", "GAME", "MANGA", "COMIC"])).max(6).default([])
    })
  ).max(10).default([])
});
var shopTextSchema = z.object({
  enabled: z.boolean().default(true),
  /** Verificação diária (worker no seu PC): atualiza preço/preço antigo sozinha. */
  autoUpdatePrices: z.boolean().default(true),
  /** Oculta produtos esgotados ou com link quebrado e mostra de novo quando voltarem. */
  autoHideUnavailable: z.boolean().default(true),
  /** De quanto em quanto tempo cada produto é verificado. */
  checkIntervalHours: z.coerce.number().int().min(6).max(168).catch(24).default(24),
  title: text(80, "Hypeverso Shop"),
  subtitle: text(
    400,
    "Achados nerds escolhidos a dedo: colecion\xE1veis, games, mang\xE1s, HQs e tecnologia. Comprando por aqui voc\xEA paga o mesmo pre\xE7o e ajuda o Hypeverso a continuar no ar."
  ),
  modalTitle: text(80, "Obrigado pelo apoio!"),
  /** {nome} é trocado pelo primeiro nome do usuário logado. */
  modalMessage: text(
    500,
    "Quando voc\xEA adquire um produto pelo Hypeverso, voc\xEA ajuda o nosso projeto e o mundo nerd a seguirem em frente. Obrigado, {nome}!"
  ),
  /** Usada quando o visitante não está logado. */
  modalMessageGuest: text(
    500,
    "Quando voc\xEA adquire um produto pelo Hypeverso, voc\xEA ajuda o nosso projeto e o mundo nerd a seguirem em frente. Obrigado!"
  ),
  buyLabel: text(30, "Comprar"),
  disclosure: text(
    600,
    "Transpar\xEAncia: os links desta p\xE1gina s\xE3o de afiliados. Ao comprar, o Hypeverso pode receber uma comiss\xE3o da loja, sem custo extra para voc\xEA. Pre\xE7os e disponibilidade podem mudar na loja."
  )
});
var aiSchema = z.object({
  /** Modelo do Ollama usado no CMS para escrever os textos dos produtos. */
  shopModel: text(80, "qwen3:4b-instruct"),
  tone: z.enum(["animado", "neutro", "tecnico"]).catch("animado").default("animado"),
  /** Gera título/descrição/destaques automaticamente ao colar o link. */
  autoGenerate: z.boolean().default(true),
  /** Categorias sugeridas para a IA escolher. */
  categories: z.array(z.string().trim().min(2).max(40)).max(30).default(["Colecion\xE1veis", "Games", "Mang\xE1s", "HQs", "Livros", "Tecnologia", "Vestu\xE1rio", "Decora\xE7\xE3o", "Filmes e S\xE9ries"])
});
var moderationSchema = z.object({
  /** Imagens de usuários (avatar, comunidade, biblioteca) passam pela IA de moderação no seu PC. */
  enabled: z.boolean().default(true),
  /** Nível mínimo para enviar imagens na comunidade/biblioteca (avatar é liberado para todos). */
  imageMinLevel: z.coerce.number().int().min(1).max(50).catch(2).default(2),
  /** Esconde a imagem até a moderação aprovar (mais seguro; depende do seu PC estar ligado). */
  hideUntilApproved: z.boolean().default(false)
});
var settingSchemas = {
  affiliate: affiliateSchema,
  shop: shopTextSchema,
  ai: aiSchema,
  moderation: moderationSchema
};
var CACHE_KEY = "settings:all:v1";
async function getAllSettings() {
  const cached = await getCache(CACHE_KEY);
  if (cached) return cached;
  const rows = await prisma.siteSetting.findMany({ where: { key: { in: Object.keys(settingSchemas) } } });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = {};
  for (const key of Object.keys(settingSchemas)) {
    const parsed = settingSchemas[key].safeParse(byKey.get(key) ?? {});
    out[key] = parsed.success ? parsed.data : settingSchemas[key].parse({});
  }
  await setCache(CACHE_KEY, out, 60);
  return out;
}
async function saveSetting(key, value) {
  const data = settingSchemas[key].parse(value);
  await prisma.siteSetting.upsert({
    where: { key },
    create: { key, value: data },
    update: { value: data }
  });
  await delCache(CACHE_KEY);
  await delCache("settings:public:*");
  return data;
}
async function getPublicSettings() {
  const all = await getAllSettings();
  const { autoUpdatePrices: _a, autoHideUnavailable: _b, checkIntervalHours: _c, ...shopPublic } = all.shop;
  return {
    shop: shopPublic,
    affiliate: { amazonTag: all.affiliate.amazonTag, extraStores: all.affiliate.extraStores }
  };
}

export {
  affiliateSchema,
  shopTextSchema,
  aiSchema,
  moderationSchema,
  settingSchemas,
  getAllSettings,
  saveSetting,
  getPublicSettings
};
//# sourceMappingURL=chunk-OG6KD6QD.js.map