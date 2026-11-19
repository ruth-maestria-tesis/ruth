<script setup lang="ts">
const props = defineProps<{ value: number; danger?: boolean }>();
const color = computed(() => (props.danger ? 'error' : props.value >= 100 ? 'success' : 'primary'));
</script>

<template>
  <div style="min-width: 90px">
    <div class="text-caption font-weight-bold">{{ value }}%</div>
    <v-progress-linear :model-value="value" :color="color" height="6" rounded bg-color="grey-lighten-2" />
  </div>
</template>
