import { Role } from '@thesis/shared';
import { actorFrom } from './actor';

describe('actorFrom', () => {
  const user = {
    id: 'u1',
    email: 'a@b.co',
    roles: [Role.INTERNAL_JUROR, Role.COORDINATOR],
  };

  it('picks the first of the allowed roles that the user holds', () => {
    expect(actorFrom(user, Role.ADMIN, Role.COORDINATOR)).toEqual({
      id: 'u1',
      role: Role.COORDINATOR,
    });
  });

  it('falls back to the first user role when no allowed role is given', () => {
    expect(actorFrom(user)).toEqual({ id: 'u1', role: Role.INTERNAL_JUROR });
  });
});
