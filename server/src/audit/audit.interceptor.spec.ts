import { entityFrom, pickMeta } from './audit.interceptor';

describe('audit helpers', () => {
  it('keeps only allow-listed, primitive meta fields', () => {
    expect(
      pickMeta({
        password: 'secret',
        newPassword: 'secret2',
        token: 'abc',
        to: 'READY_FOR_DEFENSE',
        verdict: 'APPROVED',
        roles: ['ADMIN'],
        status: { nested: true },
      }),
    ).toEqual({
      to: 'READY_FOR_DEFENSE',
      verdict: 'APPROVED',
      roles: ['ADMIN'],
    });
    expect(pickMeta({ password: 'x' })).toBeUndefined();
    expect(pickMeta(undefined)).toBeUndefined();
  });

  it('derives the entity from the route pattern and params', () => {
    expect(entityFrom('/theses/:id/assignments', { id: 'a1' }, {})).toEqual({
      entityType: 'theses',
      entityId: 'a1',
    });
    expect(entityFrom('/theses', {}, { id: 'new1' })).toEqual({
      entityType: 'theses',
      entityId: 'new1',
    });
    expect(entityFrom('/auth/password', {}, undefined)).toEqual({
      entityType: 'auth',
      entityId: undefined,
    });
  });
});
