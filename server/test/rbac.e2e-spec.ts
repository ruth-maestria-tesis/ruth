import { INestApplication } from '@nestjs/common';
import { Role } from '@thesis/shared';
import request from 'supertest';
import {
  closeTestApp,
  createCatalog,
  createTestApp,
  createThesis,
  createUser,
  http,
  loginAgent,
  TestAgent,
} from './utils/test-app';

type Method = 'get' | 'post' | 'patch';
interface Row {
  method: Method;
  path: string;
  allowed: Role[];
}

const ALL: Role[] = [
  Role.ADMIN,
  Role.COORDINATOR,
  Role.INTERNAL_JUROR,
  Role.STUDENT,
];
const WITH_EXTERNAL: Role[] = [...ALL, Role.EXTERNAL_JUROR];
const MANAGERS: Role[] = [Role.ADMIN, Role.COORDINATOR];
const ID = '65a1b2c3d4e5f60718293a4b';

/** RBAC matrix (mapa-navegacion-rbac.md §3) for stage-2 endpoints. */
const matrix = (thesisId: string): Row[] => [
  { method: 'get', path: '/api/programs', allowed: WITH_EXTERNAL },
  { method: 'post', path: '/api/programs', allowed: MANAGERS },
  { method: 'patch', path: `/api/programs/${ID}`, allowed: MANAGERS },
  { method: 'get', path: '/api/periods', allowed: WITH_EXTERNAL },
  { method: 'post', path: '/api/periods', allowed: MANAGERS },
  { method: 'patch', path: `/api/periods/${ID}`, allowed: MANAGERS },
  { method: 'get', path: '/api/cohorts', allowed: WITH_EXTERNAL },
  { method: 'post', path: '/api/cohorts', allowed: MANAGERS },
  { method: 'patch', path: `/api/cohorts/${ID}`, allowed: MANAGERS },
  { method: 'get', path: '/api/theses', allowed: MANAGERS },
  { method: 'post', path: '/api/theses', allowed: [Role.COORDINATOR] },
  { method: 'get', path: '/api/theses/mine', allowed: [Role.STUDENT] },
  {
    method: 'get',
    path: `/api/theses/${thesisId}`,
    allowed: [Role.ADMIN, Role.COORDINATOR, Role.STUDENT],
  },
  {
    method: 'patch',
    path: `/api/theses/${thesisId}`,
    allowed: [Role.COORDINATOR],
  },
  {
    method: 'post',
    path: `/api/theses/${thesisId}/manuscripts`,
    allowed: [Role.COORDINATOR, Role.STUDENT],
  },
  {
    method: 'get',
    path: `/api/theses/${thesisId}/manuscripts/${ID}`,
    allowed: [Role.ADMIN, Role.COORDINATOR, Role.STUDENT],
  },
];

describe('RBAC matrix — stage 2 (e2e)', () => {
  let app: INestApplication;
  const agents = new Map<Role, TestAgent>();
  let rows: Row[];

  beforeAll(async () => {
    app = await createTestApp();
    for (const role of WITH_EXTERNAL) {
      const u = await createUser(app, { roles: [role] });
      agents.set(role, await loginAgent(app, u.email));
    }
    const thesis = await createThesis(app, await createCatalog(app));
    rows = matrix(thesis.id as string);
  });
  afterAll(() => closeTestApp(app));

  it('anonymous requests get 401 on every endpoint', async () => {
    for (const row of rows) {
      const res = await request(http(app))[row.method](row.path).send({});
      expect({ row: `${row.method} ${row.path}`, status: res.status }).toEqual({
        row: `${row.method} ${row.path}`,
        status: 401,
      });
    }
  });

  it.each(WITH_EXTERNAL)(
    '%s gets 403 exactly on the endpoints it is not allowed to use',
    async (role) => {
      for (const row of rows) {
        const res = await agents.get(role)![row.method](row.path).send({});
        expect({
          row: `${row.method} ${row.path}`,
          ok: res.status < 500,
        }).toEqual({
          row: `${row.method} ${row.path}`,
          ok: true,
        });
        const got =
          res.status === 403
            ? 'forbidden'
            : res.status === 401
              ? 'unauthenticated'
              : 'passed';
        const expected = row.allowed.includes(role) ? 'passed' : 'forbidden';
        expect({ row: `${row.method} ${row.path}`, got }).toEqual({
          row: `${row.method} ${row.path}`,
          got: expected,
        });
      }
    },
  );
});
