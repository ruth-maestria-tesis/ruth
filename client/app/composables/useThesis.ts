import type { Thesis, ThesisSummary, User } from '~/types/api';
import { thesesApi, usersApi } from '~/utils/api';
import { fullName } from '~/utils/i18n';

/** Loads a thesis (coordinator/admin/owner student) plus its advisor's name. */
export function useThesis(id: MaybeRefOrGetter<string>) {
  const thesis = ref<Thesis | null>(null);
  const advisor = ref<User | null>(null);
  const loading = ref(true);
  const error = ref<unknown>(null);

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      thesis.value = await thesesApi.get(toValue(id));
      advisor.value = await usersApi.get(thesis.value.advisorId).catch(() => null);
    } catch (e) {
      error.value = e;
    } finally {
      loading.value = false;
    }
  }

  const summary = computed<ThesisSummary | null>(() =>
    thesis.value
      ? {
          id: thesis.value.id,
          code: thesis.value.code,
          title: thesis.value.title,
          abstract: thesis.value.abstract,
          studentName: thesis.value.studentName,
          advisorName: advisor.value ? fullName(advisor.value) : undefined,
          programId: thesis.value.programId,
          status: thesis.value.status,
          progress: thesis.value.progress,
        }
      : null,
  );

  return { thesis, advisor, summary, loading, error, load };
}
