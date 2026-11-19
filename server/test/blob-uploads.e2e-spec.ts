import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Role } from '@thesis/shared';
import * as blobSdk from '@vercel/blob';
import * as blobClient from '@vercel/blob/client';
import { Types, type Connection } from 'mongoose';
import { sha256 } from '../src/common/security/hash';
import { MAX_FILE_BYTES } from '../src/files/file-type';
import {
  assignJury,
  binaryParser,
  closeTestApp,
  createAssignableThesis,
  createCatalog,
  createTestApp,
  createThesis,
  createThesisUnderEvaluation,
  createUser,
  DOCX_BYTES,
  loginAgent,
  PDF_BYTES,
  signedAgent,
  TestAgent,
} from './utils/test-app';

/** In-memory stand-in for the private Blob store: no network in tests. */
const mockStore = new Map<string, Buffer>();

jest.mock('@vercel/blob', () => {
  const { Readable } =
    jest.requireActual<typeof import('node:stream')>('node:stream');
  class BlobNotFoundError extends Error {}
  return {
    BlobNotFoundError,
    head: jest.fn((pathname: string) => {
      const b = mockStore.get(pathname);
      return b
        ? Promise.resolve({ size: b.length, contentType: 'application/pdf' })
        : Promise.reject(new BlobNotFoundError('not found'));
    }),
    get: jest.fn((pathname: string) => {
      const b = mockStore.get(pathname);
      return Promise.resolve(
        b
          ? {
              statusCode: 200,
              stream: Readable.toWeb(
                Readable.from([b.subarray(0, 1000), b.subarray(1000)]),
              ),
            }
          : null,
      );
    }),
    del: jest.fn((pathname: string) => {
      mockStore.delete(pathname);
      return Promise.resolve();
    }),
    issueSignedToken: jest.fn((o: { validUntil: number }) =>
      Promise.resolve({
        delegationToken: 'delegation',
        clientSigningToken: 'signing',
        validUntil: o.validUntil,
      }),
    ),
    presignUrl: jest.fn((_t: unknown, o: { pathname: string }) =>
      Promise.resolve({
        presignedUrl: `https://store.private.blob.vercel-storage.com/${o.pathname}?vercel-blob-signature=sig`,
      }),
    ),
  };
});

jest.mock('@vercel/blob/client', () => ({
  generateClientTokenFromReadWriteToken: jest.fn((o: { pathname: string }) =>
    Promise.resolve(`client-token:${o.pathname}`),
  ),
}));

const sdk = jest.mocked(blobSdk);
const client = jest.mocked(blobClient);

/** What the browser's `put()` would leave in the store. */
const browserPut = (pathname: string, bytes: Buffer) =>
  mockStore.set(pathname, bytes);

describe('Direct uploads to Vercel Blob (e2e, mocked SDK)', () => {
  let app: INestApplication;
  let coordinator: TestAgent;
  let owner: TestAgent;
  let stranger: TestAgent;
  let thesisId: string;
  let otherThesisId: string;

  beforeAll(async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_store_test';
    app = await createTestApp({ storageDriver: 'vercel-blob' });
    const catalog = await createCatalog(app);
    const student = await createUser(app, { roles: [Role.STUDENT] });
    thesisId = (
      await createThesis(app, catalog, {
        studentId: student.id as string,
      })
    ).id as string;
    otherThesisId = (await createThesis(app, catalog)).id as string;
    owner = await loginAgent(app, student.email);
    stranger = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.STUDENT] })).email,
    );
    coordinator = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.COORDINATOR] })).email,
    );
  });
  afterAll(async () => {
    await closeTestApp(app);
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
  });

  const base = (id = thesisId) => `/api/theses/${id}/manuscripts`;
  const ticket = (agent: TestAgent, size = PDF_BYTES.length, id = thesisId) =>
    agent.post(`${base(id)}/uploads`).send({
      fileName: 'tesis final.pdf',
      size,
      contentType: 'application/pdf',
    });
  const filesColl = () =>
    app.get<Connection>(getConnectionToken()).db!.collection('files.files');

  it('issues a DIRECT ticket scoped to one random pathname, PDF only, the declared size, ≤ 10 min', async () => {
    const before = Date.now();
    const res = await ticket(owner).expect(200);
    expect(res.body).toEqual({
      strategy: 'DIRECT',
      clientToken: expect.any(String) as string,
      pathname: expect.stringMatching(
        new RegExp(
          `^manuscripts/${thesisId}/[0-9a-f-]{36}-${PDF_BYTES.length}\\.pdf$`,
        ),
      ) as string,
      expiresAt: expect.any(String) as string,
    });
    const [opts] = client.generateClientTokenFromReadWriteToken.mock.calls[0];
    expect(opts).toMatchObject({
      token: 'vercel_blob_rw_store_test',
      pathname: res.body.pathname,
      allowedContentTypes: ['application/pdf'],
      maximumSizeInBytes: PDF_BYTES.length,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    expect(opts.validUntil).toBeLessThanOrEqual(Date.now() + 10 * 60_000);
    expect(opts.validUntil).toBeGreaterThan(before);
    // Coordinators upload too; two tickets never share a pathname.
    const again = await ticket(coordinator).expect(200);
    expect(again.body.pathname).not.toBe(res.body.pathname);
  });

  it('rejects an oversized or non-PDF declaration with the existing codes', async () => {
    const big = await ticket(owner, MAX_FILE_BYTES + 1).expect(413);
    expect(big.body.code).toBe('FILE_TOO_LARGE');
    const word = await owner
      .post(`${base()}/uploads`)
      .send({
        fileName: 'tesis.docx',
        size: 10,
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      .expect(415);
    expect(word.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
    await owner
      .post(`${base()}/uploads`)
      .send({ fileName: 'x.pdf', size: 0, contentType: 'application/pdf' })
      .expect(400);
    expect(client.generateClientTokenFromReadWriteToken).not.toHaveBeenCalled();
  });

  it('applies the same authorization as the multipart route (other student, juror, scoped session)', async () => {
    await ticket(stranger).expect(404);
    const juror = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    await ticket(await loginAgent(app, juror.email)).expect(403);
    const scoped = await signedAgent(app, juror, {
      assignmentIds: [new Types.ObjectId().toHexString()],
    });
    await ticket(scoped).expect((r) => expect([401, 403]).toContain(r.status));

    const { body } = await ticket(owner).expect(200);
    browserPut(body.pathname as string, PDF_BYTES);
    for (const agent of [stranger, scoped])
      await agent
        .post(`${base()}/uploads/complete`)
        .send({ pathname: body.pathname, fileName: 'x.pdf' })
        .expect((r) => expect([401, 403, 404]).toContain(r.status));
    expect(mockStore.has(body.pathname as string)).toBe(true);
    expect(client.generateClientTokenFromReadWriteToken).toHaveBeenCalledTimes(
      1,
    );
  });

  it('completes: registers the blob as a new version with the multipart response shape', async () => {
    const { body: t } = await ticket(owner).expect(200);
    browserPut(t.pathname as string, PDF_BYTES);
    const res = await owner
      .post(`${base()}/uploads/complete`)
      .send({ pathname: t.pathname, fileName: 'tesis final.pdf' })
      .expect(201);
    expect(res.body.manuscriptSeq).toBe(1);
    expect(res.body.manuscripts).toEqual([
      expect.objectContaining({ version: 1, fileName: 'tesis final.pdf' }),
    ]);
    expect(res.body.currentManuscriptId).toBe(res.body.manuscripts[0].fileId);
    const doc = await filesColl().findOne({
      _id: new Types.ObjectId(res.body.currentManuscriptId as string),
    });
    expect(doc).toMatchObject({
      filename: 'tesis final.pdf',
      length: PDF_BYTES.length,
      metadata: {
        storage: 'blob',
        blobPathname: t.pathname,
        mimeType: 'application/pdf',
        sha256: sha256(PDF_BYTES),
        kind: 'MANUSCRIPT',
      },
    });

    // The same blob cannot be registered twice (and is not deleted by the attempt).
    const twice = await owner
      .post(`${base()}/uploads/complete`)
      .send({ pathname: t.pathname, fileName: 'x.pdf' })
      .expect(400);
    expect(twice.body.code).toBe('FILE_UPLOAD_INVALID');
    expect(mockStore.has(t.pathname as string)).toBe(true);
  });

  it('rejects a missing blob, an oversized blob and a non-PDF magic, deleting what was uploaded', async () => {
    const complete = (pathname: string) =>
      owner
        .post(`${base()}/uploads/complete`)
        .send({ pathname, fileName: 'tesis.pdf' });

    const missing = await ticket(owner).expect(200);
    const r1 = await complete(missing.body.pathname as string).expect(400);
    expect(r1.body.code).toBe('FILE_REQUIRED');

    const big = await ticket(owner, MAX_FILE_BYTES).expect(200);
    browserPut(big.body.pathname as string, Buffer.alloc(MAX_FILE_BYTES + 1));
    const r2 = await complete(big.body.pathname as string).expect(413);
    expect(r2.body.code).toBe('FILE_TOO_LARGE');
    expect(mockStore.has(big.body.pathname as string)).toBe(false);

    const notPdf = Buffer.from('plain text, not a pdf');
    const fake = await ticket(owner, notPdf.length).expect(200);
    browserPut(fake.body.pathname as string, notPdf);
    const r3 = await complete(fake.body.pathname as string).expect(415);
    expect(r3.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(mockStore.has(fake.body.pathname as string)).toBe(false);

    const short = await ticket(owner, PDF_BYTES.length + 5).expect(200);
    browserPut(short.body.pathname as string, PDF_BYTES);
    const r4 = await complete(short.body.pathname as string).expect(400);
    expect(r4.body.code).toBe('FILE_UPLOAD_INVALID');
    expect(mockStore.has(short.body.pathname as string)).toBe(false);
  });

  it("rejects a pathname from another thesis's prefix, or a made-up one, without touching it", async () => {
    const other = await ticket(
      coordinator,
      PDF_BYTES.length,
      otherThesisId,
    ).expect(200);
    browserPut(other.body.pathname as string, PDF_BYTES);
    for (const pathname of [
      other.body.pathname as string,
      `manuscripts/${thesisId}/../${otherThesisId}/x.pdf`,
      `manuscripts/${thesisId}/not-a-ticket.pdf`,
    ]) {
      const r = await coordinator
        .post(`${base()}/uploads/complete`)
        .send({ pathname, fileName: 'x.pdf' })
        .expect(400);
      expect(r.body.code).toBe('FILE_UPLOAD_INVALID');
    }
    expect(mockStore.has(other.body.pathname as string)).toBe(true);
    expect(sdk.del).not.toHaveBeenCalled();
  });

  it('downloads a blob file as a 302 to a ≤ 5 min presigned URL (no-store), or { url } with ?as=url', async () => {
    const { body: t } = await ticket(owner).expect(200);
    browserPut(t.pathname as string, PDF_BYTES);
    const done = await owner
      .post(`${base()}/uploads/complete`)
      .send({ pathname: t.pathname, fileName: 'tesis.pdf' })
      .expect(201);
    const fileId = done.body.currentManuscriptId as string;

    const res = await owner.get(`${base()}/${fileId}`).redirects(0).expect(302);
    expect(res.headers.location).toBe(
      `https://store.private.blob.vercel-storage.com/${t.pathname}?vercel-blob-signature=sig`,
    );
    expect(res.headers['cache-control']).toBe('no-store');
    const [tokenOpts] = sdk.issueSignedToken.mock.calls[0];
    expect(tokenOpts).toMatchObject({
      pathname: t.pathname,
      operations: ['get'],
    });
    expect(tokenOpts.validUntil).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
    expect(sdk.presignUrl.mock.calls[0][1]).toMatchObject({
      operation: 'get',
      pathname: t.pathname,
      access: 'private',
    });

    const json = await coordinator
      .get(`${base()}/${fileId}?as=url`)
      .expect(200);
    expect(json.body).toEqual({
      url: res.headers.location,
      expiresAt: expect.any(String) as string,
    });
    expect(json.headers['cache-control']).toBe('no-store');

    await stranger.get(`${base()}/${fileId}`).redirects(0).expect(404);
  });

  it('keeps streaming GridFS files (seed/demo data) after the switch', async () => {
    const t = await createAssignableThesis(app); // multipart/service upload → GridFS
    const fileId = t.currentManuscriptId!.toHexString();
    const res = await coordinator
      .get(`/api/theses/${t.id as string}/manuscripts/${fileId}`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(Buffer.compare(res.body as Buffer, PDF_BYTES)).toBe(0);
    expect(res.headers['content-disposition']).toContain('attachment');
    // ?as=url on a GridFS file still streams the bytes.
    const asUrl = await coordinator
      .get(`/api/theses/${t.id as string}/manuscripts/${fileId}?as=url`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(asUrl.headers['content-type']).toContain('application/pdf');
    expect(sdk.issueSignedToken).not.toHaveBeenCalled();
  });

  it('never gives a PENDING juror the blob manuscript', async () => {
    const t = await createAssignableThesis(app);
    const jurors = [
      await createUser(app, { roles: [Role.INTERNAL_JUROR] }),
      await createUser(app, { roles: [Role.INTERNAL_JUROR] }),
    ];
    await assignJury(
      app,
      t.id as string,
      jurors.map((j) => j.id as string),
    );
    const { body: tk } = await coordinator
      .post(`/api/theses/${t.id as string}/manuscripts/uploads`)
      .send({
        fileName: 'v2.pdf',
        size: PDF_BYTES.length,
        contentType: 'application/pdf',
      })
      .expect(200);
    browserPut(tk.pathname as string, PDF_BYTES);
    const done = await coordinator
      .post(`/api/theses/${t.id as string}/manuscripts/uploads/complete`)
      .send({ pathname: tk.pathname, fileName: 'v2.pdf' })
      .expect(201);
    const pending = await loginAgent(app, jurors[0].email);
    await pending
      .get(
        `/api/theses/${t.id as string}/manuscripts/${done.body.currentManuscriptId as string}`,
      )
      .redirects(0)
      .expect(404);
    expect(sdk.issueSignedToken).not.toHaveBeenCalled();
  });

  describe('correction files', () => {
    async function draft() {
      const fx = await createThesisUnderEvaluation(app);
      const juror = await loginAgent(app, fx.jurors[0].email);
      const d = await juror
        .put(`/api/assignments/${fx.assignmentIds[0]}/evaluation`)
        .send({ rubric: { methodology: 4 } })
        .expect(200);
      return { ...fx, juror, evaluationId: d.body.id as string };
    }
    const DOCX_MIME =
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    it('lets only the owner juror (in scope) upload; detects a docx by the ZIP tail', async () => {
      const { juror, jurors, assignmentIds, evaluationId, student } =
        await draft();
      const url = `/api/evaluations/${evaluationId}/corrections/uploads`;
      // A large docx whose `word/document.xml` entry is only near the end.
      const docx = Buffer.concat([
        DOCX_BYTES.subarray(0, 30),
        Buffer.from('[Content_Types].xml'),
        Buffer.alloc(200_000),
        Buffer.from('word/document.xml'),
      ]);
      const body = {
        fileName: 'notas.docx',
        size: docx.length,
        contentType: DOCX_MIME,
      };

      const other = await loginAgent(app, jurors[1].email);
      await other.post(url).send(body).expect(404);
      await (
        await loginAgent(app, student.email)
      )
        .post(url)
        .send(body)
        .expect(403);
      const wrongScope = await signedAgent(app, jurors[0], {
        assignmentIds: [assignmentIds[1]],
      });
      await wrongScope.post(url).send(body).expect(404);
      const inScope = await signedAgent(app, jurors[0], {
        assignmentIds: [assignmentIds[0]],
      });
      await inScope.post(url).send(body).expect(200);

      const { body: t } = await juror.post(url).send(body).expect(200);
      expect(t.pathname).toMatch(
        new RegExp(`^corrections/${evaluationId}/.+\\.docx$`),
      );
      expect(
        client.generateClientTokenFromReadWriteToken.mock.calls.at(-1)?.[0],
      ).toMatchObject({ allowedContentTypes: [DOCX_MIME] });
      browserPut(t.pathname as string, docx);
      await wrongScope
        .post(`${url}/complete`)
        .send({ pathname: t.pathname, fileName: 'notas.docx' })
        .expect(404);
      const done = await juror
        .post(`${url}/complete`)
        .send({ pathname: t.pathname, fileName: 'notas.docx' })
        .expect(201);
      expect(done.body.correctionFiles).toEqual([
        expect.objectContaining({ fileName: 'notas.docx' }),
      ]);
      const fileId = done.body.correctionFiles[0].fileId as string;
      const dl = await juror
        .get(`/api/evaluations/${evaluationId}/files/${fileId}`)
        .redirects(0)
        .expect(302);
      expect(dl.headers['cache-control']).toBe('no-store');
      expect(dl.headers.location).toContain(t.pathname);
    });

    it('rejects a correction pathname issued for another evaluation', async () => {
      const a = await draft();
      const b = await draft();
      const { body: t } = await b.juror
        .post(`/api/evaluations/${b.evaluationId}/corrections/uploads`)
        .send({
          fileName: 'c.pdf',
          size: PDF_BYTES.length,
          contentType: 'application/pdf',
        })
        .expect(200);
      browserPut(t.pathname as string, PDF_BYTES);
      const r = await a.juror
        .post(`/api/evaluations/${a.evaluationId}/corrections/uploads/complete`)
        .send({ pathname: t.pathname, fileName: 'c.pdf' })
        .expect(400);
      expect(r.body.code).toBe('FILE_UPLOAD_INVALID');
      expect(mockStore.has(t.pathname as string)).toBe(true);
    });
  });
});

describe('Direct uploads with the gridfs driver (default)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    jest.clearAllMocks();
    app = await createTestApp();
  });
  afterAll(() => closeTestApp(app));

  it('answers MULTIPART (no Blob call) and keeps the multipart route; complete is refused', async () => {
    const student = await createUser(app, { roles: [Role.STUDENT] });
    const thesis = await createThesis(app, await createCatalog(app), {
      studentId: student.id as string,
    });
    const owner = await loginAgent(app, student.email);
    const base = `/api/theses/${thesis.id as string}/manuscripts`;
    const res = await owner
      .post(`${base}/uploads`)
      .send({
        fileName: 't.pdf',
        size: PDF_BYTES.length,
        contentType: 'application/pdf',
      })
      .expect(200);
    expect(res.body).toEqual({ strategy: 'MULTIPART' });
    await owner
      .post(`${base}/uploads`)
      .send({
        fileName: 't.pdf',
        size: MAX_FILE_BYTES + 1,
        contentType: 'application/pdf',
      })
      .expect(413);
    const other = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.STUDENT] })).email,
    );
    await other
      .post(`${base}/uploads`)
      .send({ fileName: 't.pdf', size: 10, contentType: 'application/pdf' })
      .expect(404);

    await owner
      .post(base)
      .attach('file', PDF_BYTES, {
        filename: 't.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    const refused = await owner
      .post(`${base}/uploads/complete`)
      .send({
        pathname: `manuscripts/${thesis.id as string}/x.pdf`,
        fileName: 't.pdf',
      })
      .expect(400);
    expect(refused.body.code).toBe('FILE_UPLOAD_INVALID');
    expect(client.generateClientTokenFromReadWriteToken).not.toHaveBeenCalled();
    expect(sdk.head).not.toHaveBeenCalled();
  });
});
