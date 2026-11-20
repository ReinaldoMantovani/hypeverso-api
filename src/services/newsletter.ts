import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { escapeHtml, mailEnabled, sendMail } from '../lib/mail.js';
import { stringList } from '../lib/json-array.js';

const site = () => env.PUBLIC_WEB_URL.replace(/\/$/, '');

export function unsubscribeLinks(token: string) {
  const url = `${site()}/newsletter/cancelar?token=${encodeURIComponent(token)}`;
  const api = `${site()}/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
  return { url, api };
}

export async function sendConfirmationEmail(email: string, rawToken: string) {
  const link = `${site()}/newsletter/confirmar?token=${encodeURIComponent(rawToken)}`;
  return sendMail(
    email,
    'Confirme sua inscrição na newsletter do Hypeverso',
    `<div style="font-family:system-ui,sans-serif;max-width:560px">
      <h1 style="font-size:22px">Falta só um clique</h1>
      <p>Recebemos um pedido para enviar o resumo semanal do Hypeverso para este e-mail.</p>
      <p><a href="${link}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none">Confirmar inscrição</a></p>
      <p style="color:#666;font-size:13px">Se não foi você, ignore esta mensagem — nada será enviado. O link vale por 48 horas.</p>
    </div>`,
    { text: `Confirme sua inscrição na newsletter do Hypeverso: ${link}` },
  );
}

function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-${String(Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}

function digestHtml(
  posts: { title: string; slug: string; description: string; category: { name: string } }[],
  unsubscribe: string,
) {
  const items = posts
    .map(
      p => `<tr><td style="padding:14px 0;border-bottom:1px solid #eee">
        <div style="font-size:12px;color:#7c3aed;text-transform:uppercase;letter-spacing:.08em">${escapeHtml(p.category.name)}</div>
        <a href="${site()}/post/${encodeURIComponent(p.slug)}?utm_source=newsletter&utm_medium=email" style="font-size:18px;font-weight:700;color:#111;text-decoration:none">${escapeHtml(p.title)}</a>
        <div style="color:#555;font-size:14px;margin-top:4px">${escapeHtml(p.description)}</div>
      </td></tr>`,
    )
    .join('');
  return `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:auto">
    <h1 style="font-size:24px">O melhor da semana no Hypeverso</h1>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${items}</table>
    <p style="color:#888;font-size:12px;margin-top:24px">Você recebe este e-mail porque se inscreveu na newsletter do Hypeverso.
    <a href="${unsubscribe}">Cancelar inscrição</a> · <a href="${site()}/conta/notificacoes">Escolher categorias</a></p>
  </div>`;
}

/**
 * Envia o resumo semanal. Usa uma trava no Redis por semana ISO, então pode ser
 * chamado várias vezes (BullMQ + fallback) sem duplicar envios.
 */
export async function sendWeeklyDigest(
  log?: { info: (...a: any[]) => void; warn: (...a: any[]) => void },
  force = false,
) {
  if (env.NEWSLETTER_ENABLED !== 'true' || !mailEnabled()) return { sent: 0, skipped: 'disabled' };
  const week = isoWeek();
  if (!force) {
    // Trava semanal no MySQL (vale entre reinícios e entre a API e o worker do seu PC).
    try {
      await prisma.siteSetting.create({ data: { key: `newsletter:weekly:${week}`, value: { at: new Date().toISOString() } } });
    } catch {
      return { sent: 0, skipped: 'already-sent' };
    }
  }
  const since = new Date(Date.now() - 7 * 86400000);
  const posts = await prisma.post.findMany({
    where: { status: 'PUBLISHED', publishedAt: { gte: since, lte: new Date() } },
    select: {
      title: true,
      slug: true,
      description: true,
      categoryId: true,
      viewCount: true,
      category: { select: { name: true } },
    },
    orderBy: [{ viewCount: 'desc' }, { publishedAt: 'desc' }],
    take: 200,
  });
  if (!posts.length) return { sent: 0, skipped: 'no-posts' };

  let sent = 0;
  let cursor: string | undefined;
  for (;;) {
    const subs = await prisma.newsletterSubscription.findMany({
      where: { status: 'CONFIRMED' },
      select: { id: true, email: true, categoryIds: true, unsubscribeToken: true },
      orderBy: { id: 'asc' },
      take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!subs.length) break;
    for (const sub of subs) {
      const wanted = stringList(sub.categoryIds);
      const selected = (wanted.length ? posts.filter(p => wanted.includes(p.categoryId)) : posts).slice(0, 8);
      if (!selected.length) continue;
      const links = unsubscribeLinks(sub.unsubscribeToken);
      try {
        await sendMail(sub.email, `Hypeverso: ${selected[0].title}`, digestHtml(selected, links.url), {
          text: selected.map(p => `${p.title}\n${site()}/post/${p.slug}`).join('\n\n') + `\n\nCancelar: ${links.url}`,
          // One-click unsubscribe (RFC 8058), exigido por Gmail/Yahoo para envios em massa.
          headers: { 'List-Unsubscribe': `<${links.api}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        });
        sent++;
        await prisma.newsletterSubscription.update({ where: { id: sub.id }, data: { lastSentAt: new Date() } });
      } catch (error) {
        log?.warn({ err: error, subscriptionId: sub.id }, 'Falha ao enviar newsletter');
      }
    }
    cursor = subs[subs.length - 1].id;
  }
  log?.info({ sent, week }, 'Newsletter semanal enviada');
  return { sent, week };
}

/** Fallback sem BullMQ: checado a cada hora; envia no dia/hora configurados. */
export function isNewsletterSlot(now = new Date()) {
  // Na Hostinger o app "dorme" sem tráfego: vale o dia inteiro a partir da hora
  // configurada. A trava semanal no banco impede envio duplicado.
  return now.getUTCDay() === env.NEWSLETTER_WEEKDAY && now.getUTCHours() >= env.NEWSLETTER_HOUR_UTC;
}
