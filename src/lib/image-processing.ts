import sharp from 'sharp';
import { rename, unlink } from 'node:fs/promises';

// Reprocessa toda imagem enviada: aplica a orientação EXIF, remove TODOS os
// metadados (GPS, câmera, comentários) e reescreve os pixels. Isso também
// destrói payloads "polyglot" escondidos após os dados da imagem.
const MAX_DIMENSION = 4096;
sharp.cache(false);
sharp.concurrency(1);

export type ProcessedImage = {
  format: 'jpg' | 'png' | 'webp' | 'gif' | 'avif';
  width?: number;
  height?: number;
  bytes: number;
};

export async function reencodeImage(path: string, format: ProcessedImage['format']): Promise<ProcessedImage> {
  const animated = format === 'gif' || format === 'webp';
  // limitInputPixels protege contra "decompression bombs".
  let pipeline = sharp(path, { animated, limitInputPixels: 50_000_000, failOn: 'error' })
    .rotate()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true });
  if (format === 'jpg') pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
  else if (format === 'png') pipeline = pipeline.png({ compressionLevel: 9 });
  else if (format === 'webp') pipeline = pipeline.webp({ quality: 85 });
  else if (format === 'gif') pipeline = pipeline.gif();
  else pipeline = pipeline.avif({ quality: 60 });
  const tmp = `${path}.processing`;
  try {
    const info = await pipeline.toFile(tmp);
    await rename(tmp, path);
    return { format, width: info.width, height: info.height, bytes: info.size };
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}
