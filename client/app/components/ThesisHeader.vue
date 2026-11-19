<script setup lang="ts">
import type { ThesisSummary } from '~/types/api';

/** Title strip + section links for a coordinator thesis page. */
const props = defineProps<{ thesis: ThesisSummary; base?: string }>();
const base = computed(() => props.base ?? `/coordinator/theses/${props.thesis.id}`);
const links = computed(() => [
  { to: base.value, title: 'Ficha', icon: 'mdi-file-document-outline' },
  { to: `${base.value}/feedback`, title: 'Retroalimentación', icon: 'mdi-message-text-outline' },
  { to: `${base.value}/dispute`, title: 'Discrepancia', icon: 'mdi-call-split' },
  { to: `${base.value}/defense`, title: 'Sustentación y acta', icon: 'mdi-certificate-outline' },
  { to: `${base.value}/traceability`, title: 'Trazabilidad', icon: 'mdi-graph-outline' },
]);
const route = useRoute();
</script>

<template>
  <v-card class="pa-4 mb-4">
    <div class="d-flex flex-wrap align-center ga-3">
      <v-btn icon="mdi-arrow-left" variant="text" to="/coordinator/theses" aria-label="Volver" />
      <div class="flex-grow-1" style="min-width: 240px">
        <div class="text-meta">{{ thesis.code }}</div>
        <div class="text-h2-section">{{ thesis.title }}</div>
        <div class="text-body-2 text-medium-emphasis">
          Estudiante: {{ thesis.studentName }}<template v-if="thesis.advisorName"> · Director: {{ thesis.advisorName }}</template>
        </div>
      </div>
      <ThesisStatusChip :status="thesis.status" />
      <div style="width: 140px"><ProgressCell :value="thesis.progress" :danger="thesis.status === 'IN_DISPUTE'" /></div>
    </div>
    <div class="d-flex flex-wrap ga-1 mt-3">
      <v-btn
        v-for="l in links"
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
