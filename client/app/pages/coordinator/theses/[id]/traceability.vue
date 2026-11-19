<script setup lang="ts">
import { Role } from '@thesis/shared';

definePageMeta({ middleware: 'role', roles: [Role.COORDINATOR, Role.ADMIN] });
const route = useRoute();
const { thesis, summary, error, load } = useThesis(() => String(route.params.id));
onMounted(load);
</script>

<template>
  <div>
    <v-alert v-if="error" type="error" variant="tonal">No se encontró la tesis.</v-alert>
    <template v-if="summary && thesis">
      <ThesisHeader :thesis="summary" />
      <TraceabilityGraph :thesis="thesis" />
      <v-card class="pa-4 mt-4">
        <div class="text-h2-section d-flex align-center ga-2 mb-1"><v-icon icon="mdi-shield-search" color="primary" /> Bitácora</div>
        <div class="text-body-2 text-medium-emphasis mb-3">Acciones registradas sobre esta tesis (auditoría, RNF-04).</div>
        <AuditLogTable entity-type="theses" :entity-id="thesis.id" compact />
      </v-card>
    </template>
  </div>
</template>
