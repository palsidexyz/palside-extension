import { IMAGE_LIMIT } from '../../domain/images/image-policy.ts';

export function encodeCapture(canvas: HTMLCanvasElement): string {
  for (;;) {
    const src = canvas.toDataURL('image/webp', 0.9);
    if (!src.startsWith('data:image/')) throw new Error('IMAGE_PROCESSING');
    const data = src.slice(src.indexOf(',') + 1);
    const bytes = data.length * 3 / 4 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
    if (bytes <= IMAGE_LIMIT.maxBytes) return src;
    if (canvas.width === 1 && canvas.height === 1) throw new Error('IMAGE_RESULT_TOO_LARGE');
    const smaller = document.createElement('canvas');
    smaller.width = Math.max(1, Math.floor(canvas.width * 0.8));
    smaller.height = Math.max(1, Math.floor(canvas.height * 0.8));
    const context = smaller.getContext('2d');
    if (!context) throw new Error('IMAGE_PROCESSING');
    context.drawImage(canvas, 0, 0, smaller.width, smaller.height);
    canvas = smaller;
  }
}
