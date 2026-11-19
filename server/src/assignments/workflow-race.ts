import { ErrorCode } from '@thesis/shared';
import { AppException } from '../common/errors/app.exception';

/** Another request already moved the thesis: expected under concurrency, safe to ignore. */
export const isWorkflowRace = (e: unknown): boolean =>
  e instanceof AppException &&
  (e.code === ErrorCode.WORKFLOW_INVALID_TRANSITION ||
    e.code === ErrorCode.WORKFLOW_STATUS_CONFLICT);
