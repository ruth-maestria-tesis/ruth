/**
 * In-memory mock data for API modules not yet on the server, shaped like
 * docs/superpowers/specs/2026-11-19-mvp-api-contracts.md. Enabled per module through
 * runtimeConfig.public.mockModules (comma list). State lives in this tab only.
 */
import {
  AssignmentType,
  DefenseStatus,
  EvaluationStatus,
  EvaluationVerdict,
  FeedbackAction,
  FeedbackChapter,
  FeedbackStatus,
  MinutesStatus,
  MinutesVerdict,
} from '@thesis/shared';
import type {
  AppNotification,
  Defense,
  DefenseInput,
  DisputeView,
  Evaluation,
  EvaluationInput,
  FeedbackItem,
  Minutes,
  MinutesInput,
} from '~/types/api';
import { ApiError } from './http';

export type MockModule = 'evaluations' | 'feedback' | 'disputes' | 'defenses' | 'minutes' | 'notifications' | 'dashboard';
const ALL: MockModule[] = ['evaluations', 'feedback', 'disputes', 'defenses', 'minutes', 'notifications', 'dashboard'];

let enabled = new Set<string>();
export function configureMocks(list: string | boolean | undefined): void {
  if (list === true || list === 'true' || list === 'all') enabled = new Set(ALL);
  else if (typeof list === 'string') enabled = new Set(list.split(',').map((s) => s.trim()).filter(Boolean));
  else enabled = new Set();
}
export const isMocked = (m: MockModule): boolean => enabled.has(m);
export const mockedModules = (): string[] => [...enabled];

const delay = <T>(v: T, ms = 120): Promise<T> => new Promise((r) => setTimeout(() => r(structuredClone(v)), ms));
const fail = (code: string, status = 409) => Promise.reject(new ApiError(status, code, code));
const now = () => new Date().toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
let seq = 1000;
const nextId = () => `ffff${(seq++).toString(16).padStart(20, '0')}`;

export interface MockActor {
  id: string;
  name: string;
  role: string;
}

// ---------- evaluations ----------
const evaluations = new Map<string, Evaluation>(); // by assignmentId

function sampleEvaluations(thesisId: string): Evaluation[] {
  const base = { thesisId, assignmentType: AssignmentType.PRIMARY, correctionFiles: [], status: EvaluationStatus.SUBMITTED };
  return [
    {
      ...base, id: nextId(), assignmentId: 'a1', jurorId: 'j1', juror: { id: 'j1', firstName: 'Mario', lastName: 'Ruiz', isUnicordoba: true },
      rubric: { methodology: 5, relevance: 4, writingQuality: 4 }, score: 4.3, verdict: EvaluationVerdict.APPROVED_FOR_DEFENSE,
      comments: 'Trabajo riguroso, con un aporte claro al contexto regional. Se sugiere ampliar la discusión de resultados.', submittedAt: daysAgo(5),
    },
    {
      ...base, id: nextId(), assignmentId: 'a2', jurorId: 'j2', juror: { id: 'j2', firstName: 'Clara', lastName: 'Hoyos', isUnicordoba: false },
      rubric: { methodology: 2, relevance: 3, writingQuality: 2 }, score: 2.3, verdict: EvaluationVerdict.REJECTED,
      comments: 'La muestra no es representativa y el diseño metodológico no permite sostener las conclusiones.', submittedAt: daysAgo(3),
    },
  ];
}

export const mockEvaluations = {
  getForAssignment: (assignmentId: string) => delay(evaluations.get(assignmentId) ?? null),
  saveDraft(assignmentId: string, thesisId: string, input: EvaluationInput): Promise<Evaluation> {
    const prev = evaluations.get(assignmentId);
    if (prev?.status === EvaluationStatus.SUBMITTED) return fail('EVALUATION_LOCKED');
    const r = { methodology: 0, relevance: 0, writingQuality: 0, ...prev?.rubric, ...input.rubric };
    const ev: Evaluation = {
      id: prev?.id ?? nextId(), assignmentId, thesisId, jurorId: 'me', assignmentType: AssignmentType.PRIMARY,
      rubric: r, score: Math.round(((r.methodology + r.relevance + r.writingQuality) / 3) * 10) / 10,
      verdict: input.verdict ?? prev?.verdict ?? null, comments: input.comments ?? prev?.comments ?? '',
      correctionFiles: prev?.correctionFiles ?? [], status: EvaluationStatus.DRAFT,
    };
    evaluations.set(assignmentId, ev);
    return delay(ev);
  },
  submit(assignmentId: string): Promise<Evaluation> {
    const ev = evaluations.get(assignmentId);
    if (!ev || !ev.verdict || ev.comments.trim().length < 20) return fail('EVALUATION_INCOMPLETE', 400);
    ev.status = EvaluationStatus.SUBMITTED;
    ev.submittedAt = now();
    return delay(ev);
  },
  uploadCorrection(evaluationId: string, file: File): Promise<Evaluation> {
    const ev = [...evaluations.values()].find((e) => e.id === evaluationId);
    if (!ev) return fail('EVALUATION_NOT_FOUND', 404);
    ev.correctionFiles.push({ fileId: nextId(), fileName: file.name, uploadedAt: now() });
    return delay(ev);
  },
  listForThesis(thesisId: string): Promise<Evaluation[]> {
    const own = [...evaluations.values()].filter((e) => e.thesisId === thesisId && e.status === EvaluationStatus.SUBMITTED);
    return delay(own.length ? own : sampleEvaluations(thesisId));
  },
};

// ---------- feedback ----------
const feedback = new Map<string, FeedbackItem[]>(); // by thesisId
function feedbackFor(thesisId: string): FeedbackItem[] {
  if (!feedback.has(thesisId)) {
    const j1 = { id: 'j1', firstName: 'Mario', lastName: 'Ruiz' };
    const j2 = { id: 'j2', firstName: 'Clara', lastName: 'Hoyos' };
    feedback.set(thesisId, [
      { id: nextId(), thesisId, jurorId: 'j1', juror: j1, chapter: FeedbackChapter.INTRODUCTION, reference: 'Pág. 3', content: 'Actualizar el estado del arte con referencias de los últimos 5 años.', status: FeedbackStatus.RESOLVED, createdAt: daysAgo(8),
        replies: [
          { authorId: 's1', authorName: 'Estudiante', authorRole: 'STUDENT', content: 'Se incluyeron 8 referencias recientes.', fileIds: [], at: daysAgo(4), action: FeedbackAction.ADDRESS },
          { authorId: 'j1', authorName: 'Mario Ruiz', authorRole: 'INTERNAL_JUROR', content: 'Subsanado.', fileIds: [], at: daysAgo(3), action: FeedbackAction.RESOLVE },
        ] },
      { id: nextId(), thesisId, jurorId: 'j1', juror: j1, chapter: FeedbackChapter.METHODOLOGY, reference: 'Pág. 42, párrafo 3', content: 'Justificar el tamaño de la muestra y el método de muestreo.', status: FeedbackStatus.PENDING, replies: [], createdAt: daysAgo(6) },
      { id: nextId(), thesisId, jurorId: 'j2', juror: j2, chapter: FeedbackChapter.RESULTS, reference: 'Tabla 4.2', content: 'Incluir intervalos de confianza en los resultados del modelo.', status: FeedbackStatus.ADDRESSED, createdAt: daysAgo(6),
        replies: [{ authorId: 's1', authorName: 'Estudiante', authorRole: 'STUDENT', content: 'Se agregaron los intervalos al 95 % en la tabla 4.2.', fileIds: [], at: daysAgo(2), action: FeedbackAction.ADDRESS }] },
    ]);
  }
  return feedback.get(thesisId)!;
}

const NEXT: Record<FeedbackAction, { from: FeedbackStatus[]; to: FeedbackStatus | null }> = {
  [FeedbackAction.ADDRESS]: { from: [FeedbackStatus.PENDING], to: FeedbackStatus.ADDRESSED },
  [FeedbackAction.RESOLVE]: { from: [FeedbackStatus.ADDRESSED], to: FeedbackStatus.RESOLVED },
  [FeedbackAction.REOPEN]: { from: [FeedbackStatus.ADDRESSED], to: FeedbackStatus.PENDING },
  [FeedbackAction.COMMENT]: { from: Object.values(FeedbackStatus), to: null },
};

export const mockFeedback = {
  list: (thesisId: string, chapter?: FeedbackChapter) => delay(feedbackFor(thesisId).filter((i) => !chapter || i.chapter === chapter)),
  create(thesisId: string, input: { chapter: FeedbackChapter; reference?: string; content: string }, actor: MockActor): Promise<FeedbackItem> {
    const [firstName, ...rest] = actor.name.split(' ');
    const item: FeedbackItem = {
      id: nextId(), thesisId, jurorId: actor.id, juror: { id: actor.id, firstName: firstName ?? '', lastName: rest.join(' ') },
      ...input, status: FeedbackStatus.PENDING, replies: [], createdAt: now(),
    };
    feedbackFor(thesisId).push(item);
    return delay(item);
  },
  act(id: string, action: FeedbackAction, content: string, actor: MockActor): Promise<FeedbackItem> {
    for (const items of feedback.values()) {
      const item = items.find((i) => i.id === id);
      if (!item) continue;
      const rule = NEXT[action];
      if (!rule.from.includes(item.status)) return fail('FEEDBACK_INVALID_TRANSITION');
      item.replies.push({ authorId: actor.id, authorName: actor.name, authorRole: actor.role, content, fileIds: [], at: now(), action });
      if (rule.to) item.status = rule.to;
      return delay(item);
    }
    return fail('FEEDBACK_NOT_FOUND', 404);
  },
};

// ---------- disputes ----------
export const mockDisputes = {
  async get(thesisId: string, status: DisputeView['status']): Promise<DisputeView> {
    return { thesisId, status, primary: await mockEvaluations.listForThesis(thesisId), tiebreaker: null };
  },
};

// ---------- defenses ----------
const defenses = new Map<string, Defense>(); // by thesisId
const findDefense = (id: string) => [...defenses.values()].find((x) => x.id === id);
export const mockDefenses = {
  list: () => delay([...defenses.values()]),
  forThesis: (thesisId: string) => delay(defenses.get(thesisId) ?? null),
  schedule(thesis: { id: string; code: string; title: string; studentName: string }, input: DefenseInput, jurors: { userId: string; name: string }[]): Promise<Defense> {
    if (defenses.get(thesis.id)?.status === DefenseStatus.PROPOSED) return fail('DEFENSE_EXISTS');
    const d: Defense = { id: nextId(), thesisId: thesis.id, thesis, ...input, status: DefenseStatus.PROPOSED, jurors };
    defenses.set(thesis.id, d);
    return delay(d);
  },
  update(id: string, input: Partial<DefenseInput>): Promise<Defense> {
    const d = findDefense(id);
    if (!d) return fail('DEFENSE_NOT_FOUND', 404);
    Object.assign(d, input);
    d.jurors.forEach((j) => delete j.confirmedAt);
    return delay(d);
  },
  confirm(id: string, actor: MockActor): Promise<Defense> {
    const d = findDefense(id);
    if (!d) return fail('DEFENSE_NOT_FOUND', 404);
    const j = d.jurors.find((x) => x.userId === actor.id) ?? d.jurors.find((x) => !x.confirmedAt);
    if (!j) return fail('DEFENSE_NOT_JUROR', 403);
    j.confirmedAt ??= now();
    if (d.jurors.every((x) => x.confirmedAt)) d.status = DefenseStatus.CONFIRMED;
    return delay(d);
  },
  cancel(id: string): Promise<Defense> {
    const d = findDefense(id);
    if (!d) return fail('DEFENSE_NOT_FOUND', 404);
    d.status = DefenseStatus.CANCELLED;
    return delay(d);
  },
};

// ---------- minutes ----------
const minutes = new Map<string, Minutes>(); // by thesisId
const findMinutes = (id: string) => [...minutes.values()].find((x) => x.id === id);
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const canonical = (m: Minutes) => JSON.stringify({ finalGrade: m.finalGrade, number: m.number, remarks: m.remarks, thesisId: m.thesisId, verdict: m.verdict });

export const mockMinutes = {
  forThesis: (thesisId: string) => delay(minutes.get(thesisId) ?? null),
  async create(thesisId: string, input: MinutesInput, signers: Minutes['requiredSigners']): Promise<Minutes> {
    if (minutes.has(thesisId)) return fail('MINUTES_EXISTS');
    if (input.finalGrade < 3 && input.verdict !== MinutesVerdict.FAILED) return fail('MINUTES_INVALID_GRADE', 400);
    const m: Minutes = {
      id: nextId(), thesisId, defenseId: defenses.get(thesisId)?.id ?? nextId(),
      number: `MIETIA-${new Date().getFullYear()}-${String(minutes.size + 1).padStart(3, '0')}`,
      ...input, contentHash: '', status: MinutesStatus.DRAFT, signatures: [], requiredSigners: signers, pdfAvailable: false,
    };
    m.contentHash = await sha256(canonical(m));
    minutes.set(thesisId, m);
    return delay(m);
  },
  async update(id: string, patch: Partial<MinutesInput>): Promise<Minutes> {
    const m = findMinutes(id);
    if (!m) return fail('MINUTES_NOT_FOUND', 404);
    if (m.status === MinutesStatus.SEALED) return fail('MINUTES_SEALED');
    if (m.signatures.length) return fail('MINUTES_SIGNED');
    Object.assign(m, patch);
    m.contentHash = await sha256(canonical(m));
    return delay(m);
  },
  async sign(id: string, actor: MockActor): Promise<Minutes> {
    const m = findMinutes(id);
    if (!m) return fail('MINUTES_NOT_FOUND', 404);
    if (m.status === MinutesStatus.SEALED) return fail('MINUTES_SEALED');
    const signer = m.requiredSigners.find((s) => s.userId === actor.id);
    if (!signer) return fail('MINUTES_NOT_SIGNER', 403);
    const jurorsPending = m.requiredSigners.filter((s) => s.role !== 'COORDINATOR' && !m.signatures.some((x) => x.userId === s.userId));
    if (signer.role === 'COORDINATOR' && jurorsPending.length) return fail('MINUTES_SIGN_ORDER');
    if (!m.signatures.some((x) => x.userId === signer.userId)) {
      m.signatures.push({ userId: signer.userId, name: signer.name, role: signer.role, signedAt: now(), ip: '127.0.0.1' });
    }
    m.contentHash = await sha256(canonical(m));
    if (m.requiredSigners.every((s) => m.signatures.some((x) => x.userId === s.userId))) {
      m.status = MinutesStatus.SEALED;
      m.sealedAt = now();
    }
    return delay(m);
  },
};

// ---------- notifications ----------
const notifications: AppNotification[] = [
  { id: nextId(), type: 'assignment.created', title: 'Nueva designación', body: 'Fue designado como jurado de una tesis. Tiene 8 días hábiles para responder.', link: '/juror', createdAt: daysAgo(1) },
  { id: nextId(), type: 'info', title: 'Bienvenido', body: 'La plataforma de tesis de posgrado está disponible.', createdAt: daysAgo(3), readAt: daysAgo(2) },
];
export const mockNotifications = {
  list: () => delay(notifications),
  unreadCount: () => delay({ count: notifications.filter((n) => !n.readAt).length }),
  read(id: string): Promise<void> {
    const n = notifications.find((x) => x.id === id);
    if (n) n.readAt = now();
    return delay(undefined);
  },
  readAll(): Promise<void> {
    notifications.forEach((n) => (n.readAt ??= now()));
    return delay(undefined);
  },
};
