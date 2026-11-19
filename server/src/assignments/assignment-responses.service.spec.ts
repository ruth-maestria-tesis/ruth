import { HttpStatus } from '@nestjs/common';
import { ErrorCode, ThesisStatus } from '@thesis/shared';
import { Types } from 'mongoose';
import { AppException } from '../common/errors/app.exception';
import { SYSTEM_ACTOR } from '../common/types/actor';
import { AssignmentResponsesService } from './assignment-responses.service';

const race = () =>
  new AppException(ErrorCode.WORKFLOW_STATUS_CONFLICT, HttpStatus.CONFLICT);

function setup(opts: { thesisStatus?: ThesisStatus; count?: number } = {}) {
  const model = {
    countDocuments: jest.fn(() => ({
      exec: () => Promise.resolve(opts.count ?? 0),
    })),
  };
  const theses = {
    findById: jest.fn(() =>
      Promise.resolve({
        status: opts.thesisStatus ?? ThesisStatus.JURORS_ASSIGNED,
      }),
    ),
  };
  const workflow = { transition: jest.fn() };
  const service = new AssignmentResponsesService(
    model as never,
    {} as never,
    theses as never,
    workflow as never,
    {} as never,
  );
  return { service, model, theses, workflow };
}

const thesisId = new Types.ObjectId();

describe('AssignmentResponsesService.advanceIfJuryAccepted', () => {
  it('counts only active accepted primaries', async () => {
    const { service, model, workflow } = setup({ count: 1 });
    await service['advanceIfJuryAccepted'](thesisId, SYSTEM_ACTOR);
    expect(model.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        isActive: true,
        status: 'ACCEPTED',
        type: 'PRIMARY',
      }),
    );
    expect(workflow.transition).not.toHaveBeenCalled();
  });

  it('swallows the WORKFLOW_STATUS_CONFLICT of a concurrent accept that lost', async () => {
    const { service, workflow } = setup({ count: 2 });
    workflow.transition.mockRejectedValue(race());
    await expect(
      service['advanceIfJuryAccepted'](thesisId, SYSTEM_ACTOR),
    ).resolves.toBeUndefined();
    expect(workflow.transition).toHaveBeenCalledTimes(1);
  });

  it('rethrows other errors', async () => {
    const { service, workflow } = setup({ count: 2 });
    workflow.transition.mockRejectedValue(new Error('db down'));
    await expect(
      service['advanceIfJuryAccepted'](thesisId, SYSTEM_ACTOR),
    ).rejects.toThrow('db down');
  });
});

describe('AssignmentResponsesService.markNeedsReplacement', () => {
  it('retries once when a race left the thesis JURORS_ASSIGNED with an empty slot', async () => {
    const { service, workflow } = setup({ count: 1 });
    workflow.transition.mockRejectedValueOnce(race()).mockResolvedValueOnce({});
    await service['markNeedsReplacement'](thesisId, SYSTEM_ACTOR, 'r');
    expect(workflow.transition).toHaveBeenCalledTimes(2);
    expect(workflow.transition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        to: ThesisStatus.PENDING_JUROR_REPLACEMENT,
        expectedFrom: [ThesisStatus.JURORS_ASSIGNED],
      }),
    );
  });

  it('a race on the retry is again a no-op', async () => {
    const { service, workflow } = setup({ count: 1 });
    workflow.transition.mockRejectedValue(race());
    await expect(
      service['markNeedsReplacement'](thesisId, SYSTEM_ACTOR, 'r'),
    ).resolves.toBeUndefined();
    expect(workflow.transition).toHaveBeenCalledTimes(2);
  });

  it('does not retry when both primary slots are active again', async () => {
    const { service, workflow } = setup({ count: 2 });
    workflow.transition.mockRejectedValue(race());
    await service['markNeedsReplacement'](thesisId, SYSTEM_ACTOR, 'r');
    expect(workflow.transition).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the thesis is no longer JURORS_ASSIGNED', async () => {
    const { service, workflow } = setup({
      count: 1,
      thesisStatus: ThesisStatus.PENDING_JUROR_REPLACEMENT,
    });
    workflow.transition.mockRejectedValue(race());
    await service['markNeedsReplacement'](thesisId, SYSTEM_ACTOR, 'r');
    expect(workflow.transition).toHaveBeenCalledTimes(1);
  });
});
