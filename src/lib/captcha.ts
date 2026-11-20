import { env } from '../config/env.js';

// Cloudflare Turnstile. Sem TURNSTILE_SECRET_KEY a verificação fica desligada (dev).
export const captchaEnabled = () => Boolean(env.TURNSTILE_SECRET_KEY);

export async function verifyCaptcha(token: string | undefined | null, ip?: string) {
  if (!captchaEnabled()) return true;
  if (!token || token.length > 2048) return false;
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!, response: token });
    if (ip) body.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    // Falha de rede com o Cloudflare: bloqueia (fail closed) para não abrir brecha a bots.
    return false;
  }
}

export function captchaError() {
  const error = new Error('Confirme que você não é um robô e tente novamente.') as Error & {
    statusCode: number;
    code: string;
  };
  error.statusCode = 400;
  error.code = 'CAPTCHA_FAILED';
  return error;
}
