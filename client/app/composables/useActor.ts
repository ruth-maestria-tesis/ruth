import { Role } from '@thesis/shared';
import type { MockActor } from '~/utils/mocks';
import { useAuthStore } from '~/stores/auth';

/** Current user as an actor for mocked writes (and display). */
export function useActor() {
  const auth = useAuthStore();
  return computed<MockActor>(() => ({
    id: auth.user?.id ?? '',
    name: auth.displayName,
    role: auth.hasRole(Role.COORDINATOR)
      ? Role.COORDINATOR
      : auth.hasRole(Role.INTERNAL_JUROR)
        ? Role.INTERNAL_JUROR
        : auth.hasRole(Role.EXTERNAL_JUROR)
          ? Role.EXTERNAL_JUROR
          : (auth.roles[0] ?? Role.STUDENT),
  }));
}
