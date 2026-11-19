<script setup lang="ts">
import { Role } from '@thesis/shared';
import type { Defense, ThesisSummary } from '~/types/api';
import { defensesApi } from '~/utils/api';

definePageMeta({ middleware: 'role', roles: [Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR] });
const route = useRoute();
const { assignment, loading, error, load } = useJurorAssignment(() => String(route.params.id));
const defense = ref<Defense | null>(null);
const summary = computed<ThesisSummary | null>(() => assignment.value?.thesis ?? null);
onMounted(async () => {
  await load();
  if (assignment.value?.status === 'ACCEPTED') defense.value = await defensesApi.forThesis(assignment.value.thesisId).catch(() => null);
});
</script>

<template>
  <div>
    <v-progress-linear v-if="loading && !assignment" indeterminate color="primary" />
    <v-alert v-else-if="error" type="error" variant="tonal">No se encontró la designación.</v-alert>
    <template v-if="assignment && summary">
      <JurorAssignmentNav :assignment="assignment" />
      <v-alert v-if="assignment.status !== 'ACCEPTED'" type="info" variant="tonal">Acepte la designación para ver la sustentación y el acta.</v-alert>
      <v-row v-else>
        <v-col cols="12" lg="5"><DefensePanel v-model:defense="defense" :thesis="summary" mode="juror" /></v-col>
        <v-col cols="12" lg="7"><MinutesPanel :thesis="summary" mode="juror" /></v-col>
      </v-row>
    </template>
  </div>
</template>
