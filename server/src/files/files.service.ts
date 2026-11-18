import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ErrorCode, FileKind } from '@thesis/shared';
import { Connection, isObjectIdOrHexString, mongo, Types } from 'mongoose';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppException } from '../common/errors/app.exception';
import { sha256 } from '../common/security/hash';
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

export interface FileMetadata {
  ownerId: Types.ObjectId;
  thesisId?: Types.ObjectId;
  kind: FileKind;
  mimeType: string;
  sha256: string;
}

export interface StoredFile {
  id: string;
  fileName: string;
  size: number;
  mimeType: string;
  sha256: string;
  kind: FileKind;
}

export type GridFile = mongo.GridFSFile & { metadata?: FileMetadata };

@Injectable()
export class FilesService {
  private bucketInstance?: mongo.GridFSBucket;

  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** Lazy: `connection.db` is only set once the connection is open. */
  private get bucket(): mongo.GridFSBucket {
    this.bucketInstance ??= new mongo.GridFSBucket(this.connection.db!, {
      bucketName: 'files',
    });
    return this.bucketInstance;
  }

  async upload(
    file: UploadInput | undefined,
    meta: { ownerId: string; thesisId?: string; kind: FileKind },
    allowed: readonly AllowedFileType[],
  ): Promise<StoredFile> {
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
    if (!file?.buffer?.length) {
      throw new AppException(
        ErrorCode.FILE_REQUIRED,
        HttpStatus.BAD_REQUEST,
        'A file is required',
      );
    }
    if (file.size > MAX_FILE_BYTES || file.buffer.length > MAX_FILE_BYTES) {
      throw new AppException(
        ErrorCode.FILE_TOO_LARGE,
        HttpStatus.PAYLOAD_TOO_LARGE,
        'File exceeds 25 MB',
      );
    }
    const type = detectFileType(file.buffer);
    if (!type || !allowed.includes(type)) {
      throw new AppException(
        ErrorCode.FILE_TYPE_NOT_ALLOWED,
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'File type not allowed',
        { allowed },
      );
    }

    const id = new Types.ObjectId();
    const fileName = sanitizeFileName(file.originalname);
    const metadata: FileMetadata = {
      ownerId: new Types.ObjectId(meta.ownerId),
      thesisId: meta.thesisId ? new Types.ObjectId(meta.thesisId) : undefined,
      kind: meta.kind,
      mimeType: MIME_TYPES[type],
      sha256: sha256(file.buffer),
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

  async findInfo(id: string): Promise<GridFile | null> {
    if (!isObjectIdOrHexString(id)) return null;
    return (await this.bucket
      .find({ _id: new Types.ObjectId(id) })
      .next()) as GridFile | null;
  }

  async openDownload(
    id: string,
  ): Promise<{ info: GridFile; stream: Readable }> {
    const info = await this.findInfo(id);
    if (!info) {
      throw new AppException(
        ErrorCode.FILE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'File not found',
      );
    }
    return { info, stream: this.bucket.openDownloadStream(info._id) };
  }

  /** Idempotent: deleting a missing file is a no-op (used for upload rollbacks). */
  async delete(id: string): Promise<void> {
    if (!(await this.findInfo(id))) return;
    try {
      await this.bucket.delete(new Types.ObjectId(id));
    } catch (err) {
      // A concurrent delete may win the race; only swallow if the file is really gone.
      if (await this.findInfo(id)) throw err;
    }
  }
}
