import type { Cohort, Period, Program } from '~/types/api';
import { catalogsApi } from '~/utils/api';

const programs = ref<Program[]>([]);
const periods = ref<Period[]>([]);
const cohorts = ref<Cohort[]>([]);
let loading: Promise<void> | null = null;

/** Programs, periods and cohorts, loaded once per session. */
export function useCatalogs() {
  if (!loading) {
    loading = Promise.all([catalogsApi.programs(), catalogsApi.periods(), catalogsApi.cohorts()])
      .then(([p, pe, c]) => {
        programs.value = p;
        periods.value = pe;
        cohorts.value = c;
      })
      .catch(() => {
        loading = null;
      });
  }
  const programName = (id?: string) => programs.value.find((p) => p.id === id)?.name ?? '—';
  const periodCode = (id?: string) => periods.value.find((p) => p.id === id)?.code ?? '—';
  const cohortName = (id?: string) => cohorts.value.find((c) => c.id === id)?.name ?? '—';
  /** Reloads after a catalog was created or edited. */
  async function reload() {
    loading = null;
    useCatalogs();
    await loading;
  }
  return { programs, periods, cohorts, ready: loading, reload, programName, periodCode, cohortName };
}
