export type ImagePolicy = { maxBytes: number; maxDimension: number };
type ImageErrorCode = 'IMAGE_TYPE' | 'IMAGE_SIZE' | 'IMAGE_CONFIGURATION' | 'IMAGE_DIMENSIONS' | 'IMAGE_DECODE' | 'IMAGE_PROCESSING' | 'IMAGE_RESULT_TOO_LARGE';
/** The host maps these codes to user-facing copy; this utility does not depend on a language runtime. */
class ImagePreparationError extends Error {
  readonly code: ImageErrorCode;
  constructor(code: ImageErrorCode) { super(code); this.code = code; }
}
export function imageFileError(file: Pick<File, 'type' | 'size'>, maxBytes: number): ImageErrorCode | undefined {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return 'IMAGE_TYPE';
  if (!Number.isFinite(maxBytes) || maxBytes <= 0 || file.size <= 0 || file.size > maxBytes) return 'IMAGE_SIZE';
}
/** Decode locally, scale and re-encode to discard attached metadata. No upload occurs here. */
export async function prepareImage(file: File, policy: ImagePolicy) {
  const error = imageFileError(file, policy.maxBytes);
  if (error) throw new ImagePreparationError(error);
  if (!Number.isFinite(policy.maxDimension) || policy.maxDimension < 1) throw new ImagePreparationError('IMAGE_CONFIGURATION');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new ImagePreparationError('IMAGE_DECODE'); }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) throw new ImagePreparationError('IMAGE_DIMENSIONS');
    const scale = Math.min(1, policy.maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new ImagePreparationError('IMAGE_PROCESSING');
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new ImagePreparationError('IMAGE_PROCESSING')), 'image/webp', 0.9));
    if (blob.size > policy.maxBytes) throw new ImagePreparationError('IMAGE_RESULT_TOO_LARGE');
    return { blob, width, height, name: file.name.replace(/\.[^.]+$/, '') + (blob.type === 'image/webp' ? '.webp' : '.png') };
  } finally { bitmap.close(); }
}
