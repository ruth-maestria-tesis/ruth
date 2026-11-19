import type { Thesis, ThesisSummary } from '~/types/api';
import { thesesApi } from '~/utils/api';

/** The student's current thesis (GET /theses/mine, newest first). */
export function useMyThesis() {
  const thesis = ref<Thesis | null>(null);
  const loading = ref(true);
  const error = ref<unknown>(null);
  async function load() {
    loading.value = true;
    try {
      const list = await thesesApi.mine();
      // The list omits nothing we need except history; the detail has it.
      thesis.value = list[0] ? await thesesApi.get(list[0].id) : null;
    } catch (e) {
      error.value = e;
    } finally {
      loading.value = false;
    }
  }
  const summary = computed<ThesisSummary | null>(() =>
    thesis.value
      ? { id: thesis.value.id, code: thesis.value.code, title: thesis.value.title, abstract: thesis.value.abstract, studentName: thesis.value.studentName, programId: thesis.value.programId, status: thesis.value.status, progress: thesis.value.progress }
      : null,
  );
  return { thesis, summary, loading, error, load };
}
