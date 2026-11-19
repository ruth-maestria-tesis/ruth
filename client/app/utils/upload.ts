/**
 * File uploads (manuscripts, correction files). The API decides the strategy:
 *  - DIRECT (production, Vercel Blob): the bytes go from the browser straight to the private Blob
 *    store with a short-lived client token, then the API verifies and registers the blob. This
 *    avoids the 4.5 MB request-body limit of Vercel functions.
 *  - MULTIPART (local / GridFS): the usual multipart POST to the API.
 */
import { UploadStrategy } from '@thesis/shared';
import { ApiError, request } from './http';

type UploadTicket =
  | { strategy: UploadStrategy.MULTIPART }
  | { strategy: UploadStrategy.DIRECT; clientToken: string; pathname: string; expiresAt: string };

/** 0–100 while the bytes travel (DIRECT only; MULTIPART reports nothing). */
export type UploadProgress = (percentage: number) => void;

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Browsers often leave `File.type` empty for Word files: fall back to the extension. */
const contentTypeOf = (file: File): string =>
  file.type || MIME_BY_EXT[file.name.split('.').pop()?.toLowerCase() ?? ''] || 'application/octet-stream';

/**
 * Uploads `file` to `base` (e.g. `/theses/:id/manuscripts`): `POST base/uploads`, then either the
 * direct Blob upload + `POST base/uploads/complete`, or the multipart `POST base`. Resolves to the
 * same response as the multipart route.
 */
export async function uploadFile<T>(base: string, file: File, onProgress?: UploadProgress): Promise<T> {
  const contentType = contentTypeOf(file);
  const ticket = await request<UploadTicket>(`${base}/uploads`, {
    method: 'POST',
    body: { fileName: file.name, size: file.size, contentType },
  });
  if (ticket.strategy !== UploadStrategy.DIRECT) {
    const form = new FormData();
    form.append('file', file);
    return request<T>(base, { method: 'POST', body: form });
  }
  try {
    // Loaded on demand: only production (DIRECT) needs the Blob client.
    const { put } = await import('@vercel/blob/client');
    await put(ticket.pathname, file, {
      access: 'private',
      token: ticket.clientToken,
      contentType,
      onUploadProgress: onProgress ? (e) => onProgress(e.percentage) : undefined,
    });
  } catch {
    throw new ApiError(0, 'UPLOAD_FAILED', 'Upload to storage failed');
  }
  onProgress?.(100);
  return request<T>(`${base}/uploads/complete`, {
    method: 'POST',
    body: { pathname: ticket.pathname, fileName: file.name },
  });
}
