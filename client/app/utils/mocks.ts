/**
 * In-memory mock data for API modules still being built on the server.
 * Enabled per module through runtimeConfig.public.mockModules (comma list).
 * State lives only in this tab and resets on reload.
 */
import type {
  AppNotification,
  Chapter,
  Defense,
  DefenseInput,
  DisputeView,
  Evaluation,
  EvaluationInput,
  FeedbackAction,
  FeedbackItem,
  Minutes,
  ThesisSummary,
} from '~/types/api';
import { ApiError } from './http';

export type MockModule =
  | 'evaluations'
  | 'feedback'
  | 'disputes'
  | 'defenses'
  | 'minutes'
  | 'notifications'
  | 'dashboard'
  | 'external';

let enabled = new Set<string>();
export function configureMocks(list: string | boolean | undefined): void {
  if (list === true || list === 'true' || list === 'all') {
    enabled = new Set(['evaluations', 'feedback', 'disputes', 'defenses', 'minutes', 'notifications', 'dashboard', 'external']);
  } else if (typeof list === 'string') {
    enabled = new Set(list.split(',').map((s) => s.trim()).filter(Boolean));
  } else {
    enabled = new Set();
  }
}
export const isMocked = (m: MockModule): boolean => enabled.has(m);
export const mockedModules = (): string[] => [...enabled];

const delay = <T>(v: T, ms = 150): Promise<T> => new Promise((r) => setTimeout(() => r(structuredClone(v)), ms));
const now = () => new Date().toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
let seq = 1000;
const nextId = () => `mock${(seq++).toString(16).padStart(20, '0')}`;

// ---------- evaluations ----------
const evaluations = new Map<string, Evaluation>(); // by assignmentId

export const mockEvaluations = {
  getForAssignment(assignmentId: string): Promise<Evaluation | null> {
    return delay(evaluations.get(assignmentId) ?? null);
  },
  saveDraft(assignmentId: string, input: EvaluationInput): Promise<Evaluation> {
    const prev = evaluations.get(assignmentId);
    if (prev?.status === 'SUBMITTED') return Promise.reject(new ApiError(409, 'EVALUATION_LOCKED', 'EVALUATION_LOCKED'));
    const r = { methodology: 0, relevance: 0, writingQuality: 0, ...prev?.rubric, ...input.rubric };
    const ev: Evaluation = {
      id: prev?.id ?? nextId(),
      assignmentId,
      thesisId: prev?.thesisId ?? '',
      jurorId: prev?.jurorId ?? '',
      rubric: r,
      score: Math.round(((r.methodology + r.relevance + r.writingQuality) / 3) * 10) / 10,
      verdict: input.verdict ?? prev?.verdict ?? 'APPROVED_FOR_DEFENSE',
      comments: input.comments ?? prev?.comments ?? '',
      correctionFileIds: prev?.correctionFileIds ?? [],
      status: 'DRAFT',
    };
    evaluations.set(assignmentId, ev);
    return delay(ev);
  },
  submit(assignmentId: string): Promise<Evaluation> {
    const ev = evaluations.get(assignmentId);
    if (!ev) return Promise.reject(new ApiError(409, 'VALIDATION_FAILED', 'VALIDATION_FAILED'));
    ev.status = 'SUBMITTED';
    ev.submittedAt = now();
    return delay(ev);
  },
  uploadCorrection(evaluationId: string, _file: File): Promise<Evaluation> {
    const ev = [...evaluations.values()].find((e) => e.id === evaluationId);
    if (ev) ev.correctionFileIds.push(nextId());
    return delay(ev as Evaluation);
  },
  listForThesis(thesisId: string): Promise<Evaluation[]> {
    const real = [...evaluations.values()].filter((e) => e.thesisId === thesisId && e.status === 'SUBMITTED');
    if (real.length) return delay(real);
    return delay(sampleEvaluations(thesisId));
  },
};

function sampleEvaluations(thesisId: string): Evaluation[] {
  return [
    {
      id: nextId(), assignmentId: 'a1', thesisId, jurorId: 'j1', jurorName: 'Dr. Mario Ruiz (Unicórdoba)',
      rubric: { methodology: 5, relevance: 4, writingQuality: 4 }, score: 4.3, verdict: 'APPROVED_FOR_DEFENSE',
      comments: 'Trabajo riguroso, con un aporte claro al contexto regional. Se sugiere ampliar la discusión de resultados.',
      correctionFileIds: [], status: 'SUBMITTED', submittedAt: daysAgo(5),
    },
    {
      id: nextId(), assignmentId: 'a2', thesisId, jurorId: 'j2', jurorName: 'Dra. Clara Hoyos (Externa — UdeA)',
      rubric: { methodology: 2, relevance: 3, writingQuality: 2 }, score: 2.3, verdict: 'REJECTED',
      comments: 'La muestra no es representativa y el diseño metodológico no permite sostener las conclusiones.',
      correctionFileIds: [], status: 'SUBMITTED', submittedAt: daysAgo(3),
    },
  ];
}

// ---------- feedback ----------
const feedback = new Map<string, FeedbackItem[]>(); // by thesisId
function feedbackFor(thesisId: string): FeedbackItem[] {
  if (!feedback.has(thesisId)) {
    feedback.set(thesisId, [
      {
        id: nextId(), thesisId, jurorId: 'j1', jurorName: 'Jurado 1 — Dr. Mario Ruiz', chapter: 'METHODOLOGY',
        reference: 'Pág. 42, párrafo 3', content: 'Justificar el tamaño de la muestra y el método de muestreo.',
        status: 'PENDING', replies: [], createdAt: daysAgo(6),
      },
      {
        id: nextId(), thesisId, jurorId: 'j2', jurorName: 'Jurado 2 — Dra. Clara Hoyos', chapter: 'RESULTS',
        reference: 'Tabla 4.2', content: 'Incluir intervalos de confianza en los resultados del modelo.',
        status: 'ADDRESSED',
        replies: [{ authorId: 's1', authorName: 'Estudiante', authorRole: 'STUDENT', content: 'Se agregaron los intervalos al 95 % en la tabla 4.2.', fileIds: [], at: daysAgo(2), action: 'ADDRESS' }],
        createdAt: daysAgo(6),
      },
      {
        id: nextId(), thesisId, jurorId: 'j1', jurorName: 'Jurado 1 — Dr. Mario Ruiz', chapter: 'INTRODUCTION',
        reference: 'Pág. 3', content: 'Actualizar el estado del arte con referencias de los últimos 5 años.',
        status: 'RESOLVED',
        replies: [
          { authorId: 's1', authorName: 'Estudiante', authorRole: 'STUDENT', content: 'Se incluyeron 8 referencias recientes.', fileIds: [], at: daysAgo(4), action: 'ADDRESS' },
          { authorId: 'j1', authorName: 'Dr. Mario Ruiz', authorRole: 'INTERNAL_JUROR', content: 'Subsanado.', fileIds: [], at: daysAgo(3), action: 'RESOLVE' },
        ],
        createdAt: daysAgo(8),
      },
    ]);
  }
  return feedback.get(thesisId)!;
}

const ACTION_STATUS: Record<FeedbackAction, FeedbackItem['status'] | null> = {
  ADDRESS: 'ADDRESSED', RESOLVE: 'RESOLVED', REOPEN: 'PENDING', COMMENT: null,
};

export const mockFeedback = {
  list(thesisId: string, chapter?: Chapter): Promise<FeedbackItem[]> {
    const items = feedbackFor(thesisId);
    return delay(chapter ? items.filter((i) => i.chapter === chapter) : items);
  },
  create(thesisId: string, input: { chapter: Chapter; reference?: string; content: string }, author: { id: string; name: string }): Promise<FeedbackItem> {
    const item: FeedbackItem = {
      id: nextId(), thesisId, jurorId: author.id, jurorName: author.name, ...input,
      status: 'PENDING', replies: [], createdAt: now(),
    };
    feedbackFor(thesisId).unshift(item);
    return delay(item);
  },
  act(id: string, action: FeedbackAction, content: string, author: { id: string; name: string; role: string }): Promise<FeedbackItem> {
    for (const items of feedback.values()) {
      const item = items.find((i) => i.id === id);
      if (item) {
        item.replies.push({ authorId: author.id, authorName: author.name, authorRole: author.role, content, fileIds: [], at: now(), action });
        const s = ACTION_STATUS[action];
        if (s) item.status = s;
        return delay(item);
      }
    }
    return Promise.reject(new ApiError(409, 'NOT_FOUND', 'NOT_FOUND'));
  },
};

// ---------- disputes ----------
export const mockDisputes = {
  async get(thesis: ThesisSummary): Promise<DisputeView> {
    return { thesis, evaluations: await mockEvaluations.listForThesis(thesis.id) };
  },
};

// ---------- defenses ----------
const defenses = new Map<string, Defense>(); // by thesisId
export const mockDefenses = {
  list(): Promise<Defense[]> {
    return delay([...defenses.values()]);
  },
  forThesis(thesisId: string): Promise<Defense | null> {
    return delay(defenses.get(thesisId) ?? null);
  },
  schedule(thesis: ThesisSummary, input: DefenseInput): Promise<Defense> {
    const d: Defense = { id: nextId(), thesisId: thesis.id, thesis, ...input, confirmations: [], status: 'PROPOSED' };
    defenses.set(thesis.id, d);
    return delay(d);
  },
  update(id: string, input: Partial<DefenseInput>): Promise<Defense> {
    const d = [...defenses.values()].find((x) => x.id === id)!;
    Object.assign(d, input);
    return delay(d);
  },
  confirm(id: string, user: { id: string; name: string }): Promise<Defense> {
    const d = [...defenses.values()].find((x) => x.id === id)!;
    if (!d.confirmations.some((c) => c.userId === user.id)) {
      d.confirmations.push({ userId: user.id, userName: user.name, confirmedAt: now() });
    }
    if (d.confirmations.length >= 2) d.status = 'CONFIRMED';
    return delay(d);
  },
};

// ---------- minutes ----------
const minutes = new Map<string, Minutes>(); // by thesisId
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const mockMinutes = {
  forThesis(thesisId: string): Promise<Minutes | null> {
    return delay(minutes.get(thesisId) ?? null);
  },
  create(thesisId: string): Promise<Minutes> {
    const m: Minutes = {
      id: nextId(), thesisId, defenseId: defenses.get(thesisId)?.id ?? nextId(),
      number: `ACTA-MIETIA-${new Date().getFullYear()}-${String(minutes.size + 1).padStart(3, '0')}`,
      finalGrade: 4.5, verdict: 'APPROVED', remarks: '', signatures: [], status: 'DRAFT',
    };
    minutes.set(thesisId, m);
    return delay(m);
  },
  update(id: string, patch: Partial<Pick<Minutes, 'finalGrade' | 'verdict' | 'remarks'>>): Promise<Minutes> {
    const m = [...minutes.values()].find((x) => x.id === id)!;
    if (m.status === 'SEALED') return Promise.reject(new ApiError(409, 'MINUTES_SEALED', 'MINUTES_SEALED'));
    Object.assign(m, patch);
    return delay(m);
  },
  async sign(id: string, user: { id: string; name: string; role: string }): Promise<Minutes> {
    const m = [...minutes.values()].find((x) => x.id === id)!;
    if (!m.signatures.some((s) => s.userId === user.id)) {
      m.signatures.push({ userId: user.id, userName: user.name, role: user.role, signedAt: now(), ip: '127.0.0.1' });
    }
    const coordinatorSigned = m.signatures.some((s) => s.role === 'COORDINATOR');
    if (coordinatorSigned && m.signatures.length >= 3) {
      m.status = 'SEALED';
      m.sealedAt = now();
      m.contentHash = await sha256(JSON.stringify({ n: m.number, g: m.finalGrade, v: m.verdict, r: m.remarks, t: m.thesisId }));
    }
    return delay(m);
  },
};

// ---------- notifications ----------
const notifications: AppNotification[] = [
  { id: nextId(), type: 'ASSIGNMENT', title: 'Nueva designación', body: 'Fue designado como jurado de una tesis. Tiene 8 días hábiles para responder.', link: '/juror', createdAt: daysAgo(1) },
  { id: nextId(), type: 'DEADLINE', title: 'Plazo por vencer', body: 'Una designación vence en 2 días hábiles.', createdAt: daysAgo(0) },
  { id: nextId(), type: 'INFO', title: 'Bienvenido', body: 'La plataforma de tesis de posgrado está disponible.', createdAt: daysAgo(3), readAt: daysAgo(2) },
];
export const mockNotifications = {
  list: (): Promise<AppNotification[]> => delay(notifications),
  unreadCount: (): Promise<{ count: number }> => delay({ count: notifications.filter((n) => !n.readAt).length }),
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
