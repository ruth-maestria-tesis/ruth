<script setup lang="ts">
import { Role } from '@thesis/shared';

definePageMeta({ middleware: 'role', roles: [Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR] });
const route = useRoute();
const { assignment, loading, error, load } = useJurorAssignment(() => String(route.params.id));
onMounted(load);
const canCreate = computed(
  () => assignment.value?.status === 'ACCEPTED' && ['UNDER_EVALUATION', 'IN_DISPUTE', 'REVISIONS_IN_PROGRESS'].includes(assignment.value.thesis?.status ?? ''),
);
</script>

<template>
  <div>
    <v-progress-linear v-if="loading && !assignment" indeterminate color="primary" />
    <v-alert v-else-if="error" type="error" variant="tonal">No se encontró la designación.</v-alert>
    <template v-if="assignment">
      <JurorAssignmentNav :assignment="assignment" />
      <v-alert v-if="assignment.status !== 'ACCEPTED'" type="info" variant="tonal">Acepte la designación para ver y registrar observaciones.</v-alert>
      <FeedbackThread v-else :thesis-id="assignment.thesisId" mode="juror" :can-create="canCreate" />
    </template>
  </div>
</template>
