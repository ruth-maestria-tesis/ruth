<script setup lang="ts">
import { Role } from '@thesis/shared';
import type { User } from '~/types/api';
import { usersApi } from '~/utils/api';
import { fullName } from '~/utils/i18n';

definePageMeta({ middleware: 'role', roles: [Role.ADMIN, Role.COORDINATOR] });

const { remember } = useUserNames();

const filters = reactive({
  actorId: null as string | null,
  entityType: '',
  action: '',
  from: '',
  to: '',
});

// Actor select: server-side search through the users API.
const search = ref('');
const actors = ref<User[]>([]);
const actorsLoading = ref(false);
async function loadActors(q?: string) {
  actorsLoading.value = true;
  try {
    const list = (await usersApi.list({ q: q || undefined, limit: 20 })).items;
    list.forEach(remember);
    const selected = actors.value.find((u) => u.id === filters.actorId);
    actors.value = selected && !list.some((u) => u.id === selected.id) ? [selected, ...list] : list;
  } catch {
    actors.value = [];
  } finally {
    actorsLoading.value = false;
  }
}
let timer: ReturnType<typeof setTimeout> | undefined;
watch(search, (q) => {
  clearTimeout(timer);
  timer = setTimeout(() => loadActors(q), 300);
});
onMounted(() => loadActors());
onBeforeUnmount(() => clearTimeout(timer));

const invalidRange = computed(() => !!filters.from && !!filters.to && filters.from > filters.to);
const tableFilters = computed(() => (invalidRange.value ? { ...filters, from: '', to: '' } : filters));
function clear() {
  Object.assign(filters, { actorId: null, entityType: '', action: '', from: '', to: '' });
}
</script>

<template>
  <v-card class="pa-4">
    <div class="mb-4">
      <div class="text-h2-section d-flex align-center ga-2"><v-icon icon="mdi-shield-search" color="primary" /> Bitácora de auditoría</div>
      <div class="text-body-2 text-medium-emphasis">Registro inalterable de las acciones realizadas en el sistema (RNF-04). Horas en zona America/Bogotá.</div>
    </div>
    <v-row dense class="mb-2">
      <v-col cols="12" md="3">
        <v-autocomplete
          v-model="filters.actorId"
          v-model:search="search"
          :items="actors"
          :item-title="(u: User) => fullName(u)"
          item-value="id"
          label="Actor"
          :loading="actorsLoading"
          no-filter
          clearable
          hide-details
          no-data-text="Sin resultados"
        >
          <template #item="{ props: p, item }"><v-list-item v-bind="p" :subtitle="item.raw.email" /></template>
        </v-autocomplete>
      </v-col>
      <v-col cols="6" md="2"><v-text-field v-model="filters.entityType" label="Tipo de entidad" placeholder="theses" clearable hide-details /></v-col>
      <v-col cols="6" md="3"><v-text-field v-model="filters.action" label="Acción" placeholder="POST /minutes/:id/sign" clearable hide-details /></v-col>
      <v-col cols="6" md="2"><v-text-field v-model="filters.from" type="date" label="Desde" :error="invalidRange" hide-details /></v-col>
      <v-col cols="6" md="2"><v-text-field v-model="filters.to" type="date" label="Hasta" :error="invalidRange" hide-details /></v-col>
    </v-row>
    <div class="d-flex align-center mb-2">
      <span v-if="invalidRange" class="text-error text-body-2">La fecha inicial debe ser anterior a la final.</span>
      <v-spacer />
      <v-btn variant="text" size="small" prepend-icon="mdi-filter-off-outline" @click="clear">Limpiar filtros</v-btn>
    </div>
    <AuditLogTable
      :actor-id="tableFilters.actorId"
      :entity-type="tableFilters.entityType"
      :action="tableFilters.action"
      :from="tableFilters.from"
      :to="tableFilters.to"
    />
  </v-card>
</template>
