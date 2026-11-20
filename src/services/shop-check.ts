import { prisma } from '../db.js';
import { delCache } from '../lib/redis.js';
import { getAllSettings } from './settings.js';
import type { CheckResult } from './shop-scraper/check.js';

/**
 * Grava o resultado de uma verificação de produto (worker diário ou botão do CMS):
 *  - atualiza preço/preço antigo (se "autoUpdatePrices") e registra no histórico;
 *  - oculta produtos esgotados/quebrados (se "autoHideUnavailable") e reexibe quando voltarem;
 *  - "BLOCKED" (captcha/timeout) não muda nada além da data da tentativa.
 * Links quebrados só ocultam após 2 falhas seguidas (evita falso alarme).
 */
export async function applyCheckResult(productId: string, result: CheckResult) {
  const product = await prisma.shopProduct.findUnique({ where: { id: productId } });
  if (!product) return null;
  const { shop } = await getAllSettings();
  const now = new Date();
  const data: Record<string, unknown> = {
    lastCheckedAt: now,
    checkStatus: result.status,
    checkMessage: result.message.slice(0, 500),
  };

  if (result.status === 'BLOCKED') {
    // Mantém o último status conhecido; só registra a tentativa.
    data.checkStatus = product.checkStatus === 'UNCHECKED' ? 'BLOCKED' : product.checkStatus;
  }

  const failures = result.status === 'BROKEN' ? product.checkFailures + 1 : result.status === 'BLOCKED' ? product.checkFailures : 0;
  data.checkFailures = failures;

  const priceChanged =
    result.priceCents !== null &&
    (result.priceCents !== product.priceCents || (result.originalPriceCents ?? null) !== (product.originalPriceCents ?? null));
  if (shop.autoUpdatePrices && priceChanged && (result.status === 'OK' || result.status === 'PRICE_CHANGED')) {
    data.priceCents = result.priceCents;
    data.originalPriceCents =
      result.originalPriceCents && result.priceCents && result.originalPriceCents > result.priceCents
        ? result.originalPriceCents
        : null;
    data.priceUpdatedAt = now;
  }

  const unavailable = result.status === 'OUT_OF_STOCK' || (result.status === 'BROKEN' && failures >= 2);
  if (shop.autoHideUnavailable && unavailable && product.active) {
    data.active = false;
    data.autoHidden = true;
  }
  if (product.autoHidden && (result.status === 'OK' || result.status === 'PRICE_CHANGED')) {
    data.active = true;
    data.autoHidden = false;
  }

  const updated = await prisma.shopProduct.update({ where: { id: productId }, data });
  if (result.status !== 'BLOCKED' && (priceChanged || result.available === false || product.checkStatus === 'UNCHECKED')) {
    await prisma.shopPriceHistory
      .create({
        data: {
          productId,
          priceCents: result.priceCents,
          originalPriceCents: result.originalPriceCents,
          available: result.available !== false,
        },
      })
      .catch(() => undefined);
  }
  await delCache('shop:public:*');
  return updated;
}

/** Produtos que estão na hora de verificar (mais antigos primeiro). */
export async function productsDueForCheck(limit = 20) {
  const { shop } = await getAllSettings();
  const cutoff = new Date(Date.now() - shop.checkIntervalHours * 3600_000);
  return prisma.shopProduct.findMany({
    where: {
      OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: cutoff } }],
      // Produtos ocultados manualmente (não pelo sistema) não são verificados.
      AND: [{ OR: [{ active: true }, { autoHidden: true }] }],
    },
    orderBy: [{ lastCheckedAt: 'asc' }],
    take: limit,
    select: { id: true, title: true, affiliateUrl: true, priceCents: true, originalPriceCents: true },
  });
}
