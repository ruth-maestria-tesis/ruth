<script setup lang="ts">
import { Role, ThesisStatus } from '@thesis/shared';
import type { Thesis } from '~/types/api';
import { reportsApi, thesesApi } from '~/utils/api';
import { THESIS_STATUS_LABELS } from '~/utils/i18n';
import { useAuthStore } from '~/stores/auth';
import { useUiStore } from '~/stores/ui';

definePageMeta({ middleware: 'role', roles: [Role.COORDINATOR, Role.ADMIN] });

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const ui = useUiStore();
const { programs, periods, cohorts, cohortName, programName } = useCatalogs();
const canManage = computed(() => auth.hasRole(Role.COORDINATOR));

const q = ref(typeof route.query.q === 'string' ? route.query.q : '');
const filters = reactive({
  status: (route.query.status as ThesisStatus | undefined) ?? undefined,
  programId: (route.query.programId as string | undefined) ?? undefined,
  periodId: undefined as string | undefined,
  cohortId: undefined as string | undefined,
});
const page = ref(1);
const itemsPerPage = ref(20);
const sortBy = ref<{ key: string; order: 'asc' | 'desc' }[]>([{ key: 'createdAt', order: 'desc' }]);
const items = ref<Thesis[]>([]);
const total = ref(0);
const loading = ref(false);

/** Export links carry the current filters and sort, without pagination. Plain links so the auth cookie is sent. */
const exportFilters = computed(() => ({
  ...filters,
  q: q.value.trim() || undefined,
  sort: sortBy.value[0]?.key,
  order: sortBy.value[0]?.order,
}));
const xlsxUrl = computed(() => reportsApi.exportUrl('xlsx', exportFilters.value));
const pdfUrl = computed(() => reportsApi.exportUrl('pdf', exportFilters.value));

const headers = [
  { title: 'Código', key: 'code', sortable: true },
  { title: 'Título de la tesis', key: 'title', sortable: true, minWidth: '340px' },
  { title: 'Estudiante(s)', key: 'student', sortable: true, minWidth: '170px' },
  { title: 'Avance', key: 'progress', sortable: true, minWidth: '120px' },
  { title: 'Estado', key: 'status', sortable: true },
  { title: 'Acciones', key: 'actions', sortable: false, align: 'end' as const },
];
const statusItems = Object.values(ThesisStatus).map((s) => ({ title: THESIS_STATUS_LABELS[s], value: s }));
const cohortItems = computed(() => (filters.programId ? cohorts.value.filter((c) => c.programId === filters.programId) : cohorts.value));

async function load() {
  loading.value = true;
  try {
    const s = sortBy.value[0];
    const r = await thesesApi.list({
      ...filters,
      q: q.value.trim() || undefined,
      page: page.value,
      limit: itemsPerPage.value,
      sort: s?.key,
      order: s?.order,
    });
    items.value = r.items;
    total.value = r.total;
  } catch (e) {
    ui.error(e);
  } finally {
    loading.value = false;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
watch(q, () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    page.value = 1;
    load();
  }, 350);
});
watch(filters, () => {
  page.value = 1;
  router.replace({ query: { ...route.query, status: filters.status, programId: filters.programId } });
  load();
});

function onOptions(o: { page: number; itemsPerPage: number; sortBy: { key: string; order: 'asc' | 'desc' }[] }) {
  page.value = o.page;
  itemsPerPage.value = o.itemsPerPage;
  sortBy.value = o.sortBy.length ? o.sortBy : [{ key: 'createdAt', order: 'desc' }];
  load();
}
</script>

<template>
  <v-card class="pa-4">
    <div class="d-flex flex-wrap align-center ga-3 mb-4">
      <div>
        <div class="text-h2-section d-flex align-center ga-2"><v-icon icon="mdi-folder-multiple-outline" color="primary" /> Gestión y bandeja de tesis de posgrado</div>
        <div class="text-body-2 text-medium-emphasis">Filtros por programa, periodo, cohorte y estado (RF-C01)</div>
      </div>
      <v-spacer />
      <v-btn variant="outlined" prepend-icon="mdi-file-excel-outline" :href="xlsxUrl">Exportar Excel</v-btn>
      <v-btn variant="outlined" prepend-icon="mdi-file-pdf-box" :href="pdfUrl">Exportar PDF</v-btn>
      <v-btn v-if="canManage" color="primary" prepend-icon="mdi-plus" to="/coordinator/theses/new">Radicar tesis</v-btn>
    </div>
    <v-row dense class="mb-2">
      <v-col cols="12" md="4"><v-text-field v-model="q" label="Buscar por código, título o estudiante" prepend-inner-icon="mdi-magnify" clearable hide-details /></v-col>
      <v-col cols="6" md="2"><v-select v-model="filters.programId" :items="programs" item-title="name" item-value="id" label="Programa" clearable hide-details /></v-col>
      <v-col cols="6" md="2"><v-select v-model="filters.periodId" :items="periods" item-title="code" item-value="id" label="Periodo" clearable hide-details /></v-col>
      <v-col cols="6" md="2"><v-select v-model="filters.cohortId" :items="cohortItems" item-title="name" item-value="id" label="Cohorte" clearable hide-details /></v-col>
      <v-col cols="6" md="2"><v-select v-model="filters.status" :items="statusItems" label="Estado" clearable hide-details /></v-col>
    </v-row>
    <v-data-table-server
      :headers="headers"
      :items="items"
      :items-length="total"
      :loading="loading"
      :page="page"
      :items-per-page="itemsPerPage"
      :sort-by="sortBy"
      :items-per-page-options="[10, 20, 50, 100]"
      loading-text="Cargando tesis…"
      no-data-text="No hay tesis con estos filtros"
      hover
      @update:options="onOptions"
    >
      <template #[`item.code`]="{ item }"><strong class="text-no-wrap">{{ item.code }}</strong></template>
      <template #[`item.title`]="{ item }">
        <NuxtLink :to="`/coordinator/theses/${item.id}`" class="font-weight-bold text-high-emphasis text-decoration-none">{{ item.title }}</NuxtLink>
        <div class="text-meta">{{ programName(item.programId) }} · {{ cohortName(item.cohortId) }}</div>
      </template>
      <template #[`item.student`]="{ item }">{{ item.studentName }}</template>
      <template #[`item.progress`]="{ item }"><ProgressCell :value="item.progress" :danger="item.status === 'IN_DISPUTE'" /></template>
      <template #[`item.status`]="{ item }"><ThesisStatusChip :status="item.status" /></template>
      <template #[`item.actions`]="{ item }">
        <div class="d-flex justify-end ga-1">
          <v-btn v-if="canManage && item.status === 'SUBMITTED'" size="small" color="primary" prepend-icon="mdi-account-plus" :to="`/coordinator/theses/${item.id}?assign=1`">Asignar jurados</v-btn>
          <v-btn v-else-if="canManage && item.status === 'IN_DISPUTE'" size="small" color="error" :to="`/coordinator/theses/${item.id}/dispute`">Resolver</v-btn>
          <v-btn v-else-if="canManage && item.status === 'PENDING_JUROR_REPLACEMENT'" size="small" color="warning" :to="`/coordinator/theses/${item.id}`">Reemplazar</v-btn>
          <v-btn size="small" variant="outlined" :to="`/coordinator/theses/${item.id}/traceability`">Trazabilidad</v-btn>
        </div>
      </template>
    </v-data-table-server>
  </v-card>
</template>
