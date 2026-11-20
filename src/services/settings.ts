import { z } from 'zod';
import { prisma } from '../db.js';
import { delCache, getCache, setCache } from '../lib/redis.js';

/**
 * Configurações editáveis no CMS (tabela SiteSetting). Cada grupo é uma chave
 * com um JSON validado por zod; campos ausentes recebem o valor padrão.
 */
const text = (max: number, fallback = '') => z.string().trim().max(max).catch(fallback).default(fallback);
const id = (max = 120) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(/^[A-Za-z0-9_.:@-]*$/, 'Use só letras, números, ponto, hífen, sublinhado ou @')
    .default('');

export const affiliateSchema = z.object({
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
  extraStores: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(40),
        template: z
          .string()
          .trim()
          .max(500)
          .regex(/^https:\/\/.*\{query\}/, 'O modelo precisa começar com https:// e conter {query}'),
        types: z.array(z.enum(['MOVIE', 'SERIES', 'ANIME', 'GAME', 'MANGA', 'COMIC'])).max(6).default([]),
      }),
    )
    .max(10)
    .default([]),
});

export const shopTextSchema = z.object({
  enabled: z.boolean().default(true),
  /** Verificação diária (worker no seu PC): atualiza preço/preço antigo sozinha. */
  autoUpdatePrices: z.boolean().default(true),
  /** Oculta produtos esgotados ou com link quebrado e mostra de novo quando voltarem. */
  autoHideUnavailable: z.boolean().default(true),
  /** De quanto em quanto tempo cada produto é verificado. */
  checkIntervalHours: z.coerce.number().int().min(6).max(168).catch(24).default(24),
  title: text(80, 'Hypeverso Shop'),
  subtitle: text(
    400,
    'Achados nerds escolhidos a dedo: colecionáveis, games, mangás, HQs e tecnologia. Comprando por aqui você paga o mesmo preço e ajuda o Hypeverso a continuar no ar.',
  ),
  modalTitle: text(80, 'Obrigado pelo apoio!'),
  /** {nome} é trocado pelo primeiro nome do usuário logado. */
  modalMessage: text(
    500,
    'Quando você adquire um produto pelo Hypeverso, você ajuda o nosso projeto e o mundo nerd a seguirem em frente. Obrigado, {nome}!',
  ),
  /** Usada quando o visitante não está logado. */
  modalMessageGuest: text(
    500,
    'Quando você adquire um produto pelo Hypeverso, você ajuda o nosso projeto e o mundo nerd a seguirem em frente. Obrigado!',
  ),
  buyLabel: text(30, 'Comprar'),
  disclosure: text(
    600,
    'Transparência: os links desta página são de afiliados. Ao comprar, o Hypeverso pode receber uma comissão da loja, sem custo extra para você. Preços e disponibilidade podem mudar na loja.',
  ),
});

export const aiSchema = z.object({
  /** Modelo do Ollama usado no CMS para escrever os textos dos produtos. */
  shopModel: text(80, 'qwen3:4b-instruct'),
  tone: z.enum(['animado', 'neutro', 'tecnico']).catch('animado').default('animado'),
  /** Gera título/descrição/destaques automaticamente ao colar o link. */
  autoGenerate: z.boolean().default(true),
  /** Categorias sugeridas para a IA escolher. */
  categories: z
    .array(z.string().trim().min(2).max(40))
    .max(30)
    .default(['Colecionáveis', 'Games', 'Mangás', 'HQs', 'Livros', 'Tecnologia', 'Vestuário', 'Decoração', 'Filmes e Séries']),
});

export const moderationSchema = z.object({
  /** Imagens de usuários (avatar, comunidade, biblioteca) passam pela IA de moderação no seu PC. */
  enabled: z.boolean().default(true),
  /** Nível mínimo para enviar imagens na comunidade/biblioteca (avatar é liberado para todos). */
  imageMinLevel: z.coerce.number().int().min(1).max(50).catch(2).default(2),
  /** Esconde a imagem até a moderação aprovar (mais seguro; depende do seu PC estar ligado). */
  hideUntilApproved: z.boolean().default(false),
});

export const TRANSLATION_LOCALES = ['en', 'es'] as const;
export type TranslationLocale = (typeof TRANSLATION_LOCALES)[number];

export const translationSchema = z.object({
  /** Traduz artigos publicados automaticamente (worker de IA no seu PC). */
  enabled: z.boolean().default(true),
  /** Idiomas gerados (o original é sempre pt-BR). */
  locales: z.array(z.enum(TRANSLATION_LOCALES)).max(2).catch(['en', 'es']).default(['en', 'es']),
  /** Também traduz nome, descrição e destaques dos produtos da Shop. */
  translateShop: z.boolean().default(true),
  /** Modelo do Ollama para traduzir (vazio = o mesmo do IA Notícias). */
  model: text(80, ''),
  /** Só mostra no site depois que alguém revisar no CMS. */
  requireReview: z.boolean().default(false),
});

export const settingSchemas = {
  affiliate: affiliateSchema,
  shop: shopTextSchema,
  ai: aiSchema,
  moderation: moderationSchema,
  translation: translationSchema,
} as const;
export type SettingKey = keyof typeof settingSchemas;
export type AllSettings = { [K in SettingKey]: z.infer<(typeof settingSchemas)[K]> };

const CACHE_KEY = 'settings:all:v1';

export async function getAllSettings(): Promise<AllSettings> {
  const cached = await getCache<AllSettings>(CACHE_KEY);
  if (cached) return cached;
  const rows = await prisma.siteSetting.findMany({ where: { key: { in: Object.keys(settingSchemas) } } });
  const byKey = new Map(rows.map(r => [r.key, r.value]));
  const out = {} as AllSettings;
  for (const key of Object.keys(settingSchemas) as SettingKey[]) {
    const parsed = settingSchemas[key].safeParse(byKey.get(key) ?? {});
    (out as any)[key] = parsed.success ? parsed.data : settingSchemas[key].parse({});
  }
  await setCache(CACHE_KEY, out, 60);
  return out;
}

export async function saveSetting(key: SettingKey, value: unknown) {
  const data = settingSchemas[key].parse(value);
  await prisma.siteSetting.upsert({
    where: { key },
    create: { key, value: data as any },
    update: { value: data as any },
  });
  await delCache(CACHE_KEY);
  await delCache('settings:public:*');
  return data;
}

/** O que o site pode ver (nada sensível: a tag da Amazon já aparece nos links). */
export async function getPublicSettings() {
  const all = await getAllSettings();
  const { autoUpdatePrices: _a, autoHideUnavailable: _b, checkIntervalHours: _c, ...shopPublic } = all.shop;
  return {
    shop: shopPublic,
    affiliate: { amazonTag: all.affiliate.amazonTag, extraStores: all.affiliate.extraStores },
    translation: { enabled: all.translation.enabled, locales: all.translation.locales },
  };
}
