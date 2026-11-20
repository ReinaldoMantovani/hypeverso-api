import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
import {
  db_exports,
  env,
  prisma
} from "./chunk-AFZENULZ.js";

// src/services/push.ts
import webpush from "web-push";

// src/lib/json-array.ts
function stringList(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
  if (typeof value === "string") {
    try {
      return stringList(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

// src/services/push.ts
var pushEnabled = () => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
if (pushEnabled()) webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
var PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /^web\.push\.apple\.com$/,
  /(^|\.)push\.apple\.com$/
];
function isAllowedPushEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}
async function deliver(subs, payload) {
  if (!pushEnabled() || !subs.length) return 0;
  const body = JSON.stringify(payload);
  let sent = 0;
  for (let i = 0; i < subs.length; i += 50) {
    const chunk = subs.slice(i, i + 50);
    await Promise.all(
      chunk.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body,
            {
              TTL: 6 * 3600,
              urgency: "normal",
              timeout: 1e4
            }
          );
          sent++;
          await prisma.pushSubscription.update({ where: { id: sub.id }, data: { lastUsedAt: /* @__PURE__ */ new Date(), failures: 0 } }).catch(() => void 0);
        } catch (error) {
          const status = Number(error?.statusCode || 0);
          if (status === 404 || status === 410)
            await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => void 0);
          else
            await prisma.pushSubscription.update({ where: { id: sub.id }, data: { failures: { increment: 1 } } }).catch(() => void 0);
        }
      })
    );
  }
  await prisma.pushSubscription.deleteMany({ where: { failures: { gte: 10 } } }).catch(() => void 0);
  return sent;
}
async function pushNewsPublished(post) {
  if (!pushEnabled()) return 0;
  const all = await prisma.pushSubscription.findMany({
    select: { id: true, endpoint: true, p256dh: true, auth: true, topics: true },
    take: 5e4
  });
  const subs = all.filter((s) => {
    const topics = stringList(s.topics);
    return topics.includes("news") || topics.includes(`cat:${post.categoryId}`);
  });
  return deliver(subs, {
    title: `Nova em ${post.categoryName}`,
    body: post.title,
    url: `/post/${post.slug}`,
    image: post.coverImageUrl && /^https:\/\//.test(post.coverImageUrl) ? post.coverImageUrl : null,
    tag: `post-${post.slug}`
  });
}
async function pushToUser(userId, topic, payload) {
  if (!pushEnabled()) return 0;
  const subs = (await prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true, topics: true }
  })).filter((s) => stringList(s.topics).includes(topic));
  return deliver(subs, payload);
}

// src/services/notifications.ts
async function notify(data) {
  if (data.actorId === data.recipientId) return;
  await prisma.notification.create({ data });
}
async function notifyFollowersActivity(data) {
  const followers = await prisma.userFollow.findMany({
    where: { followingId: data.actorId },
    select: { followerId: true }
  });
  if (!followers.length) return 0;
  const rows = followers.filter((row) => row.followerId !== data.actorId).map((row) => ({
    recipientId: row.followerId,
    actorId: data.actorId,
    type: "FOLLOW_ACTIVITY",
    title: data.title,
    body: data.body,
    entityType: data.entityType,
    entityId: data.entityId
  }));
  if (!rows.length) return 0;
  const result = await prisma.notification.createMany({ data: rows });
  return result.count;
}
async function notifyNewsPublished(postId) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      title: true,
      slug: true,
      authorId: true,
      categoryId: true,
      coverImageUrl: true,
      category: { select: { name: true } }
    }
  });
  if (!post) return 0;
  await pushNewsPublished({
    title: post.title,
    slug: post.slug,
    categoryId: post.categoryId,
    categoryName: post.category.name,
    coverImageUrl: post.coverImageUrl
  }).catch(() => 0);
  const subscriptions = await prisma.userNewsCategoryPreference.findMany({
    where: { categoryId: post.categoryId, userId: { not: post.authorId } },
    select: { userId: true }
  });
  if (!subscriptions.length) return 0;
  const result = await prisma.notification.createMany({
    data: subscriptions.map((s) => ({
      recipientId: s.userId,
      actorId: post.authorId,
      type: "NEWS",
      title: `Nova not\xEDcia em ${post.category.name}`,
      body: post.title,
      entityType: "news",
      entityId: post.slug
    }))
  });
  return result.count;
}
async function processMediaReleaseReminders(now = /* @__PURE__ */ new Date()) {
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - 1);
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + 31);
  windowEnd.setHours(23, 59, 59, 999);
  const pending = await prisma.mediaReleaseReminder.findMany({
    where: { notifiedAt: null, catalogItem: { releaseDate: { gte: windowStart, lte: windowEnd } } },
    include: { catalogItem: true },
    take: 500
  });
  let sent = 0;
  for (const reminder of pending) {
    const releaseDate = reminder.catalogItem.releaseDate;
    if (!releaseDate) continue;
    const notifyAt = new Date(releaseDate);
    notifyAt.setDate(notifyAt.getDate() - reminder.remindBeforeDays);
    notifyAt.setHours(0, 0, 0, 0);
    if (now.getTime() < notifyAt.getTime()) continue;
    const releaseDay = new Date(releaseDate);
    releaseDay.setHours(0, 0, 0, 0);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const days = Math.max(0, Math.round((releaseDay.getTime() - today.getTime()) / 864e5));
    const entityId = `${reminder.catalogItem.provider}|${reminder.catalogItem.mediaType}|${reminder.catalogItem.externalId}`;
    try {
      const didSend = await prisma.$transaction(async (tx) => {
        const claim = await tx.mediaReleaseReminder.updateMany({
          where: { id: reminder.id, notifiedAt: null },
          data: { notifiedAt: now }
        });
        if (!claim.count) return false;
        await tx.notification.create({
          data: {
            recipientId: reminder.userId,
            type: "MEDIA_RELEASE",
            title: days === 0 ? "Lan\xE7amento hoje" : `Lan\xE7amento em ${days} dia${days === 1 ? "" : "s"}`,
            body: reminder.catalogItem.title,
            entityType: "mediaRelease",
            entityId
          }
        });
        return true;
      });
      if (didSend) {
        sent++;
        await pushToUser(reminder.userId, "releases", {
          title: days === 0 ? "Lan\xE7amento hoje" : `Lan\xE7amento em ${days} dia${days === 1 ? "" : "s"}`,
          body: reminder.catalogItem.title,
          url: `/catalogo/${reminder.catalogItem.provider}/${reminder.catalogItem.mediaType}/${encodeURIComponent(reminder.catalogItem.externalId)}`,
          tag: `release-${reminder.id}`
        }).catch(() => 0);
      }
    } catch {
    }
  }
  return sent;
}

// src/lib/mail.ts
import nodemailer from "nodemailer";
var transporter = null;
if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD) {
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    pool: true,
    maxConnections: 3
  });
}
var mailEnabled = () => Boolean(transporter);
async function sendMail(to, subject, html, options = {}) {
  if (!transporter) {
    if (env.NODE_ENV !== "production") console.info(`[mail disabled] ${subject} -> ${to}`);
    return false;
  }
  await transporter.sendMail({ from: env.SMTP_FROM, to, subject, html, text: options.text, headers: options.headers });
  return true;
}
var escapeHtml = (v) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// src/services/newsletter.ts
var site = () => env.PUBLIC_WEB_URL.replace(/\/$/, "");
function unsubscribeLinks(token) {
  const url = `${site()}/newsletter/cancelar?token=${encodeURIComponent(token)}`;
  const api = `${site()}/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
  return { url, api };
}
async function sendConfirmationEmail(email, rawToken) {
  const link = `${site()}/newsletter/confirmar?token=${encodeURIComponent(rawToken)}`;
  return sendMail(
    email,
    "Confirme sua inscri\xE7\xE3o na newsletter do Hypeverso",
    `<div style="font-family:system-ui,sans-serif;max-width:560px">
      <h1 style="font-size:22px">Falta s\xF3 um clique</h1>
      <p>Recebemos um pedido para enviar o resumo semanal do Hypeverso para este e-mail.</p>
      <p><a href="${link}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none">Confirmar inscri\xE7\xE3o</a></p>
      <p style="color:#666;font-size:13px">Se n\xE3o foi voc\xEA, ignore esta mensagem \u2014 nada ser\xE1 enviado. O link vale por 48 horas.</p>
    </div>`,
    { text: `Confirme sua inscri\xE7\xE3o na newsletter do Hypeverso: ${link}` }
  );
}
function isoWeek(date = /* @__PURE__ */ new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-${String(Math.ceil(((d.getTime() - yearStart.getTime()) / 864e5 + 1) / 7)).padStart(2, "0")}`;
}
function digestHtml(posts, unsubscribe) {
  const items = posts.map(
    (p) => `<tr><td style="padding:14px 0;border-bottom:1px solid #eee">
        <div style="font-size:12px;color:#7c3aed;text-transform:uppercase;letter-spacing:.08em">${escapeHtml(p.category.name)}</div>
        <a href="${site()}/post/${encodeURIComponent(p.slug)}?utm_source=newsletter&utm_medium=email" style="font-size:18px;font-weight:700;color:#111;text-decoration:none">${escapeHtml(p.title)}</a>
        <div style="color:#555;font-size:14px;margin-top:4px">${escapeHtml(p.description)}</div>
      </td></tr>`
  ).join("");
  return `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:auto">
    <h1 style="font-size:24px">O melhor da semana no Hypeverso</h1>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${items}</table>
    <p style="color:#888;font-size:12px;margin-top:24px">Voc\xEA recebe este e-mail porque se inscreveu na newsletter do Hypeverso.
    <a href="${unsubscribe}">Cancelar inscri\xE7\xE3o</a> \xB7 <a href="${site()}/conta/notificacoes">Escolher categorias</a></p>
  </div>`;
}
async function sendWeeklyDigest(log, force = false) {
  if (env.NEWSLETTER_ENABLED !== "true" || !mailEnabled()) return { sent: 0, skipped: "disabled" };
  const week = isoWeek();
  if (!force) {
    try {
      await prisma.siteSetting.create({ data: { key: `newsletter:weekly:${week}`, value: { at: (/* @__PURE__ */ new Date()).toISOString() } } });
    } catch {
      return { sent: 0, skipped: "already-sent" };
    }
  }
  const since = new Date(Date.now() - 7 * 864e5);
  const posts = await prisma.post.findMany({
    where: { status: "PUBLISHED", publishedAt: { gte: since, lte: /* @__PURE__ */ new Date() } },
    select: {
      title: true,
      slug: true,
      description: true,
      categoryId: true,
      viewCount: true,
      category: { select: { name: true } }
    },
    orderBy: [{ viewCount: "desc" }, { publishedAt: "desc" }],
    take: 200
  });
  if (!posts.length) return { sent: 0, skipped: "no-posts" };
  let sent = 0;
  let cursor;
  for (; ; ) {
    const subs = await prisma.newsletterSubscription.findMany({
      where: { status: "CONFIRMED" },
      select: { id: true, email: true, categoryIds: true, unsubscribeToken: true },
      orderBy: { id: "asc" },
      take: 200,
      ...cursor ? { cursor: { id: cursor }, skip: 1 } : {}
    });
    if (!subs.length) break;
    for (const sub of subs) {
      const wanted = stringList(sub.categoryIds);
      const selected = (wanted.length ? posts.filter((p) => wanted.includes(p.categoryId)) : posts).slice(0, 8);
      if (!selected.length) continue;
      const links = unsubscribeLinks(sub.unsubscribeToken);
      try {
        await sendMail(sub.email, `Hypeverso: ${selected[0].title}`, digestHtml(selected, links.url), {
          text: selected.map((p) => `${p.title}
${site()}/post/${p.slug}`).join("\n\n") + `

Cancelar: ${links.url}`,
          // One-click unsubscribe (RFC 8058), exigido por Gmail/Yahoo para envios em massa.
          headers: { "List-Unsubscribe": `<${links.api}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
        });
        sent++;
        await prisma.newsletterSubscription.update({ where: { id: sub.id }, data: { lastSentAt: /* @__PURE__ */ new Date() } });
      } catch (error) {
        log?.warn({ err: error, subscriptionId: sub.id }, "Falha ao enviar newsletter");
      }
    }
    cursor = subs[subs.length - 1].id;
  }
  log?.info({ sent, week }, "Newsletter semanal enviada");
  return { sent, week };
}
function isNewsletterSlot(now = /* @__PURE__ */ new Date()) {
  return now.getUTCDay() === env.NEWSLETTER_WEEKDAY && now.getUTCHours() >= env.NEWSLETTER_HOUR_UTC;
}

export {
  stringList,
  pushEnabled,
  isAllowedPushEndpoint,
  notify,
  notifyFollowersActivity,
  notifyNewsPublished,
  processMediaReleaseReminders,
  sendMail,
  unsubscribeLinks,
  sendConfirmationEmail,
  sendWeeklyDigest,
  isNewsletterSlot
};
//# sourceMappingURL=chunk-QI3TW2B2.js.map