<script setup lang="ts">
import { useAuthStore } from '~/stores/auth';

/** Neutral landing for an authenticated account that has no usable role. */
definePageMeta({ layout: 'blank' });
const auth = useAuthStore();

async function leave() {
  await auth.logout();
  await navigateTo('/login');
}
</script>

<template>
  <div class="d-flex align-center justify-center pa-4" style="min-height: 100vh">
    <v-card max-width="480" width="100%" class="pa-6 text-center">
      <v-icon icon="mdi-account-lock-outline" color="warning" size="48" class="mb-2" />
      <div class="text-h2-section mb-2">Su cuenta no tiene un rol asignado</div>
      <div class="text-body-2 text-medium-emphasis mb-4">Comuníquese con la coordinación del programa para que habiliten su acceso.</div>
      <v-btn color="primary" @click="leave">Cerrar sesión</v-btn>
    </v-card>
  </div>
</template>
