<script setup lang="ts">
import { useAuthStore } from '~/stores/auth';
import { ApiError } from '~/utils/http';

definePageMeta({ layout: 'blank' });

const route = useRoute();
const auth = useAuthStore();
const error = ref('');

onMounted(async () => {
  try {
    const assignmentId = await auth.loginExternal(String(route.params.token));
    await navigateTo(assignmentId ? `/juror/evaluation/${assignmentId}` : '/juror', { replace: true });
  } catch (e) {
    error.value = e instanceof ApiError ? e.userMessage : 'No se pudo validar el enlace de acceso.';
  }
});
</script>

<template>
  <div class="d-flex align-center justify-center pa-4" style="min-height: 100vh">
    <v-card max-width="480" width="100%" class="pa-6 text-center">
      <template v-if="!error">
        <v-progress-circular indeterminate color="primary" class="mb-4" />
        <div>Validando su enlace de acceso…</div>
      </template>
      <template v-else>
        <v-icon icon="mdi-link-variant-off" color="error" size="48" class="mb-2" />
        <div class="text-h2-section mb-2">Enlace no válido</div>
        <div class="text-body-2 text-medium-emphasis mb-4">{{ error }}</div>
        <v-btn color="primary" to="/login">Volver al inicio de sesión</v-btn>
      </template>
    </v-card>
  </div>
</template>
