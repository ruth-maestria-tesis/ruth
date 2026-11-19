/**
 * Typed API calls (spec §8). Modules not yet on the server go through
 * `utils/mocks.ts` when listed in runtimeConfig.public.mockModules.
 */
import { ThesisStatus } from '@thesis/shared';
import type {
  AppNotification,
  Assignment,
  Chapter,
  Cohort,
  CreateThesisInput,
  DashboardData,
  Defense,
  DefenseInput,
  DisputeView,
  Evaluation,
  EvaluationInput,
  FeedbackAction,
  FeedbackItem,
  JurorInput,
  JuryResult,
  JuryViolationItem,
  Minutes,
  Paginated,
  Period,
  Program,
  Thesis,
  ThesisQuery,
  ThesisSummary,
  User,
  ExternalLink,
} from '~/types/api';
import { request } from './http';
import {
  isMocked,
  mockDefenses,
  mockDisputes,
  mockEvaluations,
  mockFeedback,
  mockMinutes,
  mockNotifications,
} from './mocks';

const asList = <T>(r: T[] | Paginated<T>): T[] => (Array.isArray(r) ? r : r.items);

export const authApi = {
  login: (email: string, password: string) =>
    request<{ user: User }>('/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<{ user: User }>('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('/auth/password', { method: 'PATCH', body: { currentPassword, newPassword } }),
  validateExternalToken: (token: string) =>
    request<{ user: User }>('/auth/external/validate-token', { method: 'POST', body: { token } }),
};

export const usersApi = {
  list: (query: { role?: string; q?: string; page?: number; limit?: number } = {}) =>
    request<Paginated<User>>('/users', { query }),
  get: (id: string) => request<User>(`/users/${id}`),
  faculty: (q?: string) => request<User[]>('/users/faculty', { query: { q } }),
  create: (body: Record<string, unknown>) => request<User>('/users', { method: 'POST', body }),
  update: (id: string, body: Record<string, unknown>) => request<User>(`/users/${id}`, { method: 'PATCH', body }),
  setStatus: (id: string, isActive: boolean) =>
    request<User>(`/users/${id}/status`, { method: 'PATCH', body: { isActive } }),
};

export const catalogsApi = {
  programs: async () => asList(await request<Program[] | Paginated<Program>>('/programs', { query: { limit: 100 } })),
  periods: async () => asList(await request<Period[] | Paginated<Period>>('/periods', { query: { limit: 100 } })),
  cohorts: async (programId?: string) =>
    asList(await request<Cohort[] | Paginated<Cohort>>('/cohorts', { query: { programId, limit: 100 } })),
};

export const thesesApi = {
  list: (query: ThesisQuery) => request<Paginated<Thesis>>('/theses', { query: { ...query } }),
  mine: () => request<Thesis[]>('/theses/mine'),
  get: (id: string) => request<Thesis>(`/theses/${id}`),
  create: (body: CreateThesisInput) => request<Thesis>('/theses', { method: 'POST', body }),
  update: (id: string, body: Partial<CreateThesisInput>) => request<Thesis>(`/theses/${id}`, { method: 'PATCH', body }),
  uploadManuscript: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<Thesis>(`/theses/${id}/manuscripts`, { method: 'POST', body: form });
  },
  manuscriptPath: (id: string, fileId: string) => `/theses/${id}/manuscripts/${fileId}`,
};

export const assignmentsApi = {
  validate: (thesisId: string, jurors: JurorInput[], responseBusinessDays?: number) =>
    request<{ valid: boolean; violations: JuryViolationItem[] }>('/assignments/validate', {
      method: 'POST',
      body: { thesisId, jurors, responseBusinessDays },
    }),
  assign: (thesisId: string, jurors: JurorInput[], responseBusinessDays?: number) =>
    request<JuryResult>(`/theses/${thesisId}/assignments`, { method: 'POST', body: { jurors, responseBusinessDays } }),
  replace: (thesisId: string, assignmentId: string, juror: JurorInput, responseBusinessDays?: number) =>
    request<{ assignment: Assignment; externalLink?: ExternalLink }>(`/theses/${thesisId}/assignments/replace`, {
      method: 'POST',
      body: { assignmentId, juror, responseBusinessDays },
    }),
  tiebreaker: (thesisId: string, juror: JurorInput, responseBusinessDays?: number) =>
    request<{ assignment: Assignment; externalLink?: ExternalLink }>(`/theses/${thesisId}/assignments/tiebreaker`, {
      method: 'POST',
      body: { juror, responseBusinessDays },
    }),
  forThesis: (thesisId: string) => request<Assignment[]>(`/theses/${thesisId}/assignments`),
  mine: (status?: string) => request<Assignment[]>('/assignments/mine', { query: { status } }),
  get: (id: string) => request<Assignment>(`/assignments/${id}`),
  accept: (id: string) => request<Assignment>(`/assignments/${id}/accept`, { method: 'POST' }),
  decline: (id: string, reason: string) =>
    request<Assignment>(`/assignments/${id}/decline`, { method: 'POST', body: { reason } }),
  externalLink: (id: string) => request<ExternalLink>(`/assignments/${id}/external-link`),
  /** Juror manuscript access (contract pending on main). */
  manuscriptPath: (id: string) => `/assignments/${id}/manuscript`,
};

export const evaluationsApi = {
  forThesis: (thesisId: string): Promise<Evaluation[]> =>
    isMocked('evaluations') ? mockEvaluations.listForThesis(thesisId) : request(`/theses/${thesisId}/evaluations`),
  forAssignment: async (assignmentId: string): Promise<Evaluation | null> => {
    if (isMocked('evaluations')) return mockEvaluations.getForAssignment(assignmentId);
    try {
      return await request<Evaluation>(`/assignments/${assignmentId}/evaluation`);
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  },
  saveDraft: (assignmentId: string, body: EvaluationInput): Promise<Evaluation> =>
    isMocked('evaluations')
      ? mockEvaluations.saveDraft(assignmentId, body)
      : request(`/assignments/${assignmentId}/evaluation`, { method: 'PUT', body }),
  submit: (assignmentId: string): Promise<Evaluation> =>
    isMocked('evaluations')
      ? mockEvaluations.submit(assignmentId)
      : request(`/assignments/${assignmentId}/evaluation/submit`, { method: 'POST' }),
  uploadCorrection: (evaluationId: string, file: File): Promise<Evaluation> => {
    if (isMocked('evaluations')) return mockEvaluations.uploadCorrection(evaluationId, file);
    const form = new FormData();
    form.append('file', file);
    return request(`/evaluations/${evaluationId}/corrections`, { method: 'POST', body: form });
  },
  get: (id: string): Promise<Evaluation> => request(`/evaluations/${id}`),
  filePath: (id: string, fileId: string) => `/evaluations/${id}/files/${fileId}`,
};

export interface Author {
  id: string;
  name: string;
  role: string;
}

export const feedbackApi = {
  list: (thesisId: string, chapter?: Chapter): Promise<FeedbackItem[]> =>
    isMocked('feedback') ? mockFeedback.list(thesisId, chapter) : request(`/theses/${thesisId}/feedback`, { query: { chapter } }),
  create: (thesisId: string, body: { chapter: Chapter; reference?: string; content: string }, author: Author): Promise<FeedbackItem> =>
    isMocked('feedback') ? mockFeedback.create(thesisId, body, author) : request(`/theses/${thesisId}/feedback`, { method: 'POST', body }),
  act: (id: string, action: FeedbackAction, content: string, author: Author, file?: File | null): Promise<FeedbackItem> => {
    if (isMocked('feedback')) return mockFeedback.act(id, action, content, author);
    const path = `/feedback/${id}/${action.toLowerCase()}`;
    if (file) {
      const form = new FormData();
      form.append('content', content);
      form.append('file', file);
      return request(path, { method: 'POST', body: form });
    }
    return request(path, { method: 'POST', body: { content } });
  },
};

export const disputesApi = {
  get: (thesis: ThesisSummary): Promise<DisputeView> =>
    isMocked('disputes') ? mockDisputes.get(thesis) : request(`/theses/${thesis.id}/dispute`),
};

export const defensesApi = {
  list: (): Promise<Defense[]> => (isMocked('defenses') ? mockDefenses.list() : request<Defense[] | Paginated<Defense>>('/defenses').then(asList)),
  forThesis: async (thesisId: string): Promise<Defense | null> => {
    if (isMocked('defenses')) return mockDefenses.forThesis(thesisId);
    const all = asList(await request<Defense[] | Paginated<Defense>>('/defenses', { query: { thesisId } }));
    return all.find((d) => d.thesisId === thesisId && d.status !== 'CANCELLED') ?? null;
  },
  schedule: (thesis: ThesisSummary, body: DefenseInput): Promise<Defense> =>
    isMocked('defenses') ? mockDefenses.schedule(thesis, body) : request(`/theses/${thesis.id}/defense`, { method: 'POST', body }),
  update: (id: string, body: Partial<DefenseInput>): Promise<Defense> =>
    isMocked('defenses') ? mockDefenses.update(id, body) : request(`/defenses/${id}`, { method: 'PATCH', body }),
  confirm: (id: string, author: Author): Promise<Defense> =>
    isMocked('defenses') ? mockDefenses.confirm(id, author) : request(`/defenses/${id}/confirm`, { method: 'POST' }),
};

export const minutesApi = {
  forThesis: async (thesisId: string): Promise<Minutes | null> => {
    if (isMocked('minutes')) return mockMinutes.forThesis(thesisId);
    try {
      return await request<Minutes>(`/theses/${thesisId}/minutes`);
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  },
  create: (thesisId: string): Promise<Minutes> =>
    isMocked('minutes') ? mockMinutes.create(thesisId) : request(`/theses/${thesisId}/minutes`, { method: 'POST', body: {} }),
  update: (id: string, body: Partial<Pick<Minutes, 'finalGrade' | 'verdict' | 'remarks'>>): Promise<Minutes> =>
    isMocked('minutes') ? mockMinutes.update(id, body) : request(`/minutes/${id}`, { method: 'PATCH', body }),
  sign: (id: string, author: Author): Promise<Minutes> =>
    isMocked('minutes') ? mockMinutes.sign(id, author) : request(`/minutes/${id}/sign`, { method: 'POST', body: { confirm: true } }),
  pdfPath: (id: string) => `/minutes/${id}/pdf`,
};

export const notificationsApi = {
  list: (): Promise<AppNotification[]> =>
    isMocked('notifications')
      ? mockNotifications.list()
      : request<AppNotification[] | Paginated<AppNotification>>('/notifications').then(asList),
  unreadCount: (): Promise<{ count: number }> =>
    isMocked('notifications') ? mockNotifications.unreadCount() : request('/notifications/unread-count'),
  read: (id: string): Promise<void> =>
    isMocked('notifications') ? mockNotifications.read(id) : request(`/notifications/${id}/read`, { method: 'POST' }),
  readAll: (): Promise<void> =>
    isMocked('notifications') ? mockNotifications.readAll() : request('/notifications/read-all', { method: 'POST' }),
};

const ACTIVE = Object.values(ThesisStatus);
export const dashboardApi = {
  /** While the dashboard module is missing, counts are computed from the real thesis list. */
  coordinator: async (filters: { programId?: string; periodId?: string; cohortId?: string } = {}): Promise<DashboardData> => {
    if (!isMocked('dashboard')) return request('/dashboard/coordinator', { query: filters });
    const counts = await Promise.all(
      ACTIVE.map(async (status) => [status, (await thesesApi.list({ ...filters, status, limit: 1 })).total] as const),
    );
    const byStatus = Object.fromEntries(counts) as DashboardData['byStatus'];
    const closed = ['NOT_APPROVED', 'COMPLETED_APPROVED', 'COMPLETED_FAILED'].reduce(
      (s, k) => s + (byStatus[k as ThesisStatus] ?? 0),
      0,
    );
    const total = counts.reduce((s, [, n]) => s + n, 0);
    const alerts: DashboardData['alerts'] = [];
    if (byStatus.IN_DISPUTE) alerts.push({ kind: 'DISPUTE', severity: 'error', message: `${byStatus.IN_DISPUTE} tesis en discrepancia requieren jurado dirimente (RN-08).` });
    if (byStatus.PENDING_JUROR_REPLACEMENT) alerts.push({ kind: 'REPLACEMENT', severity: 'warning', message: `${byStatus.PENDING_JUROR_REPLACEMENT} tesis esperan el reemplazo de un jurado que declinó o venció su plazo.` });
    if (byStatus.SUBMITTED) alerts.push({ kind: 'SUBMITTED', severity: 'info', message: `${byStatus.SUBMITTED} tesis radicadas esperan asignación de jurados (CU-01).` });
    return { totals: { theses: total, active: total - closed, closed }, byStatus, alerts };
  },
};
