import { JuryViolation as V, Role } from '@thesis/shared';
import { JurorCandidate, validateJury } from './jury.rules';

const parties = {
  studentId: 's1',
  advisorId: 'adv',
  coAdvisorIds: ['co1'],
  conflictOfInterestUserIds: ['coi'],
};
const internal = (
  slot: number,
  userId: string,
  isUnicordoba = true,
): JurorCandidate => ({
  slot,
  key: userId,
  userId,
  user: { isActive: true, roles: [Role.INTERNAL_JUROR], isUnicordoba },
});
const newExternal = (
  slot: number,
  email: string,
  emailTaken = false,
): JurorCandidate => ({
  slot,
  key: `new:${email}`,
  newExternal: { emailTaken },
});
const check = (
  candidates: JurorCandidate[],
  extra: Partial<Parameters<typeof validateJury>[0]> = {},
) =>
  validateJury({
    candidates,
    parties,
    previousJurorIds: new Set(),
    required: 2,
    requireUnicordoba: true,
    ...extra,
  });

describe('validateJury (RF-C13, RN-01, RF-C14)', () => {
  it('accepts one Unicórdoba juror plus a new external juror', () => {
    expect(check([internal(1, 'j1'), newExternal(2, 'x@uni.org')])).toEqual([]);
  });

  it('requires exactly the expected number of jurors', () => {
    expect(check([internal(1, 'j1')])).toEqual([{ code: V.JUROR_COUNT }]);
  });

  it('rejects duplicates by user and by new email', () => {
    expect(check([internal(1, 'j1'), internal(2, 'j1')])).toContainEqual({
      code: V.JUROR_DUPLICATE,
      slot: 2,
    });
    expect(
      check(
        [internal(1, 'j1'), newExternal(2, 'a@b.co'), newExternal(3, 'a@b.co')],
        { required: 3 },
      ),
    ).toContainEqual({
      code: V.JUROR_DUPLICATE,
      slot: 3,
    });
  });

  it.each(['s1', 'adv', 'co1', 'coi'])(
    'flags %s as a conflict of interest (RN-01)',
    (id) => {
      expect(check([internal(1, 'j1'), internal(2, id)])).toContainEqual({
        code: V.JUROR_CONFLICT_OF_INTEREST,
        slot: 2,
      });
    },
  );

  it('flags missing, inactive and non-faculty users', () => {
    const missing: JurorCandidate = { slot: 2, key: 'gone', userId: 'gone' };
    expect(check([internal(1, 'j1'), missing])).toContainEqual({
      code: V.JUROR_NOT_FOUND,
      slot: 2,
    });
    const inactive = {
      ...internal(2, 'j2'),
      user: {
        isActive: false,
        roles: [Role.INTERNAL_JUROR],
        isUnicordoba: false,
      },
    };
    expect(check([internal(1, 'j1'), inactive])).toContainEqual({
      code: V.JUROR_INACTIVE,
      slot: 2,
    });
    const student = {
      ...internal(2, 'st'),
      user: { isActive: true, roles: [Role.STUDENT], isUnicordoba: false },
    };
    expect(check([internal(1, 'j1'), student])).toContainEqual({
      code: V.JUROR_NOT_FACULTY,
      slot: 2,
    });
  });

  it('requires at least one Unicórdoba juror (RF-C13)', () => {
    expect(
      check([internal(1, 'j1', false), newExternal(2, 'x@uni.org')]),
    ).toEqual([{ code: V.JUROR_UNICORDOBA_REQUIRED }]);
  });

  it('flags previously assigned jurors and taken emails', () => {
    expect(
      check([internal(1, 'j1'), internal(2, 'j2')], {
        previousJurorIds: new Set(['j2']),
      }),
    ).toContainEqual({
      code: V.JUROR_PREVIOUSLY_ASSIGNED,
      slot: 2,
    });
    expect(
      check([internal(1, 'j1'), newExternal(2, 'x@uni.org', true)]),
    ).toContainEqual({ code: V.JUROR_EMAIL_TAKEN, slot: 2 });
  });

  it('kept jurors skip per-juror checks but count for composition', () => {
    const kept = { ...internal(1, 'j1'), keep: true };
    expect(
      check([kept, internal(2, 'j2', false)], {
        previousJurorIds: new Set(['j1']),
      }),
    ).toEqual([]);
    const keptExternal = { ...internal(1, 'e1', false), keep: true };
    expect(check([keptExternal, newExternal(2, 'n@uni.org')])).toEqual([
      { code: V.JUROR_UNICORDOBA_REQUIRED },
    ]);
  });

  it('skips RF-C13 when the jury is still incomplete (replacement of one slot)', () => {
    expect(
      check([newExternal(1, 'n@uni.org')], {
        required: 1,
        requireUnicordoba: false,
      }),
    ).toEqual([]);
  });

  it('flags a new candidate that duplicates a kept juror', () => {
    const kept = { ...internal(1, 'j1'), keep: true };
    expect(check([kept, internal(2, 'j1')])).toContainEqual({
      code: V.JUROR_DUPLICATE,
      slot: 2,
    });
  });

  it('a missing user does not satisfy RF-C13', () => {
    const missing: JurorCandidate = { slot: 2, key: 'gone', userId: 'gone' };
    expect(check([internal(1, 'e', false), missing])).toEqual([
      { code: V.JUROR_NOT_FOUND, slot: 2 },
      { code: V.JUROR_UNICORDOBA_REQUIRED },
    ]);
  });

  it('reports only JUROR_COUNT for an incomplete jury', () => {
    expect(check([internal(1, 'e', false)])).toEqual([{ code: V.JUROR_COUNT }]);
  });
});
