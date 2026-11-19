import type { Assignment, Thesis } from '~/types/api';
import { assignmentsApi, thesesApi } from '~/utils/api';

/** Assignment plus the thesis it points to (readable by the juror while PENDING/ACCEPTED). */
export function useJurorAssignment(id: MaybeRefOrGetter<string>) {
  const assignment = ref<Assignment | null>(null);
  const thesis = ref<Thesis | null>(null);
  const loading = ref(true);
  const error = ref<unknown>(null);
  async function load() {
    loading.value = true;
    error.value = null;
    try {
      assignment.value = await assignmentsApi.get(toValue(id));
      thesis.value = await thesesApi.get(assignment.value.thesisId).catch(() => null);
    } catch (e) {
      error.value = e;
    } finally {
      loading.value = false;
    }
  }
  return { assignment, thesis, loading, error, load };
}
