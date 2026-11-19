import {
  FeedbackAction,
  FeedbackChapter,
  FeedbackStatus,
  ThesisStatus,
} from '@thesis/shared';

/** Items can only be created while the jury is evaluating or the student is revising. */
export const FEEDBACK_OPEN_STATUSES: readonly ThesisStatus[] = [
  ThesisStatus.UNDER_EVALUATION,
  ThesisStatus.IN_DISPUTE,
  ThesisStatus.REVISIONS_IN_PROGRESS,
];

/** Who acts on an item: the thesis student or the author juror (RN-06). */
export type FeedbackActorKind = 'STUDENT' | 'AUTHOR';

export interface FeedbackTransition {
  from: FeedbackStatus;
  to: FeedbackStatus;
  by: FeedbackActorKind;
}

/** RN-06: the status changes each action makes, and who may make them. */
export const FEEDBACK_TRANSITIONS: Readonly<
  Record<Exclude<FeedbackAction, FeedbackAction.COMMENT>, FeedbackTransition>
> = {
  [FeedbackAction.ADDRESS]: {
    from: FeedbackStatus.PENDING,
    to: FeedbackStatus.ADDRESSED,
    by: 'STUDENT',
  },
  [FeedbackAction.RESOLVE]: {
    from: FeedbackStatus.ADDRESSED,
    to: FeedbackStatus.RESOLVED,
    by: 'AUTHOR',
  },
  [FeedbackAction.REOPEN]: {
    from: FeedbackStatus.ADDRESSED,
    to: FeedbackStatus.PENDING,
    by: 'AUTHOR',
  },
};

export const CHAPTER_ORDER: readonly FeedbackChapter[] =
  Object.values(FeedbackChapter);
