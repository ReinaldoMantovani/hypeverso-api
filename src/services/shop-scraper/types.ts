// CÓPIA de hypeverso-cms/lib/server/types.ts (mantenha as duas iguais).
/** Dados de afiliado configurados no CMS (Configurações › Afiliados). */
export type AffiliateSettings = {
  amazonTag?: string;
  mercadoLivreTool?: string;
  mercadoLivreWord?: string;
  shopeeAffiliateId?: string;
  shopeeSubId?: string;
  aliexpressTrackingId?: string;
  magaluStore?: string;
  awinPublisherId?: string;
  lomadeeSourceId?: string;
  autoApply?: boolean;
  extraStores?: { name: string; template: string; types: string[] }[];
};
