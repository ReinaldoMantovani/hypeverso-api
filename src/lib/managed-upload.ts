import { env } from '../config/env.js';

export function isManagedUploadUrl(value: string | null | undefined, allowedPurposes: string[] = []) {
  if (!value) return true;
  try {
    const target = new URL(value);
    const allowedOrigins = new Set([new URL(env.ASSET_BASE_URL).origin, new URL(env.PUBLIC_WEB_URL).origin]);
    if (!allowedOrigins.has(target.origin) || !target.pathname.startsWith('/uploads/')) return false;
    if (!allowedPurposes.length) return true;
    const filename = target.pathname.split('/').pop() || '';
    return allowedPurposes.some(purpose => filename.startsWith(`${purpose}-`));
  } catch {
    return false;
  }
}
