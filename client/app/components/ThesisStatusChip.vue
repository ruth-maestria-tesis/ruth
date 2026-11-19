<script setup lang="ts">
import type { ThesisStatus } from '@thesis/shared';
import { THESIS_STATUS_COLORS, THESIS_STATUS_LABELS } from '~/utils/i18n';

defineProps<{ status: ThesisStatus }>();
</script>

<template>
  <v-chip :color="THESIS_STATUS_COLORS[status]" variant="tonal" class="font-weight-medium">
    {{ THESIS_STATUS_LABELS[status] ?? status }}
  </v-chip>
</template>
