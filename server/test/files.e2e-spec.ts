import { INestApplication } from '@nestjs/common';
import { FileKind } from '@thesis/shared';
import { Types } from 'mongoose';
import { text } from 'node:stream/consumers';
import { sha256 } from '../src/common/security/hash';
import { FilesService } from '../src/files/files.service';
import { MAX_FILE_BYTES } from '../src/files/file-type';
import {
  closeTestApp,
  createTestApp,
  DOCX_BYTES,
  PDF_BYTES,
} from './utils/test-app';

describe('FilesService (e2e, GridFS)', () => {
  let app: INestApplication;
  let files: FilesService;
  const ownerId = new Types.ObjectId().toHexString();

  beforeAll(async () => {
    app = await createTestApp();
    files = app.get(FilesService);
  });
  afterAll(() => closeTestApp(app));

  const input = (buffer: Buffer, originalname = 'tesis.pdf') => ({
    buffer,
    originalname,
    size: buffer.length,
  });

  it('stores a PDF with metadata and streams it back', async () => {
    const stored = await files.upload(
      input(PDF_BYTES),
      { ownerId, kind: FileKind.MANUSCRIPT },
      ['pdf'],
    );
    expect(stored).toMatchObject({
      fileName: 'tesis.pdf',
      size: PDF_BYTES.length,
      mimeType: 'application/pdf',
      sha256: sha256(PDF_BYTES),
      kind: FileKind.MANUSCRIPT,
    });
    const { info, stream } = await files.openDownload(stored.id);
    expect(info.metadata).toMatchObject({
      kind: FileKind.MANUSCRIPT,
      mimeType: 'application/pdf',
    });
    expect(await text(stream)).toBe(PDF_BYTES.toString());
  });

  it('accepts docx where allowed and labels its MIME type', async () => {
    const stored = await files.upload(
      input(DOCX_BYTES, 'correcciones.docx'),
      { ownerId, kind: FileKind.CORRECTION },
      ['pdf', 'doc', 'docx'],
    );
    expect(stored.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('rejects a disallowed type with 415 FILE_TYPE_NOT_ALLOWED', async () => {
    await expect(
      files.upload(
        input(DOCX_BYTES, 'x.pdf'),
        { ownerId, kind: FileKind.MANUSCRIPT },
        ['pdf'],
      ),
    ).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED', status: 415 });
  });

  it('rejects a missing or oversized file', async () => {
    await expect(
      files.upload(undefined, { ownerId, kind: FileKind.MANUSCRIPT }, ['pdf']),
    ).rejects.toMatchObject({ code: 'FILE_REQUIRED' });
    await expect(
      files.upload(
        { ...input(PDF_BYTES), size: MAX_FILE_BYTES + 1 },
        { ownerId, kind: FileKind.MANUSCRIPT },
        ['pdf'],
      ),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE', status: 413 });
  });

  it('delete removes the file; unknown ids → FILE_NOT_FOUND', async () => {
    const stored = await files.upload(
      input(PDF_BYTES),
      { ownerId, kind: FileKind.MANUSCRIPT },
      ['pdf'],
    );
    await files.delete(stored.id);
    await expect(files.openDownload(stored.id)).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND',
    });
    await expect(files.delete(stored.id)).resolves.toBeUndefined();
  });

  const OLE_BYTES = Buffer.from([
    0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0,
  ]);

  it('accepts a legacy doc where allowed with the msword MIME type', async () => {
    const stored = await files.upload(
      input(OLE_BYTES, 'viejo.doc'),
      { ownerId, kind: FileKind.CORRECTION },
      ['pdf', 'doc', 'docx'],
    );
    expect(stored.mimeType).toBe('application/msword');
  });

  it('stores a sanitized name for paths and non-ASCII input', async () => {
    const stored = await files.upload(
      input(PDF_BYTES, '../dir/Tesis versión.pdf'),
      { ownerId, kind: FileKind.MANUSCRIPT },
      ['pdf'],
    );
    expect(stored.fileName).toBe('Tesis versión.pdf');
    const { info } = await files.openDownload(stored.id);
    expect(info.filename).toBe('Tesis versión.pdf');
  });

  it('stores ownerId as ObjectId and thesisId when given', async () => {
    const thesisId = new Types.ObjectId().toHexString();
    const stored = await files.upload(
      input(PDF_BYTES),
      { ownerId, thesisId, kind: FileKind.MANUSCRIPT },
      ['pdf'],
    );
    const { info, stream } = await files.openDownload(stored.id);
    stream.destroy();
    expect(info.metadata?.ownerId).toBeInstanceOf(Types.ObjectId);
    expect(info.metadata?.ownerId.toHexString()).toBe(ownerId);
    expect(info.metadata?.thesisId?.toHexString()).toBe(thesisId);
  });

  it('rejects invalid owner or thesis ids with VALIDATION_FAILED', async () => {
    await expect(
      files.upload(
        input(PDF_BYTES),
        { ownerId: 'nope', kind: FileKind.MANUSCRIPT },
        ['pdf'],
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    await expect(
      files.upload(
        input(PDF_BYTES),
        { ownerId, thesisId: 'nope', kind: FileKind.MANUSCRIPT },
        ['pdf'],
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('openDownload with a malformed id → FILE_NOT_FOUND', async () => {
    await expect(files.openDownload('not-an-id')).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND',
    });
  });

  it('rejects a real buffer over 25 MB with an honest size', async () => {
    const big = Buffer.concat([
      PDF_BYTES,
      Buffer.alloc(MAX_FILE_BYTES - PDF_BYTES.length + 1),
    ]);
    await expect(
      files.upload(input(big), { ownerId, kind: FileKind.MANUSCRIPT }, ['pdf']),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE', status: 413 });
  });

  it('delete tolerates a concurrent delete', async () => {
    const stored = await files.upload(
      input(PDF_BYTES),
      { ownerId, kind: FileKind.MANUSCRIPT },
      ['pdf'],
    );
    await Promise.all([files.delete(stored.id), files.delete(stored.id)]);
    await expect(files.openDownload(stored.id)).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND',
    });
  });
});
