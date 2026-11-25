<script setup lang="ts">
import { studentLabel } from '~/utils/i18n';
import type { Assignment } from '~/types/api';

defineProps<{ assignment: Assignment }>();
const route = useRoute();
</script>

<template>
  <v-card class="pa-3 mb-4">
    <div class="d-flex flex-wrap align-center ga-2">
      <v-btn icon="mdi-arrow-left" variant="text" to="/juror" aria-label="Volver" />
      <div class="flex-grow-1" style="min-width: 220px">
        <strong>Evaluando:</strong> {{ assignment.thesis?.title }}
        <span class="text-body-2 text-medium-emphasis ml-1">({{ studentLabel(assignment.thesis?.studentName) }}: {{ assignment.thesis?.studentName }})</span>
      </div>
      <CountdownChip :assignment="assignment" />
    </div>
    <div class="d-flex flex-wrap ga-1 mt-2">
      <v-btn
        v-for="l in [
          { to: `/juror/evaluation/${assignment.id}`, title: 'Evaluación', icon: 'mdi-file-sign' },
          { to: `/juror/evaluation/${assignment.id}/feedback`, title: 'Retroalimentación', icon: 'mdi-message-text-outline' },
          { to: `/juror/evaluation/${assignment.id}/minutes`, title: 'Sustentación y acta', icon: 'mdi-certificate-outline' },
        ]"
        :key="l.to"
        :to="l.to"
        :prepend-icon="l.icon"
        size="small"
        :variant="route.path === l.to ? 'flat' : 'text'"
        :color="route.path === l.to ? 'primary' : undefined"
      >
        {{ l.title }}
      </v-btn>
    </div>
  </v-card>
</template>
