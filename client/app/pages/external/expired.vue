<script setup lang="ts">
/** RF-J14: external sessions last 4 h and have no refresh; the juror must reopen the link. */
definePageMeta({ layout: 'blank' });
</script>

<template>
  <div class="d-flex align-center justify-center pa-4" style="min-height: 100vh">
    <v-card max-width="480" width="100%" class="pa-6 text-center">
      <v-icon icon="mdi-timer-off-outline" color="warning" size="48" class="mb-2" />
      <div class="text-h2-section mb-2">Su sesión de acceso expiró</div>
      <div class="text-body-2 text-medium-emphasis mb-4">
        Por seguridad, el acceso como jurado externo dura 4 horas. Vuelva a abrir el enlace que recibió por correo
        para continuar. Si el enlace ya venció, solicite uno nuevo a la coordinación del programa.
      </div>
    </v-card>
  </div>
</template>
