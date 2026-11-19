import type {
  AssignmentStatus,
  AssignmentType,
  DefenseModality,
  DefenseStatus,
  ErrorCode,
  EvaluationStatus,
  EvaluationVerdict,
  FeedbackAction,
  FeedbackChapter,
  FeedbackStatus,
  JuryViolation,
  MinutesStatus,
  MinutesVerdict,
  ProgramLevel,
  Role,
  ThesisStatus,
} from '@thesis/shared';

export interface ApiErrorBody {
  statusCode: number;
  code: ErrorCode | string;
  message: string;
  details?: Record<string, unknown>;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface JurorProfile {
  institution: string;
  isUnicordoba: boolean;
  highestDegree?: string;
  country?: string;
  expertise?: string[];
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  documentId?: string;
  roles: Role[];
  isActive: boolean;
  jurorProfile?: JurorProfile;
  studentProfile?: { studentCode: string; programId?: string; cohortId?: string };
  /** RF-J14 external session scope. */
  scope?: { assignmentIds: string[] };
}

export interface Program {
  id: string;
  code: string;
  name: string;
  level: ProgramLevel;
  isActive: boolean;
}
export interface Period {
  id: string;
  code: string;
  year: number;
  term: string;
  startsAt?: string;
  endsAt?: string;
}
export interface Cohort {
  id: string;
  programId: string;
  number: number;
  periodId: string;
  name: string;
}

export interface ManuscriptVersion {
  fileId: string;
  version: number;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string;
}

export interface HistoryEntry {
  from?: ThesisStatus | null;
  to: ThesisStatus;
  at: string;
  actorId?: string;
  actorRole: string;
  reason?: string;
  evidenceFileIds: string[];
}

export interface Thesis {
  id: string;
  code: string;
  title: string;
  abstract?: string;
  keywords: string[];
  studentId: string;
  studentName: string;
  advisorId: string;
  coAdvisorIds: string[];
  programId: string;
  cohortId: string;
  periodId: string;
  status: ThesisStatus;
  progress: number;
  manuscripts: ManuscriptVersion[];
  currentManuscriptId?: string;
  conflictOfInterestUserIds: string[];
  history?: HistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface ThesisQuery {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  programId?: string;
  periodId?: string;
  cohortId?: string;
  status?: ThesisStatus;
  q?: string;
}

export interface CreateThesisInput {
  title: string;
  abstract?: string;
  keywords?: string[];
  studentId: string;
  advisorId: string;
  coAdvisorIds?: string[];
  programId: string;
  cohortId: string;
  periodId: string;
}

export interface JurorSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  roles: string[];
  institution?: string;
  isUnicordoba?: boolean;
}

export interface ThesisSummary {
  id: string;
  code: string;
  title: string;
  abstract?: string;
  studentName: string;
  advisorName?: string;
  programId: string;
  status: ThesisStatus;
  progress: number;
}

export interface Assignment {
  id: string;
  thesisId: string;
  jurorId: string;
  type: AssignmentType;
  slot: number;
  status: AssignmentStatus;
  assignedAt: string;
  responseDeadline: string;
  respondedAt?: string;
  declineReason?: string;
  evaluationDeadline?: string;
  replacedById?: string;
  hasExternalLink: boolean;
  externalLinkExpiresAt?: string;
  daysSinceAssigned: number;
  responseDaysRemaining: number | null;
  evaluationDaysRemaining: number | null;
  isResponseOverdue: boolean;
  juror?: JurorSummary;
  thesis?: ThesisSummary;
}

export interface NewExternalJuror {
  email: string;
  firstName: string;
  lastName: string;
  institution: string;
  highestDegree: string;
  country: string;
}

export interface JurorInput {
  jurorId?: string;
  newExternal?: NewExternalJuror;
}

export interface JuryViolationItem {
  code: JuryViolation;
  slot?: number;
}

export interface ExternalLink {
  assignmentId: string;
  url: string;
  expiresAt: string;
}

export interface JuryResult {
  assignments: Assignment[];
  externalLinks: ExternalLink[];
}

// ---- Modules from docs/superpowers/specs/2026-11-19-mvp-api-contracts.md ----

export type Verdict = EvaluationVerdict;
export type Chapter = FeedbackChapter;

export interface Rubric {
  methodology: number;
  relevance: number;
  writingQuality: number;
}

export interface FileRef {
  fileId: string;
  fileName: string;
  uploadedAt: string;
}

export interface Evaluation {
  id: string;
  assignmentId: string;
  thesisId: string;
  jurorId: string;
  juror?: { id: string; firstName: string; lastName: string; isUnicordoba?: boolean };
  assignmentType: AssignmentType;
  /** Partial once any criterion is saved; `score` stays null until complete. */
  rubric: Partial<Rubric> | null;
  score: number | null;
  verdict: EvaluationVerdict | null;
  comments: string;
  correctionFiles: FileRef[];
  status: EvaluationStatus;
  submittedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  studentFirstViewedAt?: string;
  studentFirstDownloadedAt?: string;
}

export interface EvaluationInput {
  rubric?: Partial<Rubric>;
  verdict?: EvaluationVerdict;
  comments?: string;
}

export interface FeedbackReply {
  authorId: string;
  authorName?: string;
  authorRole: string;
  content: string;
  fileIds: string[];
  at: string;
  action: FeedbackAction;
}

export interface FeedbackItem {
  id: string;
  thesisId: string;
  jurorId: string;
  juror?: { id: string; firstName: string; lastName: string };
  chapter: FeedbackChapter;
  reference?: string;
  content: string;
  status: FeedbackStatus;
  replies: FeedbackReply[];
  createdAt: string;
  updatedAt?: string;
}

export interface DisputeView {
  thesisId: string;
  status: ThesisStatus;
  primary: Evaluation[];
  tiebreaker: { assignment: Assignment; evaluation: Evaluation | null } | null;
}

export interface Defense {
  id: string;
  thesisId: string;
  thesis?: { id: string; code: string; title: string; studentName: string };
  scheduledAt: string;
  modality: DefenseModality;
  location?: string;
  meetingUrl?: string;
  status: DefenseStatus;
  jurors: { userId: string; name: string; confirmedAt?: string }[];
}

export interface DefenseInput {
  scheduledAt: string;
  modality: DefenseModality;
  location?: string;
  meetingUrl?: string;
}

export interface MinutesInput {
  finalGrade: number;
  verdict: MinutesVerdict;
  remarks: string;
}

export interface Minutes {
  id: string;
  thesisId: string;
  defenseId: string;
  number: string;
  finalGrade: number;
  verdict: MinutesVerdict;
  remarks: string;
  contentHash: string;
  status: MinutesStatus;
  /** role: INTERNAL_JUROR | EXTERNAL_JUROR | COORDINATOR. */
  signatures: { userId: string; name: string; role: Role; signedAt: string; ip?: string }[];
  requiredSigners: { userId: string; name: string; role: Role }[];
  sealedAt?: string;
  pdfAvailable: boolean;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  link?: string;
  entityRef?: { kind: string; id: string };
  readAt?: string;
  createdAt: string;
}

export interface DashboardAlert {
  kind: 'PENDING_REPLACEMENT' | 'IN_DISPUTE' | 'RESPONSE_DUE_SOON' | 'EVALUATION_OVERDUE' | string;
  thesisId?: string;
  code?: string;
  title?: string;
  message: string;
}

export interface DashboardData {
  totals: { theses: number; active: number; completed: number; notApproved: number };
  byStatus: Partial<Record<ThesisStatus, number>>;
  byCohort?: { cohortId: string; name: string; count: number }[];
  alerts: DashboardAlert[];
}

export interface GraphView {
  thesisId: string;
  status: ThesisStatus;
  progress: number;
  nodes: { id: string; kind: 'STATUS' | 'ASSIGNMENT' | 'EVALUATION' | 'DEFENSE' | 'MINUTES'; label: string; at?: string; status?: string; current?: boolean }[];
  edges: { from: string; to: string; label?: string }[];
}
