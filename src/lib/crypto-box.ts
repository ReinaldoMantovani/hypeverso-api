import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

// AES-256-GCM para segredos que precisam ser lidos de volta (ex.: segredo TOTP).
// A chave vem de MFA_ENCRYPTION_KEY; em dev, cai para um derivado do segredo de refresh.
const key = createHash('sha256')
  .update(env.MFA_ENCRYPTION_KEY || `mfa:${env.JWT_REFRESH_SECRET}`)
  .digest();

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join(
    '.',
  );
}

export function open(sealed: string): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Formato de segredo inválido');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
