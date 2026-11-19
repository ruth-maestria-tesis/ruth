import { INestApplication } from '@nestjs/common';
import { Role, ThesisStatus } from '@thesis/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import {
  assignJury,
  binaryParser,
  closeTestApp,
  createAssignableThesis,
  createCatalog,
  createTestApp,
  createThesis,
  createUser,
  http,
  loginAgent,
  TestAgent,
} from './utils/test-app';

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('Reports (e2e)', () => {
  let app: INestApplication;
  let coordinator: TestAgent;
  let admin: TestAgent;
  let catalogA: Awaited<ReturnType<typeof createCatalog>>;
  let catalogB: Awaited<ReturnType<typeof createCatalog>>;
  let codeA1: string;
  let codeB1: string;
  let jurorNames: string[];

  beforeAll(async () => {
    app = await createTestApp();
    coordinator = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.COORDINATOR] })).email,
    );
    admin = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.ADMIN] })).email,
    );
    catalogA = await createCatalog(app, { programCode: 'REPA', year: 2031 });
    catalogB = await createCatalog(app, { programCode: 'REPB', year: 2032 });

    const a1 = await createAssignableThesis(app, catalogA);
    await createThesis(app, catalogA, { title: 'Segunda tesis de A' });
    const b1 = await createThesis(app, catalogB, {
      title: 'Tesis con “comillas” y emoji 😀',
    });
    codeA1 = a1.code;
    codeB1 = b1.code;

    const jurors = [
      await createUser(app, {
        roles: [Role.INTERNAL_JUROR],
        firstName: 'Ana',
        lastName: 'Uno',
      }),
      await createUser(app, {
        roles: [Role.INTERNAL_JUROR],
        firstName: 'Beto',
        lastName: 'Dos',
      }),
    ];
    await assignJury(
      app,
      a1.id as string,
      jurors.map((j) => j.id as string),
    );
    jurorNames = ['Ana Uno', 'Beto Dos'];
  });
  afterAll(() => closeTestApp(app));

  const fetchXlsx = async (agent: TestAgent, qs = '') => {
    const res = await agent
      .get(`/api/reports/theses.xlsx${qs}`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as Parameters<typeof wb.xlsx.load>[0]);
    return { res, ws: wb.getWorksheet('Tesis')! };
  };

  const rowsOf = (ws: ExcelJS.Worksheet) => {
    const rows: string[][] = [];
    ws.eachRow((row, n) => {
      if (n > 1) rows.push((row.values as unknown[]).slice(1).map(String));
    });
    return rows;
  };

  it('returns a valid xlsx with the Spanish headers, frozen row and autofilter', async () => {
    const { res, ws } = await fetchXlsx(
      coordinator,
      `?programId=${catalogA.programId}`,
    );
    expect(res.headers['content-type']).toContain(XLSX_TYPE);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="tesis-\d{8}\.xlsx"$/,
    );
    const header = ws.getRow(1);
    expect((header.values as unknown[]).slice(1)).toEqual([
      'Código',
      'Título',
      'Estudiante',
      'Director(a)',
      'Programa',
      'Periodo',
      'Estado',
      'Jurados',
      'Fecha de radicación',
      'Última actualización',
    ]);
    expect(header.font?.bold).toBe(true);
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(ws.autoFilter).toBeTruthy();
  });

  it('applies the filters (program, status, q, codePrefix, sort)', async () => {
    const byProgram = rowsOf(
      (await fetchXlsx(admin, `?programId=${catalogA.programId}`)).ws,
    );
    expect(byProgram).toHaveLength(2);
    expect(byProgram.every((r) => r[4] === 'REPA')).toBe(true);
    const a1 = byProgram.find((r) => r[0] === codeA1)!;
    expect(a1[6]).toBe('Jurados asignados');
    expect(a1[7]).toBe(jurorNames.join(', '));

    const byStatus = rowsOf(
      (
        await fetchXlsx(
          coordinator,
          `?programId=${catalogA.programId}&status=${ThesisStatus.JURORS_ASSIGNED}`,
        )
      ).ws,
    );
    expect(byStatus.map((r) => r[0])).toEqual([codeA1]);

    const byQ = rowsOf(
      (
        await fetchXlsx(
          coordinator,
          '?q=segunda%20tesis&programId=' + catalogA.programId,
        )
      ).ws,
    );
    expect(byQ).toHaveLength(1);
    expect(byQ[0][1]).toBe('Segunda tesis de A');

    const byPrefix = rowsOf(
      (await fetchXlsx(coordinator, `?codePrefix=${codeB1.slice(0, 10)}`)).ws,
    );
    expect(byPrefix.map((r) => r[0])).toEqual([codeB1]);

    const desc = rowsOf(
      (
        await fetchXlsx(
          coordinator,
          `?programId=${catalogA.programId}&sort=code&order=desc`,
        )
      ).ws,
    ).map((r) => r[0]);
    expect(desc).toEqual([...desc].sort().reverse());
  });

  it('returns a landscape PDF that survives non-WinAnsi characters', async () => {
    const res = await coordinator
      .get(`/api/reports/theses.pdf?programId=${catalogB.programId}`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="tesis-\d{8}\.pdf"$/,
    );
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    // A4 landscape: 841.89 x 595.28
    expect(pdf.toString('latin1')).toMatch(
      /\/MediaBox \[0 0 841\.89 595\.28\]/,
    );
  });

  it('paginates the PDF across pages when there are many rows', async () => {
    const catalog = await createCatalog(app, {
      programCode: 'REPC',
      year: 2033,
    });
    for (let i = 0; i < 45; i++) await createThesis(app, catalog);
    const res = await admin
      .get(`/api/reports/theses.pdf?programId=${catalog.programId}`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    const pages = (res.body as Buffer)
      .toString('latin1')
      .match(/\/Type \/Page\b/g);
    expect(pages!.length).toBeGreaterThan(1);
  });

  it('summarizes counts by status, program and period', async () => {
    const res = await coordinator
      .get(`/api/reports/summary?programId=${catalogA.programId}`)
      .expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.byStatus).toEqual(
      expect.arrayContaining([
        { status: 'SUBMITTED', label: 'Radicada', count: 1 },
        { status: 'JURORS_ASSIGNED', label: 'Jurados asignados', count: 1 },
      ]),
    );
    expect(res.body.byProgram).toEqual([
      expect.objectContaining({
        id: catalogA.programId,
        code: 'REPA',
        count: 2,
      }),
    ]);
    expect(res.body.byPeriod).toEqual([
      expect.objectContaining({ id: catalogA.periodId, count: 2 }),
    ]);
  });

  it('rejects invalid filters with 400', async () => {
    await coordinator.get('/api/reports/theses.xlsx?status=NOPE').expect(400);
    await coordinator.get('/api/reports/theses.pdf?programId=abc').expect(400);
  });

  it('forbids students and jurors, and requires authentication', async () => {
    const student = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.STUDENT] })).email,
    );
    const juror = await loginAgent(
      app,
      (await createUser(app, { roles: [Role.INTERNAL_JUROR] })).email,
    );
    for (const agent of [student, juror]) {
      for (const path of ['theses.xlsx', 'theses.pdf', 'summary'])
        await agent.get(`/api/reports/${path}`).expect(403);
    }
    await coordinator.get('/api/reports/summary').expect(200);
    await request(http(app)).get('/api/reports/theses.xlsx').expect(401);
  });
});
