import type { PresignUploadInput } from '@zatma/validation';
import { api } from './api';

/** Presign → PUT directly to object storage → confirm. Returns the stored file id. */
export async function uploadFile(file: File, purpose: PresignUploadInput['purpose']): Promise<string> {
  const presigned = await api.storage.presignUpload({
    fileName: file.name,
    mimeType: file.type as PresignUploadInput['mimeType'],
    sizeBytes: file.size,
    purpose,
  });
  const put = await fetch(presigned.uploadUrl, { method: 'PUT', headers: presigned.headers, body: file });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  await api.storage.completeUpload(presigned.fileId);
  return presigned.fileId;
}
