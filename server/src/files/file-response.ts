import { HttpStatus, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { contentDisposition } from './content-disposition';
import type { OpenedFile } from './files.service';

/** `?as=url` body for a blob-stored file: the presigned URL instead of a redirect. */
export interface FileUrlView {
  url: string;
  expiresAt: string;
}

/**
 * Response of a download route (handler declared with `@Res({ passthrough: true })`):
 * - GridFS file: streamed as an attachment, as before;
 * - blob file: `302` to a presigned GET URL (5 min), or `{ url, expiresAt }` with `?as=url`
 *   (the SPA then fetches the bytes itself), both with `Cache-Control: no-store`.
 */
export function fileResponse(
  opened: OpenedFile,
  res: Response,
  opts: { asUrl?: boolean; type?: string } = {},
): StreamableFile | FileUrlView | undefined {
  const { info } = opened;
  if (opened.stream) {
    // StreamableFile attaches an error handler to the GridFS stream (logs; 400 or socket end),
    // so a stream failure cannot become an unhandled 'error' event.
    return new StreamableFile(opened.stream, {
      type: opts.type ?? info.metadata?.mimeType ?? 'application/octet-stream',
      disposition: contentDisposition(info.filename),
      length: info.length,
    });
  }
  res.setHeader('Cache-Control', 'no-store');
  if (opts.asUrl)
    return { url: opened.url, expiresAt: opened.expiresAt.toISOString() };
  res.status(HttpStatus.FOUND).setHeader('Location', opened.url);
  return undefined;
}
