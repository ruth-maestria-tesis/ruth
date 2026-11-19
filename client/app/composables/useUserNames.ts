import type { User } from '~/types/api';
import { usersApi } from '~/utils/api';
import { fullName } from '~/utils/i18n';

/** Module-level cache: a user is fetched once per session; failures are remembered as unknown. */
const names = reactive(new Map<string, string>());
const pending = new Map<string, Promise<void>>();

/** Resolves user ids to display names through the users API (cached, deduplicated). */
export function useUserNames() {
  function remember(u: User) {
    names.set(u.id, fullName(u));
  }

  function resolve(ids: Iterable<string | undefined>): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const id of new Set(ids)) {
      if (!id || names.has(id)) continue;
      let job = pending.get(id);
      if (!job) {
        job = usersApi
          .get(id)
          .then(remember)
          .catch(() => {
            names.set(id, 'Usuario desconocido');
          })
          .finally(() => pending.delete(id));
        pending.set(id, job);
      }
      jobs.push(job);
    }
    return Promise.all(jobs).then(() => undefined);
  }

  const nameOf = (id?: string): string => (id ? (names.get(id) ?? '…') : 'Sistema');
  return { nameOf, resolve, remember };
}
