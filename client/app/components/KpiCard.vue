<script setup lang="ts">
withDefaults(defineProps<{ value: number | string; label: string; icon: string; tone?: 'primary' | 'warning' | 'info' | 'success'; to?: string }>(), {
  tone: 'primary',
  to: undefined,
});
</script>

<template>
  <v-card :class="['kpi-card', tone]" :to="to" class="pa-4">
    <div class="d-flex align-center justify-space-between">
      <div>
        <div class="text-h4 font-weight-bold">{{ value }}</div>
        <div class="text-body-2 text-medium-emphasis">{{ label }}</div>
      </div>
      <v-icon :icon="icon" :color="tone" size="36" />
    </div>
  </v-card>
</template>
