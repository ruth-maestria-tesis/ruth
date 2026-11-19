<script setup lang="ts">
import { useAuthStore } from '~/stores/auth';
import { NAV_ITEMS } from '~/utils/navigation';
import { mockedModules } from '~/utils/mocks';

const auth = useAuthStore();
const route = useRoute();
const items = computed(() => NAV_ITEMS.filter((i) => auth.hasRole(...i.roles)));
// Longest matching prefix wins so /coordinator/theses does not also light /coordinator.
const active = computed(() => {
  const match = items.value.filter((i) => route.path === i.to || route.path.startsWith(`${i.to}/`));
  return match.sort((a, b) => b.to.length - a.to.length)[0]?.to;
});
const mocks = mockedModules();
</script>

<template>
  <AppTopBar :minimal="auth.isExternal" />
  <v-main>
    <div class="tabs-bar">
      <v-tabs :model-value="active" color="primary" height="48" show-arrows>
        <v-tab v-for="i in items" :key="i.to" :value="i.to" :to="i.to" :prepend-icon="i.icon" class="text-none">
          {{ i.title }}
        </v-tab>
      </v-tabs>
    </div>
    <v-container fluid class="pa-4 pa-md-6" style="max-width: 1440px">
      <v-alert v-if="auth.isExternal" type="info" variant="tonal" density="compact" class="mb-4" icon="mdi-shield-key-outline">
        Acceso express de jurado externo (RF-J14): solo puede trabajar sobre la tesis asignada.
      </v-alert>
      <slot />
    </v-container>
    <div v-if="mocks.length" class="text-meta text-center pb-4">
      Modo demostración: datos simulados para {{ mocks.join(', ') }}.
    </div>
  </v-main>
</template>

<style scoped>
.tabs-bar { background: #fff; border-bottom: 1px solid var(--uc-border); padding: 0 16px; }
</style>
