import type { PostMedia } from '@zatma/validation';
import { uploadFile } from '@/lib/upload';

export type ComposerMedia = PostMedia & { url: string | null };

/** Natural size of an image file. */
export async function probeImage(file: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new window.Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Size and duration of a video file (metadata only). */
export function probeVideo(file: Blob): Promise<{ width: number; height: number; durationSec?: number }> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = (r: { width: number; height: number; durationSec?: number }) => {
      URL.revokeObjectURL(url);
      resolve(r);
    };
    v.onloadedmetadata = () => done({ width: v.videoWidth || 1080, height: v.videoHeight || 1920, durationSec: Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : undefined });
    v.onerror = () => done({ width: 1080, height: 1920 });
    v.src = url;
  });
}

/** Re-encodes PNG/WebP as JPEG on a white background (Instagram only accepts JPEG). */
export async function toJpeg(file: Blob, name: string): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not convert the image'))), 'image/jpeg', 0.92));
  return new File([blob], name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

const VIDEO_TYPES = ['video/mp4', 'video/quicktime'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Uploads a file as post media. Images are stored as JPEG so they work on every platform. */
export async function uploadPostMedia(file: File): Promise<ComposerMedia> {
  if (VIDEO_TYPES.includes(file.type)) {
    const meta = await probeVideo(file);
    const fileId = await uploadFile(file, 'POST_MEDIA');
    return { fileId, kind: 'video', mimeType: file.type, sizeBytes: file.size, ...meta, url: URL.createObjectURL(file) };
  }
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('Use a JPEG, PNG or WebP image, or an MP4 or MOV video');
  const jpeg = file.type === 'image/jpeg' ? file : await toJpeg(file, file.name);
  const { width, height } = await probeImage(jpeg);
  const fileId = await uploadFile(jpeg, 'POST_MEDIA');
  return { fileId, kind: 'image', mimeType: 'image/jpeg', sizeBytes: jpeg.size, width, height, url: URL.createObjectURL(jpeg) };
}

export const toPostMedia = (m: ComposerMedia): PostMedia => ({
  fileId: m.fileId,
  kind: m.kind,
  mimeType: m.mimeType,
  width: m.width,
  height: m.height,
  sizeBytes: m.sizeBytes,
  ...(m.durationSec !== undefined ? { durationSec: m.durationSec } : {}),
  ...(m.altText ? { altText: m.altText } : {}),
});
