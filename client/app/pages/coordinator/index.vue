<script setup lang="ts">
import { Role, ThesisStatus } from '@thesis/shared';
import type { Assignment, DashboardData, ReportSummary, Thesis } from '~/types/api';
import { assignmentsApi, dashboardApi, reportsApi, thesesApi } from '~/utils/api';
import { fullName } from '~/utils/i18n';
import { useUiStore } from '~/stores/ui';

definePageMeta({ middleware: 'role', roles: [Role.COORDINATOR] });

const ui = useUiStore();
const { programs, periods, cohorts } = useCatalogs();
const filters = reactive({ programId: undefined as string | undefined, periodId: undefined as string | undefined, cohortId: undefined as string | undefined });
const data = ref<DashboardData | null>(null);
const summary = ref<ReportSummary | null>(null);
const loading = ref(true);
const nearDeadline = ref<{ thesis: Thesis; assignment: Assignment }[]>([]);

const ALERT_TYPE: Record<string, 'error' | 'warning' | 'info'> = {
  IN_DISPUTE: 'error',
  EVALUATION_OVERDUE: 'error',
  PENDING_REPLACEMENT: 'warning',
  RESPONSE_DUE_SOON: 'warning',
};
const barWidth = (n: number, list: { count: number }[]) => `${Math.round((n / Math.max(1, ...list.map((r) => r.count))) * 100)}%`;
const count = (...s: ThesisStatus[]) => s.reduce((n, k) => n + (data.value?.byStatus[k] ?? 0), 0);

async function load() {
  loading.value = true;
  try {
    const [dash, sum] = await Promise.all([dashboardApi.coordinator({ ...filters }), reportsApi.summary({ ...filters }).catch((e) => {
        ui.error(e);
        return null;
      })]);
    data.value = dash;
    summary.value = sum;
    await loadNearDeadline();
  } catch (e) {
    ui.error(e);
  } finally {
    loading.value = false;
  }
}

/** Pending juror responses with ≤ 3 business days left (RF-J13). */
async function loadNearDeadline() {
  const waiting = await thesesApi.list({ ...filters, status: ThesisStatus.JURORS_ASSIGNED, limit: 15, sort: 'createdAt', order: 'asc' });
  const replacing = await thesesApi.list({ ...filters, status: ThesisStatus.PENDING_JUROR_REPLACEMENT, limit: 15 });
  const rows: { thesis: Thesis; assignment: Assignment }[] = [];
  await Promise.all(
    [...waiting.items, ...replacing.items].map(async (t) => {
      const list = await assignmentsApi.forThesis(t.id).catch(() => [] as Assignment[]);
      for (const a of list) {
        if (a.status === 'PENDING' && (a.isResponseOverdue || (a.responseDaysRemaining ?? 99) <= 3)) rows.push({ thesis: t, assignment: a });
      }
    }),
  );
  nearDeadline.value = rows.sort((a, b) => (a.assignment.responseDaysRemaining ?? 0) - (b.assignment.responseDaysRemaining ?? 0));
}

const summaryBlocks = computed(() => [
  { title: 'Por estado', rows: (summary.value?.byStatus ?? []).map((r) => ({ key: r.status, label: r.label, count: r.count })) },
  { title: 'Por programa', rows: (summary.value?.byProgram ?? []).map((r) => ({ key: r.id, label: r.name ?? r.code ?? '—', count: r.count })) },
  { title: 'Por periodo', rows: (summary.value?.byPeriod ?? []).map((r) => ({ key: r.id, label: r.code ?? '—', count: r.count })) },
]);

watch(filters, load);
onMounted(load);
</script>

<template>
  <div>
    <div class="d-flex flex-wrap align-center ga-3 mb-4">
      <div>
        <div class="text-h1-module">Dashboard de Coordinación</div>
        <div class="text-body-2 text-medium-emphasis">Estado operativo del posgrado, métricas y alertas de plazos</div>
      </div>
      <v-spacer />
      <v-select v-model="filters.programId" :items="programs" item-title="name" item-value="id" label="Programa" clearable hide-details style="max-width: 240px" />
      <v-select v-model="filters.periodId" :items="periods" item-title="code" item-value="id" label="Periodo" clearable hide-details style="max-width: 160px" />
      <v-select v-model="filters.cohortId" :items="cohorts" item-title="name" item-value="id" label="Cohorte" clearable hide-details style="max-width: 200px" />
    </div>

    <v-row>
      <v-col cols="12" sm="6" lg="3">
        <KpiCard :value="count(ThesisStatus.SUBMITTED)" label="Tesis radicadas (por asignar)" icon="mdi-inbox-arrow-down" to="/coordinator/theses?status=SUBMITTED" />
      </v-col>
      <v-col cols="12" sm="6" lg="3">
        <KpiCard
          :value="count(ThesisStatus.JURORS_ASSIGNED, ThesisStatus.PENDING_JUROR_REPLACEMENT, ThesisStatus.UNDER_EVALUATION, ThesisStatus.IN_DISPUTE)"
          :label="`En evaluación (${nearDeadline.length} por vencer)`"
          icon="mdi-clock-outline"
          tone="warning"
          to="/coordinator/theses?status=UNDER_EVALUATION"
        />
      </v-col>
      <v-col cols="12" sm="6" lg="3">
        <KpiCard :value="count(ThesisStatus.REVISIONS_IN_PROGRESS)" label="Subsanación de observaciones" icon="mdi-pencil-outline" tone="info" to="/coordinator/theses?status=REVISIONS_IN_PROGRESS" />
      </v-col>
      <v-col cols="12" sm="6" lg="3">
        <KpiCard
          :value="count(ThesisStatus.READY_FOR_DEFENSE, ThesisStatus.DEFENSE_SCHEDULED, ThesisStatus.COMPLETED_APPROVED)"
          label="Listas, programadas y actas selladas"
          icon="mdi-check-decagram-outline"
          tone="success"
          to="/coordinator/defenses"
        />
      </v-col>
    </v-row>

    <v-row class="mt-2">
      <v-col cols="12" lg="7">
        <v-card class="pa-4 h-100">
          <div class="d-flex align-center mb-3">
            <v-icon icon="mdi-alert-outline" color="warning" class="mr-2" />
            <div>
              <div class="text-h2-section">Alertas operativas prioritarias</div>
              <div class="text-body-2 text-medium-emphasis">Respuestas de jurados por vencer en los próximos 3 días hábiles</div>
            </div>
            <v-spacer />
            <v-btn variant="outlined" size="small" to="/coordinator/theses">Ver todas</v-btn>
          </div>
          <v-progress-linear v-if="loading" indeterminate color="primary" />
          <v-alert
            v-for="row in nearDeadline"
            :key="row.assignment.id"
            :type="row.assignment.isResponseOverdue ? 'error' : 'warning'"
            variant="tonal"
            density="compact"
            class="mb-2"
          >
            <strong>{{ row.thesis.code }}:</strong> {{ fullName(row.assignment.juror) }}
            <template v-if="row.assignment.isResponseOverdue"> tiene el plazo de respuesta vencido.</template>
            <template v-else> tiene {{ row.assignment.responseDaysRemaining }} día(s) hábil(es) para aceptar o declinar (RF-J13).</template>
            <template #append>
              <v-btn size="small" variant="outlined" :to="`/coordinator/theses/${row.thesis.id}`">Ver tesis</v-btn>
            </template>
          </v-alert>
          <v-alert
            v-for="(a, i) in data?.alerts ?? []"
            :key="`${a.kind}-${i}`"
            :type="ALERT_TYPE[a.kind] ?? 'info'"
            variant="tonal"
            density="compact"
            class="mb-2"
          >
            <strong v-if="a.code">{{ a.code }}: </strong>{{ a.message }}
            <template v-if="a.thesisId" #append>
              <v-btn size="small" variant="outlined" :to="a.kind === 'IN_DISPUTE' ? `/coordinator/theses/${a.thesisId}/dispute` : `/coordinator/theses/${a.thesisId}`">Atender</v-btn>
            </template>
          </v-alert>
          <div v-if="!loading && !nearDeadline.length && !data?.alerts.length" class="text-medium-emphasis">Sin alertas activas.</div>
        </v-card>
      </v-col>
      <v-col cols="12" lg="5">
        <v-card class="pa-4 h-100">
          <div class="text-h2-section mb-3">Tesis por estado</div>
          <div v-for="s in Object.values(ThesisStatus)" :key="s" class="d-flex align-center ga-2 mb-2">
            <ThesisStatusChip :status="s" />
            <v-spacer />
            <NuxtLink :to="`/coordinator/theses?status=${s}`" class="font-weight-bold text-primary text-decoration-none">{{ data?.byStatus[s] ?? 0 }}</NuxtLink>
          </div>
          <v-divider class="my-2" />
          <div class="d-flex"><span>Total</span><v-spacer /><strong>{{ data?.totals.theses ?? 0 }}</strong></div>
        </v-card>
      </v-col>
    </v-row>

    <v-card class="pa-4 mt-4">
      <div class="d-flex align-center mb-3">
        <v-icon icon="mdi-chart-bar" color="primary" class="mr-2" />
        <div>
          <div class="text-h2-section">Resumen</div>
          <div class="text-body-2 text-medium-emphasis">{{ summary?.total ?? 0 }} tesis según los filtros aplicados</div>
        </div>
      </div>
      <v-row>
        <v-col v-for="block in summaryBlocks" :key="block.title" cols="12" md="4">
          <div class="text-meta mb-2">{{ block.title }}</div>
          <div v-for="row in block.rows" :key="row.key" class="mb-2">
            <div class="d-flex text-body-2"><span>{{ row.label }}</span><v-spacer /><strong>{{ row.count }}</strong></div>
            <div class="summary-bar"><div class="summary-bar__fill" :style="{ width: barWidth(row.count, block.rows) }" /></div>
          </div>
          <div v-if="!block.rows.length" class="text-body-2 text-medium-emphasis">Sin datos.</div>
        </v-col>
      </v-row>
    </v-card>
  </div>
</template>

<style scoped>
.summary-bar { height: 6px; border-radius: 3px; background: rgba(var(--v-theme-on-surface), 0.08); }
.summary-bar__fill { height: 100%; border-radius: 3px; background: rgb(var(--v-theme-primary)); }
</style>
