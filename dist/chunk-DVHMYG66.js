import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
import {
  getAllSettings
} from "./chunk-OG6KD6QD.js";
import {
  delCache
} from "./chunk-ZIMWUEV2.js";
import {
  db_exports,
  prisma
} from "./chunk-AFZENULZ.js";

// src/services/shop-check.ts
async function applyCheckResult(productId, result) {
  const product = await prisma.shopProduct.findUnique({ where: { id: productId } });
  if (!product) return null;
  const { shop } = await getAllSettings();
  const now = /* @__PURE__ */ new Date();
  const data = {
    lastCheckedAt: now,
    checkStatus: result.status,
    checkMessage: result.message.slice(0, 500)
  };
  if (result.status === "BLOCKED") {
    data.checkStatus = product.checkStatus === "UNCHECKED" ? "BLOCKED" : product.checkStatus;
  }
  const failures = result.status === "BROKEN" ? product.checkFailures + 1 : result.status === "BLOCKED" ? product.checkFailures : 0;
  data.checkFailures = failures;
  const priceChanged = result.priceCents !== null && (result.priceCents !== product.priceCents || (result.originalPriceCents ?? null) !== (product.originalPriceCents ?? null));
  if (shop.autoUpdatePrices && priceChanged && (result.status === "OK" || result.status === "PRICE_CHANGED")) {
    data.priceCents = result.priceCents;
    data.originalPriceCents = result.originalPriceCents && result.priceCents && result.originalPriceCents > result.priceCents ? result.originalPriceCents : null;
    data.priceUpdatedAt = now;
  }
  const unavailable = result.status === "OUT_OF_STOCK" || result.status === "BROKEN" && failures >= 2;
  if (shop.autoHideUnavailable && unavailable && product.active) {
    data.active = false;
    data.autoHidden = true;
  }
  if (product.autoHidden && (result.status === "OK" || result.status === "PRICE_CHANGED")) {
    data.active = true;
    data.autoHidden = false;
  }
  const updated = await prisma.shopProduct.update({ where: { id: productId }, data });
  if (result.status !== "BLOCKED" && (priceChanged || result.available === false || product.checkStatus === "UNCHECKED")) {
    await prisma.shopPriceHistory.create({
      data: {
        productId,
        priceCents: result.priceCents,
        originalPriceCents: result.originalPriceCents,
        available: result.available !== false
      }
    }).catch(() => void 0);
  }
  await delCache("shop:public:*");
  return updated;
}
async function productsDueForCheck(limit = 20) {
  const { shop } = await getAllSettings();
  const cutoff = new Date(Date.now() - shop.checkIntervalHours * 36e5);
  return prisma.shopProduct.findMany({
    where: {
      OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: cutoff } }],
      // Produtos ocultados manualmente (não pelo sistema) não são verificados.
      AND: [{ OR: [{ active: true }, { autoHidden: true }] }]
    },
    orderBy: [{ lastCheckedAt: "asc" }],
    take: limit,
    select: { id: true, title: true, affiliateUrl: true, priceCents: true, originalPriceCents: true }
  });
}

export {
  applyCheckResult,
  productsDueForCheck
};
//# sourceMappingURL=chunk-DVHMYG66.js.map