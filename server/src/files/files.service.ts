import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ErrorCode, FileKind, UploadStrategy } from '@thesis/shared';
import { Connection, isObjectIdOrHexString, mongo, Types } from 'mongoose';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppException } from '../common/errors/app.exception';
import { sha256 } from '../common/security/hash';
import { escapeRegex } from '../common/utils/escape-regex';
import {
  BlobStorage,
  STORAGE_DRIVER,
  type StorageDriver,
} from './blob-storage';
import { sanitizeFileName } from './content-disposition';
import {
  AllowedFileType,
  detectFileType,
  MAX_FILE_BYTES,
  MIME_TYPES,
} from './file-type';

/** The subset of Express.Multer.File the service needs (also easy to build in tests/seed). */
export interface UploadInput {
  buffer: Buffer;
  originalname: string;
  size: number;
}

/** Where the bytes live. Missing on files written before blob support: GridFS. */
export type FileStorage = 'gridfs' | 'blob';

export interface FileMetadata {
  ownerId: Types.ObjectId;
  thesisId?: Types.ObjectId;
  kind: FileKind;
  mimeType: string;
  sha256: string;
  storage?: FileStorage;
  /** Pathname in the private Blob store when `storage` is 'blob'. */
  blobPathname?: string;
  seedTag?: string;
}

export interface StoredFile {
  id: string;
  fileName: string;
  size: number;
  mimeType: string;
  sha256: string;
  kind: FileKind;
}

/** A `files.files` document: GridFS file info, or the same shape for a blob-stored file. */
export type GridFile = mongo.GridFSFile & { metadata?: FileMetadata };

/** A file ready to send: GridFS bytes to stream, or a short-lived presigned Blob URL. */
export type OpenedFile =
  | { info: GridFile; stream: Readable; url?: undefined }
  | { info: GridFile; url: string; expiresAt: Date; stream?: undefined };

export type UploadTicket =
  | { strategy: UploadStrategy.MULTIPART }
  | {
      strategy: UploadStrategy.DIRECT;
      clientToken: string;
      pathname: string;
      expiresAt: string;
    };

/** Lifetime of a direct-upload client token. */
export const UPLOAD_TOKEN_TTL_MS = 10 * 60_000;
/** Lifetime of a presigned download URL. */
export const DOWNLOAD_URL_TTL_MS = 5 * 60_000;
/** Bytes kept from each end of a blob for magic-byte detection (docx names sit in the ZIP's tail). */
const SNIFF_BYTES = 64 * 1024;

const EXTENSIONS: Readonly<Record<AllowedFileType, string>> = {
  pdf: 'pdf',
  doc: 'doc',
  docx: 'docx',
};

const tooLarge = () =>
  new AppException(
    ErrorCode.FILE_TOO_LARGE,
    HttpStatus.PAYLOAD_TOO_LARGE,
    'File exceeds 25 MB',
  );

const typeNotAllowed = (allowed: readonly AllowedFileType[]) =>
  new AppException(
    ErrorCode.FILE_TYPE_NOT_ALLOWED,
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    'File type not allowed',
    { allowed },
  );

const uploadInvalid = (message: string) =>
  new AppException(
    ErrorCode.FILE_UPLOAD_INVALID,
    HttpStatus.BAD_REQUEST,
    message,
  );

const isDuplicateKey = (e: unknown) => (e as { code?: number })?.code === 11000;

/** Reads a whole blob once: size, sha256 and its first/last bytes for type detection. */
async function inspect(
  stream: Readable,
): Promise<{ size: number; sha256: string; sniff: Buffer }> {
  const hash = createHash('sha256');
  let size = 0;
  let head = Buffer.alloc(0);
  let tail = Buffer.alloc(0);
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_FILE_BYTES) break;
      hash.update(chunk);
      if (head.length < SNIFF_BYTES)
        head = Buffer.concat([head, chunk]).subarray(0, SNIFF_BYTES);
      tail = Buffer.concat([tail, chunk]).subarray(-SNIFF_BYTES);
    }
  } finally {
    stream.destroy();
  }
  const sniff = size <= SNIFF_BYTES ? head : Buffer.concat([head, tail]);
  return { size, sha256: hash.digest('hex'), sniff };
}

@Injectable()
export class FilesService {
  private bucketInstance?: mongo.GridFSBucket;
  private blobIndex?: Promise<unknown>;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(STORAGE_DRIVER) readonly driver: StorageDriver,
    private readonly blobs: BlobStorage,
  ) {}

  /** Lazy: `connection.db` is only set once the connection is open. */
  private get bucket(): mongo.GridFSBucket {
    this.bucketInstance ??= new mongo.GridFSBucket(this.connection.db!, {
      bucketName: 'files',
    });
    return this.bucketInstance;
  }

  private get filesCollection() {
    return this.connection.db!.collection<GridFile>('files.files');
  }

  /** Buffer upload (multipart route, server-generated PDFs, seed): always stored in GridFS. */
  async upload(
    file: UploadInput | undefined,
    meta: { ownerId: string; thesisId?: string; kind: FileKind },
    allowed: readonly AllowedFileType[],
  ): Promise<StoredFile> {
    this.assertIds(meta);
    if (!file?.buffer?.length) {
      throw new AppException(
        ErrorCode.FILE_REQUIRED,
        HttpStatus.BAD_REQUEST,
        'A file is required',
      );
    }
    if (file.size > MAX_FILE_BYTES || file.buffer.length > MAX_FILE_BYTES) {
      throw tooLarge();
    }
    const type = detectFileType(file.buffer);
    if (!type || !allowed.includes(type)) throw typeNotAllowed(allowed);

    const id = new Types.ObjectId();
    const fileName = sanitizeFileName(file.originalname);
    const metadata: FileMetadata = {
      ownerId: new Types.ObjectId(meta.ownerId),
      thesisId: meta.thesisId ? new Types.ObjectId(meta.thesisId) : undefined,
      kind: meta.kind,
      mimeType: MIME_TYPES[type],
      sha256: sha256(file.buffer),
      storage: 'gridfs',
    };
    try {
      await pipeline(
        Readable.from(file.buffer),
        this.bucket.openUploadStreamWithId(id, fileName, { metadata }),
      );
    } catch (err) {
      // Best-effort cleanup of any partial chunks before surfacing the failure.
      await this.bucket.delete(id).catch(() => undefined);
      throw err;
    }
    return {
      id: id.toHexString(),
      fileName,
      size: file.buffer.length,
      mimeType: metadata.mimeType,
      sha256: metadata.sha256,
      kind: meta.kind,
    };
  }

  /**
   * Step 1 of a direct upload (the caller has authorized it). Validates the declared size and type,
   * then, with the vercel-blob driver, issues a client token for one random pathname under `scope`
   * (e.g. `manuscripts/<thesisId>`). With gridfs the client uses the multipart route instead.
   */
  async createUpload(
    scope: string,
    file: { fileName: string; size: number; contentType: string },
    allowed: readonly AllowedFileType[],
  ): Promise<UploadTicket> {
    if (file.size > MAX_FILE_BYTES) throw tooLarge();
    const declared = file.contentType.split(';')[0].trim().toLowerCase();
    const type = allowed.find((t) => MIME_TYPES[t] === declared);
    if (!type) throw typeNotAllowed(allowed);
    if (this.driver !== 'vercel-blob')
      return { strategy: UploadStrategy.MULTIPART };

    // The declared size is part of the pathname, so `complete` can check it without state.
    const pathname = `${scope}/${randomUUID()}-${file.size}.${EXTENSIONS[type]}`;
    const validUntil = Date.now() + UPLOAD_TOKEN_TTL_MS;
    const clientToken = await this.blobs.uploadToken(pathname, {
      contentTypes: [MIME_TYPES[type]],
      maxBytes: file.size,
      validUntil,
    });
    return {
      strategy: UploadStrategy.DIRECT,
      clientToken,
      pathname,
      expiresAt: new Date(validUntil).toISOString(),
    };
  }

  /**
   * Step 3 of a direct upload (the caller has authorized it again): the blob must be one issued for
   * `scope`, not registered yet, of the declared size and of an allowed type by its magic bytes.
   * A blob that fails these checks is deleted. Returns the registered file like `upload()`.
   */
  async completeUpload(
    scope: string,
    input: { pathname: string; fileName: string },
    meta: { ownerId: string; thesisId?: string; kind: FileKind },
    allowed: readonly AllowedFileType[],
  ): Promise<StoredFile> {
    this.assertIds(meta);
    if (this.driver !== 'vercel-blob')
      throw uploadInvalid('Direct uploads are not enabled');
    const match = new RegExp(
      `^${escapeRegex(scope)}/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-(\\d{1,9})\\.(?:pdf|doc|docx)$`,
    ).exec(input.pathname);
    if (!match)
      throw uploadInvalid('The upload does not belong to this resource');
    const { pathname } = input;
    if (
      await this.filesCollection.findOne({ 'metadata.blobPathname': pathname })
    )
      throw uploadInvalid('The upload was already registered');

    const rejectWith = async (err: AppException): Promise<never> => {
      await this.blobs.delete(pathname).catch(() => undefined);
      throw err;
    };
    const declaredSize = Number(match[1]);
    const found = await this.blobs.head(pathname);
    if (!found) {
      throw new AppException(
        ErrorCode.FILE_REQUIRED,
        HttpStatus.BAD_REQUEST,
        'The uploaded file was not found',
      );
    }
    if (found.size > MAX_FILE_BYTES) return rejectWith(tooLarge());
    if (found.size === 0 || found.size !== declaredSize)
      return rejectWith(uploadInvalid('The uploaded size does not match'));
    const stream = await this.blobs.read(pathname);
    if (!stream) {
      throw new AppException(
        ErrorCode.FILE_REQUIRED,
        HttpStatus.BAD_REQUEST,
        'The uploaded file was not found',
      );
    }
    const content = await inspect(stream);
    if (content.size > MAX_FILE_BYTES) return rejectWith(tooLarge());
    if (content.size !== declaredSize)
      return rejectWith(uploadInvalid('The uploaded size does not match'));
    const type = detectFileType(content.sniff);
    if (!type || !allowed.includes(type))
      return rejectWith(typeNotAllowed(allowed));

    const id = new Types.ObjectId();
    const fileName = sanitizeFileName(input.fileName);
    const metadata: FileMetadata = {
      ownerId: new Types.ObjectId(meta.ownerId),
      thesisId: meta.thesisId ? new Types.ObjectId(meta.thesisId) : undefined,
      kind: meta.kind,
      mimeType: MIME_TYPES[type],
      sha256: content.sha256,
      storage: 'blob',
      blobPathname: pathname,
    };
    await this.ensureBlobIndex();
    try {
      // Same document shape as GridFS so findInfo/list/seed tagging treat both alike (no chunks).
      await this.filesCollection.insertOne({
        _id: id,
        length: content.size,
        chunkSize: 255 * 1024,
        uploadDate: new Date(),
        filename: fileName,
        metadata,
      });
    } catch (err) {
      // A concurrent `complete` of the same pathname won: the blob belongs to it, keep it.
      if (isDuplicateKey(err))
        throw uploadInvalid('The upload was already registered');
      throw err;
    }
    return {
      id: id.toHexString(),
      fileName,
      size: content.size,
      mimeType: metadata.mimeType,
      sha256: metadata.sha256,
      kind: meta.kind,
    };
  }

  async findInfo(id: string): Promise<GridFile | null> {
    if (!isObjectIdOrHexString(id)) return null;
    return (await this.bucket
      .find({ _id: new Types.ObjectId(id) })
      .next()) as GridFile | null;
  }

  /** GridFS files stream; blob files get a presigned GET URL (5 minutes). */
  async openDownload(id: string): Promise<OpenedFile> {
    const info = await this.findInfo(id);
    if (!info) {
      throw new AppException(
        ErrorCode.FILE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'File not found',
      );
    }
    const pathname = info.metadata?.blobPathname;
    if (info.metadata?.storage === 'blob' && pathname) {
      const expiresAt = new Date(Date.now() + DOWNLOAD_URL_TTL_MS);
      const url = await this.blobs.presignGet(pathname, expiresAt.getTime());
      return { info, url, expiresAt };
    }
    return { info, stream: this.bucket.openDownloadStream(info._id) };
  }

  /** Idempotent: deleting a missing file is a no-op (used for upload rollbacks). */
  async delete(id: string): Promise<void> {
    const info = await this.findInfo(id);
    if (!info) return;
    if (info.metadata?.storage === 'blob') {
      if (info.metadata.blobPathname)
        await this.blobs.delete(info.metadata.blobPathname);
      await this.filesCollection.deleteOne({ _id: info._id });
      return;
    }
    try {
      await this.bucket.delete(new Types.ObjectId(id));
    } catch (err) {
      // A concurrent delete may win the race; only swallow if the file is really gone.
      if (await this.findInfo(id)) throw err;
    }
  }

  private assertIds(meta: { ownerId: string; thesisId?: string }): void {
    if (
      !isObjectIdOrHexString(meta.ownerId) ||
      (meta.thesisId !== undefined && !isObjectIdOrHexString(meta.thesisId))
    ) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'Invalid id',
      );
    }
  }

  /** One registration per blob, even under concurrent `complete` calls. */
  private ensureBlobIndex(): Promise<unknown> {
    this.blobIndex ??= this.filesCollection
      .createIndex(
        { 'metadata.blobPathname': 1 },
        {
          unique: true,
          partialFilterExpression: {
            'metadata.blobPathname': { $type: 'string' },
          },
        },
      )
      .catch((err: unknown) => {
        this.blobIndex = undefined;
        throw err;
      });
    return this.blobIndex;
  }
}
