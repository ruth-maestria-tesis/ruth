<script setup lang="ts">
import { Role } from '@thesis/shared';
import type { Defense } from '~/types/api';
import { defensesApi } from '~/utils/api';

definePageMeta({ middleware: 'role', roles: [Role.STUDENT] });
const { thesis, summary, loading, load } = useMyThesis();
const { programName } = useCatalogs();
const defense = ref<Defense | null>(null);
onMounted(async () => {
  await load();
  if (thesis.value) defense.value = await defensesApi.forThesis(thesis.value.id).catch(() => null);
});
</script>

<template>
  <div>
    <v-progress-linear v-if="loading" indeterminate color="primary" />
    <v-alert v-else-if="!thesis" type="info" variant="tonal">Aún no tiene una tesis radicada.</v-alert>
    <v-row v-if="summary && thesis">
      <v-col cols="12" lg="5"><DefensePanel v-model:defense="defense" :thesis="summary" mode="student" /></v-col>
      <v-col cols="12" lg="7"><MinutesPanel :thesis="summary" mode="student" :program-name="programName(thesis.programId)" /></v-col>
    </v-row>
  </div>
</template>
