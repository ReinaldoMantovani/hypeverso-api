import Stripe from 'stripe';
import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { getCache, setCache } from '../lib/redis.js';

const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;

async function stripeSummary() {
  if (!stripe) return { configured: false as const };
  const monthly = (amount: number, interval: string, count: number) => {
    const per = { day: 365 / 12, week: 52 / 12, month: 1, year: 1 / 12 }[interval] ?? 1;
    return (amount * per) / Math.max(1, count);
  };
  let mrrCents = 0;
  let active = 0;
  let currency = 'brl';
  for await (const sub of stripe.subscriptions.list({ status: 'active', limit: 100 })) {
    active++;
    for (const item of sub.items.data) {
      const price = item.price;
      if (!price?.unit_amount || !price.recurring) continue;
      currency = price.currency;
      mrrCents += monthly(
        price.unit_amount * (item.quantity || 1),
        price.recurring.interval,
        price.recurring.interval_count,
      );
    }
    if (active >= 5000) break;
  }
  const since = Math.floor((Date.now() - 30 * 86400000) / 1000);
  let revenue30Cents = 0;
  const daily = new Map<string, number>();
  for await (const inv of stripe.invoices.list({ status: 'paid', created: { gte: since }, limit: 100 })) {
    revenue30Cents += inv.amount_paid;
    const day = new Date(inv.created * 1000).toISOString().slice(0, 10);
    daily.set(day, (daily.get(day) || 0) + inv.amount_paid);
  }
  const canceled30 = await prisma.subscription.count({
    where: { status: 'CANCELED', updatedAt: { gte: new Date(since * 1000) } },
  });
  return {
    configured: true as const,
    currency: currency.toUpperCase(),
    activeSubscriptions: active,
    mrr: Math.round(mrrCents) / 100,
    revenue30d: revenue30Cents / 100,
    canceled30d: canceled30,
    daily: [...daily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, cents]) => ({ date, amount: cents / 100 })),
  };
}

async function googleAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`OAuth Google falhou (HTTP ${res.status})`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** AdSense Management API v2: ganhos, RPM, pageviews, impressões e cliques diários (30 dias). */
async function adsenseSummary() {
  const configured = Boolean(
    env.ADSENSE_ACCOUNT_ID &&
    env.GOOGLE_OAUTH_CLIENT_ID &&
    env.GOOGLE_OAUTH_CLIENT_SECRET &&
    env.GOOGLE_OAUTH_REFRESH_TOKEN,
  );
  if (!configured) return { configured: false as const };
  const account = env.ADSENSE_ACCOUNT_ID!.startsWith('accounts/')
    ? env.ADSENSE_ACCOUNT_ID!
    : `accounts/${env.ADSENSE_ACCOUNT_ID}`;
  if (!/^accounts\/pub-\d{10,20}$/.test(account))
    return { configured: false as const, error: 'ADSENSE_ACCOUNT_ID inválido' };
  const token = await googleAccessToken();
  const url = new URL(`https://adsense.googleapis.com/v2/${account}/reports:generate`);
  url.searchParams.set('dateRange', 'LAST_30_DAYS');
  url.searchParams.append('dimensions', 'DATE');
  for (const m of ['ESTIMATED_EARNINGS', 'PAGE_VIEWS', 'PAGE_VIEWS_RPM', 'IMPRESSIONS', 'CLICKS'])
    url.searchParams.append('metrics', m);
  url.searchParams.set('currencyCode', 'BRL');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`AdSense API falhou (HTTP ${res.status})`);
  const data = (await res.json()) as {
    rows?: { cells: { value?: string }[] }[];
    totals?: { cells: { value?: string }[] };
  };
  const num = (v?: string) => (v ? Number(v) : 0);
  const rows = (data.rows || []).map(r => ({
    date: r.cells[0]?.value || '',
    earnings: num(r.cells[1]?.value),
    pageViews: num(r.cells[2]?.value),
    rpm: num(r.cells[3]?.value),
    impressions: num(r.cells[4]?.value),
    clicks: num(r.cells[5]?.value),
  }));
  const totals = rows.reduce(
    (acc, r) => ({
      earnings: acc.earnings + r.earnings,
      pageViews: acc.pageViews + r.pageViews,
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
    }),
    { earnings: 0, pageViews: 0, impressions: 0, clicks: 0 },
  );
  return {
    configured: true as const,
    currency: 'BRL',
    rows,
    totals: { ...totals, rpm: totals.pageViews ? (totals.earnings / totals.pageViews) * 1000 : 0 },
  };
}

export async function revenueOverview(fresh = false) {
  const key = 'admin:revenue:v1';
  if (!fresh) {
    const cached = await getCache<any>(key);
    if (cached) return { ...cached, cached: true };
  }
  const since = new Date(Date.now() - 30 * 86400000);
  const [stripeData, adsense, pageViews30d, premiumUsers, affiliateClicks30d] = await Promise.all([
    stripeSummary().catch(error => ({
      configured: true as const,
      error: error instanceof Error ? error.message : String(error),
    })),
    adsenseSummary().catch(error => ({
      configured: true as const,
      error: error instanceof Error ? error.message : String(error),
    })),
    prisma.analyticsEvent.count({ where: { type: 'POST_VIEW', createdAt: { gte: since } } }),
    prisma.subscription.count({ where: { status: 'ACTIVE' } }),
    prisma.analyticsEvent.count({ where: { type: 'AFFILIATE_CLICK', createdAt: { gte: since } } }),
  ]);
  const result = {
    generatedAt: new Date().toISOString(),
    stripe: stripeData,
    adsense,
    site: { pageViews30d, premiumUsers, affiliateClicks30d },
  };
  await setCache(key, result, 30 * 60);
  return { ...result, cached: false };
}
