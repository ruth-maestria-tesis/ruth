import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BlobNotFoundError,
  del,
  get,
  head,
  issueSignedToken,
  presignUrl,
} from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

/** Which backend holds the bytes of new direct uploads. */
export type StorageDriver = 'gridfs' | 'vercel-blob';
export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');

/**
 * Thin wrapper over the private Vercel Blob store (the only module that imports the SDK, so tests
 * mock it in one place). Every blob is private: reads need the read-write token or a presigned URL.
 */
@Injectable()
export class BlobStorage {
  constructor(private readonly config: ConfigService) {}

  private get token(): string {
    return this.config.getOrThrow<string>('BLOB_READ_WRITE_TOKEN');
  }

  /** Client token for `put()` from `@vercel/blob/client`: one pathname, types, size and expiry. */
  uploadToken(
    pathname: string,
    limits: { contentTypes: string[]; maxBytes: number; validUntil: number },
  ): Promise<string> {
    return generateClientTokenFromReadWriteToken({
      token: this.token,
      pathname,
      allowedContentTypes: limits.contentTypes,
      maximumSizeInBytes: limits.maxBytes,
      validUntil: limits.validUntil,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  }

  /** null when the blob does not exist. */
  async head(pathname: string): Promise<{ size: number } | null> {
    try {
      const h = await head(pathname, { token: this.token });
      return { size: h.size };
    } catch (err) {
      if (err instanceof BlobNotFoundError) return null;
      throw err;
    }
  }

  /** Content stream, or null when the blob does not exist. */
  async read(pathname: string): Promise<Readable | null> {
    const res = await get(pathname, {
      token: this.token,
      access: 'private',
      useCache: false,
    });
    if (res?.statusCode !== 200) return null;
    return Readable.fromWeb(res.stream as WebReadableStream<Uint8Array>);
  }

  /** Short-lived GET URL limited to this pathname (a delegation token scoped to it). */
  async presignGet(pathname: string, validUntil: number): Promise<string> {
    const signed = await issueSignedToken({
      token: this.token,
      pathname,
      operations: ['get'],
      validUntil,
    });
    const { presignedUrl } = await presignUrl(signed, {
      operation: 'get',
      pathname,
      access: 'private',
      validUntil,
    });
    return presignedUrl;
  }

  delete(pathname: string): Promise<void> {
    return del(pathname, { token: this.token });
  }
}
