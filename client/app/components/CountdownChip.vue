<script setup lang="ts">
import type { Assignment } from '~/types/api';

/** Sugerencia 8 / RF-J13: remaining business days (server-computed). */
const props = defineProps<{ assignment: Assignment }>();
const info = computed(() => {
  const a = props.assignment;
  if (a.status === 'PENDING') {
    if (a.isResponseOverdue) return { color: 'error', text: 'Plazo de respuesta vencido' };
    const d = a.responseDaysRemaining ?? 0;
    return { color: d <= 2 ? 'error' : 'warning', text: `Plazo para responder: ${d} día${d === 1 ? '' : 's'} hábil${d === 1 ? '' : 'es'}` };
  }
  if (a.status === 'ACCEPTED' && a.evaluationDaysRemaining !== null) {
    const d = a.evaluationDaysRemaining;
    return { color: d <= 2 ? 'error' : 'info', text: `Plazo de evaluación: ${d} día${d === 1 ? '' : 's'} hábil${d === 1 ? '' : 'es'}` };
  }
  return null;
});
</script>

<template>
  <v-chip v-if="info" :color="info.color" variant="tonal" prepend-icon="mdi-clock-outline" class="font-weight-medium">
    {{ info.text }}
  </v-chip>
</template>
