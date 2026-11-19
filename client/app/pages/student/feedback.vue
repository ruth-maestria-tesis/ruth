<script setup lang="ts">
import { Role } from '@thesis/shared';

definePageMeta({ middleware: 'role', roles: [Role.STUDENT] });
const { thesis, loading, load } = useMyThesis();
onMounted(load);
</script>

<template>
  <div>
    <v-progress-linear v-if="loading" indeterminate color="primary" />
    <v-alert v-else-if="!thesis" type="info" variant="tonal">Aún no tiene una tesis radicada.</v-alert>
    <FeedbackThread v-if="thesis" :thesis-id="thesis.id" mode="student" />
  </div>
</template>
