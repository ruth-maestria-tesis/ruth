/**
 * Legacy per-chapter split. Feedback now covers the whole document in one block: new items
 * use GENERAL; the other values remain only so older items stay valid.
 */
export enum FeedbackChapter {
  GENERAL = 'GENERAL',
  INTRODUCTION = 'INTRODUCTION',
  THEORETICAL_FRAMEWORK = 'THEORETICAL_FRAMEWORK',
  METHODOLOGY = 'METHODOLOGY',
  RESULTS = 'RESULTS',
  CONCLUSIONS = 'CONCLUSIONS',
  OTHER = 'OTHER',
}

/** RN-06 lifecycle. */
export enum FeedbackStatus {
  PENDING = 'PENDING',
  ADDRESSED = 'ADDRESSED',
  RESOLVED = 'RESOLVED',
}

export enum FeedbackAction {
  ADDRESS = 'ADDRESS',
  RESOLVE = 'RESOLVE',
  REOPEN = 'REOPEN',
  COMMENT = 'COMMENT',
}
