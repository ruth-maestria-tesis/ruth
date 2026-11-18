import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { ErrorCode, THESIS_PROGRESS, ThesisStatus } from '@thesis/shared';
import { isValidObjectId, Model, Types } from 'mongoose';
import { AppException } from '../common/errors/app.exception';
import { Actor } from '../common/types/actor';
import {
  HistoryEntry,
  Thesis,
  ThesisDocument,
} from '../theses/schemas/thesis.schema';
import { canTransition } from './workflow.rules';
import {
  THESIS_STATUS_CHANGED,
  ThesisStatusChangedEvent,
} from './workflow.events';

export interface TransitionInput {
  thesisId: string;
  to: ThesisStatus;
  actor: Actor;
  /** Extra guard for callers that only accept some source statuses. */
  expectedFrom?: readonly ThesisStatus[];
  reason?: string;
  evidenceFileIds?: readonly string[];
}

/**
 * The only code path that changes thesis.status (spec §1). Single-document conditional
 * update on the status that was validated, so concurrent callers cannot both apply a
 * transition from the same state; no multi-document transaction is needed.
 */
@Injectable()
export class WorkflowService {
  constructor(
    @InjectModel(Thesis.name) private readonly theses: Model<Thesis>,
    private readonly events: EventEmitter2,
  ) {}

  async transition(input: TransitionInput): Promise<ThesisDocument> {
    const current = isValidObjectId(input.thesisId)
      ? await this.theses.findById(input.thesisId, 'status').exec()
      : null;
    if (!current) {
      throw new AppException(
        ErrorCode.THESIS_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Thesis not found',
      );
    }
    const from = current.status;
    const expected = !input.expectedFrom || input.expectedFrom.includes(from);
    if (!expected || !canTransition(from, input.to)) {
      throw new AppException(
        ErrorCode.WORKFLOW_INVALID_TRANSITION,
        HttpStatus.CONFLICT,
        `Cannot move thesis from ${from} to ${input.to}`,
        { from, to: input.to },
      );
    }

    const at = new Date();
    const entry: HistoryEntry = {
      from,
      to: input.to,
      at,
      actorId: input.actor.id ? new Types.ObjectId(input.actor.id) : undefined,
      actorRole: input.actor.role,
      reason: input.reason,
      evidenceFileIds: (input.evidenceFileIds ?? []).map(
        (id) => new Types.ObjectId(id),
      ),
    };
    const updated = await this.theses
      .findOneAndUpdate(
        { _id: current._id, status: from },
        {
          $set: { status: input.to, progress: THESIS_PROGRESS[input.to] },
          $push: { history: entry },
        },
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) {
      throw new AppException(
        ErrorCode.WORKFLOW_STATUS_CONFLICT,
        HttpStatus.CONFLICT,
        'Thesis status changed concurrently',
        { from, to: input.to },
      );
    }

    const event: ThesisStatusChangedEvent = {
      thesisId: updated.id as string,
      from,
      to: input.to,
      actorId: input.actor.id,
      actorRole: input.actor.role,
      reason: input.reason,
      at,
    };
    this.events.emit(THESIS_STATUS_CHANGED, event);
    return updated;
  }
}
