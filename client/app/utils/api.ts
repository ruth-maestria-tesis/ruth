/**
 * Typed API calls (spec §8). Modules not yet on the server go through
 * `utils/mocks.ts` when listed in runtimeConfig.public.mockModules.
 */
import { FeedbackAction, ThesisStatus } from '@thesis/shared';
import type { FeedbackStatus } from '@thesis/shared';
import type { FeedbackChapter } from '@thesis/shared';
import type {
  AppNotification,
  Assignment,
  Cohort,
  CreateThesisInput,
  DashboardData,
  Defense,
  DefenseInput,
  DisputeView,
  Evaluation,
  EvaluationInput,
  ExternalLink,
  FeedbackItem,
  GraphView,
  JurorInput,
  JuryResult,
  JuryViolationItem,
  Minutes,
  MinutesInput,
  Paginated,
  Period,
  Program,
  Thesis,
  ThesisQuery,
  User,
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
  type MockActor,
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
    request<{ user: User; assignmentId: string }>('/auth/external/validate-token', { method: 'POST', body: { token } }),
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
  programs: async () => asList(await request<Program[] | Paginated<Program>>('/programs')),
  periods: async () => asList(await request<Period[] | Paginated<Period>>('/periods')),
  cohorts: async (programId?: string) =>
    asList(await request<Cohort[] | Paginated<Cohort>>('/cohorts', { query: { programId } })),
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
  graph: (id: string) => request<GraphView>(`/theses/${id}/graph`),
  /** Coordinator: REVISIONS_IN_PROGRESS → READY_FOR_DEFENSE once no feedback is unresolved. */
  readyForDefense: (id: string) => request<unknown>(`/theses/${id}/ready-for-defense`, { method: 'POST' }),
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
  /** RF-J14: rotates the token and returns a fresh link. */
  externalLink: (id: string) => request<ExternalLink>(`/assignments/${id}/external-link`, { method: 'POST' }),
};

const orNull = async <T>(p: Promise<T>): Promise<T | null> => {
  try {
    return (await p) ?? null;
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
};

export const evaluationsApi = {
  forThesis: (thesisId: string): Promise<Evaluation[]> =>
    isMocked('evaluations') ? mockEvaluations.listForThesis(thesisId) : request(`/theses/${thesisId}/evaluations`),
  forAssignment: (assignmentId: string): Promise<Evaluation | null> =>
    isMocked('evaluations') ? mockEvaluations.getForAssignment(assignmentId) : orNull(request<Evaluation | null>(`/assignments/${assignmentId}/evaluation`)),
  saveDraft: (assignmentId: string, thesisId: string, body: EvaluationInput): Promise<Evaluation> =>
    isMocked('evaluations')
      ? mockEvaluations.saveDraft(assignmentId, thesisId, body)
      : request(`/assignments/${assignmentId}/evaluation`, { method: 'PUT', body }),
  submit: (assignmentId: string): Promise<Evaluation> =>
    isMocked('evaluations') ? mockEvaluations.submit(assignmentId) : request(`/assignments/${assignmentId}/evaluation/submit`, { method: 'POST' }),
  uploadCorrection: (evaluationId: string, file: File): Promise<Evaluation> => {
    if (isMocked('evaluations')) return mockEvaluations.uploadCorrection(evaluationId, file);
    const form = new FormData();
    form.append('file', file);
    return request(`/evaluations/${evaluationId}/corrections`, { method: 'POST', body: form });
  },
  get: (id: string): Promise<Evaluation> => request(`/evaluations/${id}`),
  filePath: (id: string, fileId: string) => `/evaluations/${id}/files/${fileId}`,
};

const FEEDBACK_ROUTE: Record<FeedbackAction, string> = {
  [FeedbackAction.ADDRESS]: 'address',
  [FeedbackAction.RESOLVE]: 'resolve',
  [FeedbackAction.REOPEN]: 'reopen',
  [FeedbackAction.COMMENT]: 'comment',
};

export const feedbackApi = {
  list: (thesisId: string, chapter?: FeedbackChapter): Promise<FeedbackItem[]> =>
    isMocked('feedback') ? mockFeedback.list(thesisId, chapter) : request(`/theses/${thesisId}/feedback`, { query: { chapter } }),
  create: (thesisId: string, body: { chapter: FeedbackChapter; reference?: string; content: string }, actor: MockActor): Promise<FeedbackItem> =>
    isMocked('feedback') ? mockFeedback.create(thesisId, body, actor) : request(`/theses/${thesisId}/feedback`, { method: 'POST', body }),
  act: (id: string, action: FeedbackAction, content: string, actor: MockActor): Promise<FeedbackItem> =>
    isMocked('feedback')
      ? mockFeedback.act(id, action, content, actor)
      : request(`/feedback/${id}/${FEEDBACK_ROUTE[action]}`, { method: 'POST', body: content ? { content } : {} }),
};

export const feedbackSummaryApi = {
  get: (thesisId: string) =>
    request<{ total: number; byStatus: Record<FeedbackStatus, number> }>(`/theses/${thesisId}/feedback/summary`),
};

export const disputesApi = {
  get: (thesisId: string, status: ThesisStatus): Promise<DisputeView> =>
    isMocked('disputes') ? mockDisputes.get(thesisId, status) : request(`/theses/${thesisId}/dispute`),
};

export const defensesApi = {
  list: (query: { status?: string } = {}): Promise<Defense[]> =>
    isMocked('defenses') ? mockDefenses.list() : request<Defense[] | Paginated<Defense>>('/defenses', { query: { ...query, limit: 100 } }).then(asList),
  forThesis: (thesisId: string): Promise<Defense | null> =>
    isMocked('defenses') ? mockDefenses.forThesis(thesisId) : orNull(request<Defense | null>(`/theses/${thesisId}/defense`)),
  schedule: (
    thesis: { id: string; code: string; title: string; studentName: string },
    body: DefenseInput,
    jurors: { userId: string; name: string }[],
  ): Promise<Defense> =>
    isMocked('defenses') ? mockDefenses.schedule(thesis, body, jurors) : request(`/theses/${thesis.id}/defense`, { method: 'POST', body }),
  update: (id: string, body: Partial<DefenseInput>): Promise<Defense> =>
    isMocked('defenses') ? mockDefenses.update(id, body) : request(`/defenses/${id}`, { method: 'PATCH', body }),
  confirm: (id: string, actor: MockActor): Promise<Defense> =>
    isMocked('defenses') ? mockDefenses.confirm(id, actor) : request(`/defenses/${id}/confirm`, { method: 'POST' }),
  cancel: (id: string): Promise<Defense> =>
    isMocked('defenses') ? mockDefenses.cancel(id) : request(`/defenses/${id}/cancel`, { method: 'POST' }),
};

export const minutesApi = {
  forThesis: (thesisId: string): Promise<Minutes | null> =>
    isMocked('minutes') ? mockMinutes.forThesis(thesisId) : orNull(request<Minutes | null>(`/theses/${thesisId}/minutes`)),
  create: (thesisId: string, body: MinutesInput, signers: Minutes['requiredSigners']): Promise<Minutes> =>
    isMocked('minutes') ? mockMinutes.create(thesisId, body, signers) : request(`/theses/${thesisId}/minutes`, { method: 'POST', body }),
  update: (id: string, body: Partial<MinutesInput>): Promise<Minutes> =>
    isMocked('minutes') ? mockMinutes.update(id, body) : request(`/minutes/${id}`, { method: 'PATCH', body }),
  sign: (id: string, actor: MockActor): Promise<Minutes> =>
    isMocked('minutes') ? mockMinutes.sign(id, actor) : request(`/minutes/${id}/sign`, { method: 'POST' }),
  pdfPath: (id: string) => `/minutes/${id}/pdf`,
};

export const notificationsApi = {
  list: (): Promise<AppNotification[]> =>
    isMocked('notifications')
      ? mockNotifications.list()
      : request<AppNotification[] | Paginated<AppNotification>>('/notifications', { query: { limit: 20 } }).then(asList),
  unreadCount: (): Promise<{ count: number }> =>
    isMocked('notifications') ? mockNotifications.unreadCount() : request('/notifications/unread-count'),
  read: (id: string): Promise<void> =>
    isMocked('notifications') ? mockNotifications.read(id) : request(`/notifications/${id}/read`, { method: 'POST' }),
  readAll: (): Promise<void> =>
    isMocked('notifications') ? mockNotifications.readAll() : request('/notifications/read-all', { method: 'POST' }),
};

const STATUSES = Object.values(ThesisStatus);
const CLOSED: ThesisStatus[] = [ThesisStatus.COMPLETED_APPROVED, ThesisStatus.COMPLETED_FAILED, ThesisStatus.NOT_APPROVED];
export const dashboardApi = {
  /** While the dashboard module is mocked, counts come from the real thesis list. */
  coordinator: async (filters: { programId?: string; periodId?: string; cohortId?: string } = {}): Promise<DashboardData> => {
    if (!isMocked('dashboard')) return request('/dashboard/coordinator', { query: filters });
    const counts = await Promise.all(
      STATUSES.map(async (status) => [status, (await thesesApi.list({ ...filters, status, limit: 1 })).total] as const),
    );
    const byStatus = Object.fromEntries(counts) as DashboardData['byStatus'];
    const total = counts.reduce((s, [, n]) => s + n, 0);
    const closed = CLOSED.reduce((s, k) => s + (byStatus[k] ?? 0), 0);
    const alerts: DashboardData['alerts'] = [];
    if (byStatus.IN_DISPUTE) alerts.push({ kind: 'IN_DISPUTE', message: `${byStatus.IN_DISPUTE} tesis en discrepancia requieren jurado dirimente (RN-08).` });
    if (byStatus.PENDING_JUROR_REPLACEMENT) alerts.push({ kind: 'PENDING_REPLACEMENT', message: `${byStatus.PENDING_JUROR_REPLACEMENT} tesis esperan el reemplazo de un jurado.` });
    return {
      totals: { theses: total, active: total - closed, completed: byStatus.COMPLETED_APPROVED ?? 0, notApproved: byStatus.NOT_APPROVED ?? 0 },
      byStatus,
      alerts,
    };
  },
};
