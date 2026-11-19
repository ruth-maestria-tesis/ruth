import type {
  AssignmentStatus,
  AssignmentType,
  ErrorCode,
  JuryViolation,
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

// ---- Modules being built on main (spec §5 / §8) ----

export type Verdict = 'APPROVED_FOR_DEFENSE' | 'APPROVED_WITH_CHANGES' | 'REJECTED' | 'APPROVED';

export interface Rubric {
  methodology: number;
  relevance: number;
  writingQuality: number;
}

export interface Evaluation {
  id: string;
  assignmentId: string;
  thesisId: string;
  jurorId: string;
  jurorName?: string;
  rubric: Rubric;
  score: number;
  verdict: Verdict;
  comments: string;
  correctionFileIds: string[];
  status: 'DRAFT' | 'SUBMITTED';
  submittedAt?: string;
}

export interface EvaluationInput {
  rubric: Partial<Rubric>;
  verdict?: Verdict;
  comments?: string;
}

export type Chapter =
  | 'INTRODUCTION'
  | 'THEORETICAL_FRAMEWORK'
  | 'METHODOLOGY'
  | 'RESULTS'
  | 'CONCLUSIONS'
  | 'OTHER';

export type FeedbackStatus = 'PENDING' | 'ADDRESSED' | 'RESOLVED';
export type FeedbackAction = 'ADDRESS' | 'RESOLVE' | 'REOPEN' | 'COMMENT';

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
  jurorName?: string;
  chapter: Chapter;
  reference?: string;
  content: string;
  status: FeedbackStatus;
  replies: FeedbackReply[];
  createdAt: string;
}

export interface DisputeView {
  thesis: ThesisSummary;
  evaluations: Evaluation[];
  tiebreaker?: Assignment;
}

export type DefenseModality = 'IN_PERSON' | 'VIRTUAL' | 'HYBRID';
export interface Defense {
  id: string;
  thesisId: string;
  thesis?: ThesisSummary;
  scheduledAt: string;
  modality: DefenseModality;
  location?: string;
  meetingUrl?: string;
  confirmations: { userId: string; userName?: string; confirmedAt: string }[];
  expectedUserIds?: string[];
  status: 'PROPOSED' | 'CONFIRMED' | 'HELD' | 'CANCELLED';
}

export interface DefenseInput {
  scheduledAt: string;
  modality: DefenseModality;
  location?: string;
  meetingUrl?: string;
}

export type MinutesVerdict = 'APPROVED' | 'APPROVED_MERITORIOUS' | 'APPROVED_LAUREATE' | 'FAILED';
export interface MinutesSignature {
  userId: string;
  userName?: string;
  role: string;
  signedAt: string;
  ip: string;
  userAgent?: string;
}
export interface Minutes {
  id: string;
  thesisId: string;
  defenseId: string;
  number: string | number;
  finalGrade: number;
  verdict: MinutesVerdict;
  remarks: string;
  signatures: MinutesSignature[];
  contentHash?: string;
  status: 'DRAFT' | 'SEALED';
  sealedAt?: string;
  pdfFileId?: string;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  link?: string;
  readAt?: string;
  createdAt: string;
}

export interface DashboardData {
  totals: { theses: number; active: number; closed: number };
  byStatus: Partial<Record<ThesisStatus, number>>;
  alerts: { kind: string; severity: 'warning' | 'error' | 'info'; message: string; thesisId?: string }[];
}
