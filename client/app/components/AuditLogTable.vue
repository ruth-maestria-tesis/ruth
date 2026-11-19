<script setup lang="ts">
import type { AuditLog } from '~/types/api';
import { auditApi } from '~/utils/api';
import { useUiStore } from '~/stores/ui';

/** Server-paginated audit trail (RNF-04). Pass `entityType` / `entityId` to scope it to one record. */
const props = withDefaults(
  defineProps<{
    entityType?: string;
    entityId?: string;
    actorId?: string | null;
    action?: string;
    from?: string;
    to?: string;
    /** Hide the entity column when the list is already scoped to one record. */
    compact?: boolean;
  }>(),
  { entityType: undefined, entityId: undefined, actorId: null, action: undefined, from: undefined, to: undefined, compact: false },
);
const ui = useUiStore();
const { nameOf, resolve } = useUserNames();

const page = ref(1);
const itemsPerPage = ref(20);
const items = ref<AuditLog[]>([]);
const total = ref(0);
const loading = ref(false);

const headers = computed(() => [
  { title: 'Fecha', key: 'at', sortable: false },
  { title: 'Actor', key: 'actorId', sortable: false },
  { title: 'Acción', key: 'action', sortable: false },
  ...(props.compact ? [] : [{ title: 'Entidad', key: 'entity', sortable: false }]),
  { title: 'Estado', key: 'statusCode', sortable: false, align: 'end' as const },
  { title: 'IP', key: 'ip', sortable: false },
]);

const dateFmt = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'medium' });
const formatAt = (iso: string) => dateFmt.format(new Date(iso));
const statusColor = (c?: number) => (!c ? undefined : c >= 500 ? 'error' : c >= 400 ? 'warning' : 'success');

/** The date inputs give `YYYY-MM-DD`: `from` is the start of that Bogotá day, `to` its end (UTC-5, no DST). */
const fromIso = (d?: string) => (d ? `${d}T00:00:00.000-05:00` : undefined);
const toIso = (d?: string) => (d ? `${d}T23:59:59.999-05:00` : undefined);

async function load() {
  loading.value = true;
  try {
    const r = await auditApi.list({
      page: page.value,
      limit: itemsPerPage.value,
      entityType: props.entityType || undefined,
      entityId: props.entityId || undefined,
      actorId: props.actorId || undefined,
      action: props.action?.trim() || undefined,
      from: fromIso(props.from),
      to: toIso(props.to),
    });
    items.value = r.items;
    total.value = r.total;
    await resolve(r.items.map((i) => i.actorId));
  } catch (e) {
    ui.error(e);
  } finally {
    loading.value = false;
  }
}

function onOptions(o: { page: number; itemsPerPage: number }) {
  page.value = o.page;
  itemsPerPage.value = o.itemsPerPage;
  load();
}

let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => [props.entityType, props.entityId, props.actorId, props.action, props.from, props.to],
  () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      // A page change triggers onOptions -> load; otherwise load directly.
      if (page.value !== 1) page.value = 1;
      else load();
    }, 300);
  },
);
onBeforeUnmount(() => clearTimeout(timer));
defineExpose({ reload: load });
</script>

<template>
  <v-data-table-server
    :headers="headers"
    :items="items"
    :items-length="total"
    :loading="loading"
    :page="page"
    :items-per-page="itemsPerPage"
    :items-per-page-options="[10, 20, 50, 100]"
    loading-text="Cargando bitácora…"
    no-data-text="No hay registros de auditoría con estos filtros"
    density="comfortable"
    hover
    @update:options="onOptions"
  >
    <template #[`item.at`]="{ item }"><span class="text-no-wrap">{{ formatAt(item.at) }}</span></template>
    <template #[`item.actorId`]="{ item }">
      {{ item.actorId ? nameOf(item.actorId) : item.meta?.email ? String(item.meta.email) : 'Sistema' }}
    </template>
    <template #[`item.action`]="{ item }"><code class="text-body-2">{{ item.action }}</code></template>
    <template #[`item.entity`]="{ item }">
      <template v-if="item.entityType">
        {{ item.entityType }}<div v-if="item.entityId" class="text-meta mono">{{ item.entityId }}</div>
      </template>
      <template v-else>—</template>
    </template>
    <template #[`item.statusCode`]="{ item }">
      <v-chip v-if="item.statusCode" :color="statusColor(item.statusCode)" variant="tonal" size="small">{{ item.statusCode }}</v-chip>
      <template v-else>—</template>
    </template>
    <template #[`item.ip`]="{ item }">{{ item.ip ?? '—' }}</template>
  </v-data-table-server>
</template>
