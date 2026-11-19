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
    </template>
  </div>
</template>
