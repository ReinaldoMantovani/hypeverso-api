import { readFile } from 'node:fs/promises';
import { env } from '../config/env.js';

export type ImageModerationResult = {
  allowed: boolean;
  riskScore?: number;
  model?: string;
  policy?: string;
};

export type ImageModerationHealth = {
  ok: boolean;
  service?: string;
  engine?: string;
  runtime?: string;
  message?: string;
};

const baseUrl = () => env.IMAGE_MODERATION_URL.replace(/\/$/, '');
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function safeMessage(response: Response) {
  try {
    const payload = (await response.json()) as any;
    return String(payload?.detail || payload?.message || payload?.error || '').trim();
  } catch {
    try {
      return (await response.text()).slice(0, 300).trim();
    } catch {
      return '';
    }
  }
}

export async function checkImageModerationHealth(): Promise<ImageModerationHealth> {
  if (env.IMAGE_MODERATION_ENABLED.toLowerCase() !== 'true') {
    return { ok: false, message: 'A moderação de imagens está desativada no servidor.' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${baseUrl()}/health`, { signal: controller.signal });
    if (!response.ok) return { ok: false, message: `Moderador respondeu HTTP ${response.status}` };
    const payload = (await response.json()) as any;
    return {
      ok: payload?.ready !== false && payload?.status === 'ok',
      service: payload?.service,
      engine: payload?.engine,
      runtime: payload?.runtime,
      message: payload?.ready === false ? 'Moderador ainda está inicializando.' : undefined,
    };
  } catch (error: any) {
    return {
      ok: false,
      message:
        error?.name === 'AbortError'
          ? 'Timeout ao consultar o moderador.'
          : 'Não foi possível alcançar o moderador local.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runModeration(bytes: Buffer, mimeType: string, originalName: string): Promise<ImageModerationResult> {
  const attempts = Math.max(1, env.IMAGE_MODERATION_RETRIES + 1);
  let lastMessage = 'A moderação de imagens está temporariamente indisponível.';

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const body = new FormData();
    body.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), originalName || 'image');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.IMAGE_MODERATION_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl()}/moderate-image`, {
        method: 'POST',
        body,
        signal: controller.signal,
      });

      if (response.ok) {
        const result = (await response.json()) as ImageModerationResult;
        if (typeof result.allowed !== 'boolean') {
          throw Object.assign(new Error('Resposta inválida do serviço de moderação de imagens.'), { statusCode: 503 });
        }
        return result;
      }

      const detail = await safeMessage(response);
      if (response.status === 400 || response.status === 413 || response.status === 415 || response.status === 422) {
        const message = detail || 'A imagem não pôde ser analisada.';
        throw Object.assign(new Error(message), { statusCode: response.status });
      }

      lastMessage = detail || `Moderador respondeu HTTP ${response.status}`;
    } catch (error: any) {
      if (error?.statusCode && Number(error.statusCode) < 500) throw error;
      if (error?.name === 'AbortError') lastMessage = 'O moderador excedeu o tempo de resposta.';
      else if (error?.message) lastMessage = String(error.message);
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < attempts) await sleep(Math.min(750 * 2 ** (attempt - 1), 4_000));
  }

  throw Object.assign(new Error(`A moderação local não ficou pronta após ${attempts} tentativa(s). ${lastMessage}`), {
    statusCode: 503,
    code: 'IMAGE_MODERATION_UNAVAILABLE',
  });
}

export async function moderateImageFile(
  filePath: string,
  mimeType: string,
  originalName: string,
): Promise<ImageModerationResult> {
  if (env.IMAGE_MODERATION_ENABLED.toLowerCase() !== 'true') {
    throw Object.assign(new Error('A moderação de imagens está desativada no servidor.'), {
      statusCode: 503,
      code: 'IMAGE_MODERATION_DISABLED',
    });
  }

  const bytes = await readFile(filePath);
  return runModeration(bytes, mimeType, originalName);
}
