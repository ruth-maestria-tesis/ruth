<script setup lang="ts">
import type { AssignmentStatus } from '@thesis/shared';
import { ASSIGNMENT_STATUS_COLORS, ASSIGNMENT_STATUS_LABELS } from '~/utils/i18n';

defineProps<{ status: AssignmentStatus }>();
</script>

<template>
  <v-chip :color="ASSIGNMENT_STATUS_COLORS[status]" variant="tonal" size="x-small">
    {{ ASSIGNMENT_STATUS_LABELS[status] ?? status }}
  </v-chip>
</template>
