<script setup lang="ts">
import { Role } from '@thesis/shared';

definePageMeta({ middleware: 'role', roles: [Role.COORDINATOR, Role.ADMIN] });
const route = useRoute();
const { summary, error, load } = useThesis(() => String(route.params.id));
onMounted(load);
</script>

<template>
  <div>
    <v-alert v-if="error" type="error" variant="tonal">No se encontró la tesis.</v-alert>
    <template v-if="summary">
      <ThesisHeader :thesis="summary" />
      <FeedbackThread :thesis-id="summary.id" mode="coordinator" />
    </template>
  </div>
</template>
