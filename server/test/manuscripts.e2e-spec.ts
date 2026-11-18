import { INestApplication } from '@nestjs/common';
import { Role, ThesisStatus } from '@thesis/shared';
import { MAX_FILE_BYTES } from '../src/files/file-type';
import { ThesisDocument } from '../src/theses/schemas/thesis.schema';
import {
  binaryParser,
  closeTestApp,
  createCatalog,
  createTestApp,
  createThesis,
  createUser,
  DOCX_BYTES,
  loginAgent,
  PDF_BYTES,
  TestAgent,
} from './utils/test-app';

describe('Manuscripts (e2e)', () => {
  let app: INestApplication;
  let coordinator: TestAgent;
  let admin: TestAgent;
  let owner: TestAgent;
  let stranger: TestAgent;
  let juror: TestAgent;
  let thesis: ThesisDocument;

  beforeAll(async () => {
    app = await createTestApp();
    const catalog = await createCatalog(app);
    const c = await createUser(app, { roles: [Role.COORDINATOR] });
    const a = await createUser(app, { roles: [Role.ADMIN] });
    const s = await createUser(app, { roles: [Role.STUDENT] });
    const other = await createUser(app, { roles: [Role.STUDENT] });
    const j = await createUser(app, { roles: [Role.INTERNAL_JUROR] });
    thesis = await createThesis(app, catalog, { studentId: s.id as string });
    coordinator = await loginAgent(app, c.email);
    admin = await loginAgent(app, a.email);
    owner = await loginAgent(app, s.email);
    stranger = await loginAgent(app, other.email);
    juror = await loginAgent(app, j.email);
  });
  afterAll(() => closeTestApp(app));

  const url = () => `/api/theses/${thesis.id as string}/manuscripts`;
  const pdf = (filename: string) => ({
    filename,
    contentType: 'application/pdf',
  });
  const firstFileId = async () =>
    (await coordinator.get(`/api/theses/${thesis.id as string}`).expect(200))
      .body.manuscripts[0].fileId as string;

  it('owner student uploads v1, coordinator uploads v2; current points to v2', async () => {
    const r1 = await owner
      .post(url())
      .attach('file', PDF_BYTES, pdf('tesis v1.pdf'))
      .expect(201);
    expect(r1.body.manuscripts).toEqual([
      expect.objectContaining({ version: 1, fileName: 'tesis v1.pdf' }),
    ]);
    const r2 = await coordinator
      .post(url())
      .attach('file', PDF_BYTES, pdf('tesis v2.pdf'))
      .expect(201);
    expect(
      r2.body.manuscripts.map((m: { version: number }) => m.version),
    ).toEqual([1, 2]);
    expect(r2.body.currentManuscriptId).toBe(r2.body.manuscripts[1].fileId);
  });

  it('keeps non-ASCII file names intact on upload and download', async () => {
    const res = await coordinator
      .post(url())
      .attach('file', PDF_BYTES, pdf('tesis versión.pdf'))
      .expect(201);
    const last = res.body.manuscripts[res.body.manuscripts.length - 1] as {
      fileId: string;
      fileName: string;
    };
    expect(last.fileName).toBe('tesis versión.pdf');
    const dl = await coordinator
      .get(`${url()}/${last.fileId}`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(dl.headers['content-disposition']).toContain(
      "filename*=UTF-8''tesis%20versi%C3%B3n.pdf",
    );
  });

  it('downloads the file with attachment headers for owner, coordinator and admin', async () => {
    const fileId = await firstFileId();
    for (const agent of [owner, coordinator, admin]) {
      const res = await agent
        .get(`${url()}/${fileId}`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain('attachment;');
      expect((res.body as Buffer).equals(PDF_BYTES)).toBe(true);
    }
  });

  it('admin is read-only: cannot upload (403)', async () => {
    await admin.post(url()).attach('file', PDF_BYTES, pdf('x.pdf')).expect(403);
  });

  it('other students and jurors cannot upload or download (404 / 403)', async () => {
    const fileId = await firstFileId();
    await stranger.get(`${url()}/${fileId}`).expect(404);
    await stranger
      .post(url())
      .attach('file', PDF_BYTES, pdf('x.pdf'))
      .expect(404);
    await juror.get(`${url()}/${fileId}`).expect(403);
  });

  it('an admin who is also a non-owner student still cannot upload (404)', async () => {
    const both = await createUser(app, { roles: [Role.ADMIN, Role.STUDENT] });
    const agent = await loginAgent(app, both.email);
    const res = await agent
      .post(url())
      .attach('file', PDF_BYTES, pdf('x.pdf'))
      .expect(404);
    expect(res.body.code).toBe('THESIS_NOT_FOUND');
  });

  it('rejects non-PDF content even when declared as PDF (415)', async () => {
    const res = await owner
      .post(url())
      .attach('file', DOCX_BYTES, pdf('fake.pdf'))
      .expect(415);
    expect(res.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('rejects a missing file (400) and a file over 25 MB (413)', async () => {
    const missing = await owner.post(url()).expect(400);
    expect(missing.body.code).toBe('FILE_REQUIRED');
    const big = Buffer.concat([PDF_BYTES, Buffer.alloc(MAX_FILE_BYTES)]);
    const res = await owner
      .post(url())
      .attach('file', big, pdf('big.pdf'))
      .expect(413);
    expect(res.body.code).toBe('FILE_TOO_LARGE');
  });

  it('a file id that is not a manuscript of this thesis is 404 FILE_NOT_FOUND', async () => {
    const res = await coordinator
      .get(`${url()}/65a1b2c3d4e5f60718293a4b`)
      .expect(404);
    expect(res.body.code).toBe('FILE_NOT_FOUND');
  });

  it('closed theses do not accept new manuscripts', async () => {
    await thesis.updateOne({ status: ThesisStatus.COMPLETED_APPROVED });
    const res = await owner
      .post(url())
      .attach('file', PDF_BYTES, pdf('late.pdf'))
      .expect(409);
    expect(res.body.code).toBe('THESIS_CLOSED');
  });
});
