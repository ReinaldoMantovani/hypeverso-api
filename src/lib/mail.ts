import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
let transporter: nodemailer.Transporter | null = null;
if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD) {
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    pool: true,
    maxConnections: 3,
  });
}
export const mailEnabled = () => Boolean(transporter);
export async function sendMail(
  to: string,
  subject: string,
  html: string,
  options: { text?: string; headers?: Record<string, string> } = {},
) {
  if (!transporter) {
    if (env.NODE_ENV !== 'production') console.info(`[mail disabled] ${subject} -> ${to}`);
    return false;
  }
  await transporter.sendMail({ from: env.SMTP_FROM, to, subject, html, text: options.text, headers: options.headers });
  return true;
}
export const escapeHtml = (v: string) =>
  v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
