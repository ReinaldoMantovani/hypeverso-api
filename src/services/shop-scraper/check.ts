// CÓPIA de hypeverso-cms/lib/server/check.ts (mantenha as duas iguais).
import { previewProduct } from './preview.js';
import { FetchProblem } from './fetcher.js';

/**
 * Verificação de um produto da Shop: reabre o link de afiliado e decide se
 * o preço mudou, se esgotou ou se o link quebrou.
 * Usado pelo worker diário no seu PC (hypeverso-api/src/shop-worker.ts) e pelo
 * botão "Verificar agora" do CMS.
 */
export type CheckStatus = 'OK' | 'PRICE_CHANGED' | 'OUT_OF_STOCK' | 'BROKEN' | 'BLOCKED';

export type CheckResult = {
  status: CheckStatus;
  message: string;
  priceCents: number | null;
  originalPriceCents: number | null;
  available: boolean | null;
  checkedAt: string;
};

type Current = { affiliateUrl: string; priceCents: number | null; originalPriceCents: number | null };

const brl = (c: number | null) => (c === null ? '—' : `R$ ${(c / 100).toFixed(2).replace('.', ',')}`);

export function evaluateCheck(
  current: Current,
  found: { priceCents: number | null; originalPriceCents: number | null; available: boolean | null; title: string | null },
  http: { status: number; blocked: boolean },
): CheckResult {
  const checkedAt = new Date().toISOString();
  const base = { priceCents: found.priceCents, originalPriceCents: found.originalPriceCents, available: found.available, checkedAt };
  if (http.status === 404 || http.status === 410)
    return { ...base, status: 'BROKEN', message: `A loja respondeu ${http.status}: o produto foi removido ou o link mudou.` };
  if (http.blocked && found.priceCents === null)
    return { ...base, status: 'BLOCKED', message: 'A loja pediu verificação anti-robô; tentaremos de novo na próxima rodada.' };
  if (found.available === false) return { ...base, status: 'OUT_OF_STOCK', message: 'Produto esgotado ou anúncio pausado.' };
  // Página que não deu para ler (montada por JavaScript, anti-robô, instabilidade)
  // NÃO conta como link quebrado: senão produtos bons seriam escondidos sozinhos.
  if (!found.title && found.priceCents === null)
    return {
      ...base,
      status: 'BLOCKED',
      message: 'Não consegui ler a página do produto agora (a loja pode estar bloqueando robôs). Nova tentativa na próxima rodada.',
    };
  if (found.priceCents !== null && current.priceCents !== null && found.priceCents !== current.priceCents)
    return {
      ...base,
      status: 'PRICE_CHANGED',
      message: `Preço mudou de ${brl(current.priceCents)} para ${brl(found.priceCents)}.`,
    };
  return { ...base, status: 'OK', message: found.priceCents !== null ? `Preço confirmado: ${brl(found.priceCents)}.` : 'Link funcionando.' };
}

export async function checkProduct(current: Current): Promise<CheckResult> {
  try {
    // Sem aplicar afiliado de novo: o link salvo já é o definitivo.
    const p = await previewProduct(current.affiliateUrl, { autoApply: false });
    const blocked = p.warnings.some(w => /anti-robô/.test(w));
    const httpWarn = p.warnings.find(w => /HTTP (\d{3})/.test(w));
    const status = httpWarn ? Number(httpWarn.match(/HTTP (\d{3})/)![1]) : 200;
    return evaluateCheck(current, p, { status, blocked });
  } catch (error) {
    const checkedAt = new Date().toISOString();
    const empty = { priceCents: null, originalPriceCents: null, available: null, checkedAt };
    if (error instanceof FetchProblem && error.status === 504)
      return { ...empty, status: 'BLOCKED', message: 'A loja não respondeu a tempo; nova tentativa depois.' };
    return {
      ...empty,
      status: 'BROKEN',
      message: error instanceof Error ? error.message : 'Não foi possível abrir o link.',
    };
  }
}
