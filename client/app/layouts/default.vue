<script setup lang="ts">
import { useDisplay } from 'vuetify';
import { useAuthStore } from '~/stores/auth';
import { NAV_ITEMS } from '~/utils/navigation';
import { mockedModules } from '~/utils/mocks';
import { ROLE_LABELS } from '~/utils/i18n';

const auth = useAuthStore();
const route = useRoute();
const { mdAndUp } = useDisplay();
const items = computed(() => NAV_ITEMS.filter((i) => auth.hasRole(...i.roles)));
// Longest matching prefix wins so /coordinator/theses does not also light /coordinator.
const active = computed(() => {
  const match = items.value.filter((i) => route.path === i.to || route.path.startsWith(`${i.to}/`));
  return match.sort((a, b) => b.to.length - a.to.length)[0];
});
const drawer = ref<boolean | null>(null);
const mocks = mockedModules();

const initials = computed(() =>
  (auth.displayName || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase(),
);
const roleLabel = computed(() => (auth.roles[0] ? ROLE_LABELS[auth.roles[0]] : ''));

async function logout() {
  await auth.logout();
  await navigateTo('/login');
}
</script>

<template>
  <v-navigation-drawer v-model="drawer" :permanent="mdAndUp" width="276" class="uc-sidebar" border="0">
    <div class="d-flex align-center ga-3 px-5 pt-6 pb-5">
      <div class="brand-mark">R</div>
      <div>
        <div class="brand-name">Ruth</div>
        <div class="brand-sub">Tesis de posgrado · Unicórdoba</div>
      </div>
    </div>

    <div class="nav-label px-6 mb-2">Menú</div>
    <v-list nav density="comfortable" class="px-3 bg-transparent">
      <v-list-item
        v-for="i in items"
        :key="i.to"
        :to="i.to"
        :prepend-icon="i.icon"
        :title="i.title"
        :active="active?.to === i.to"
        rounded="lg"
        class="nav-item"
        active-class="nav-item--active"
      />
    </v-list>

    <template #append>
      <div v-if="auth.user" class="user-card ma-3 pa-3">
        <div class="d-flex align-center ga-3">
          <v-avatar size="38" class="uc-gradient font-weight-bold text-body-2">{{ initials }}</v-avatar>
          <div class="flex-grow-1" style="min-width: 0">
            <div class="text-body-2 font-weight-bold text-white text-truncate">{{ auth.displayName }}</div>
            <div class="text-caption text-truncate" style="color: var(--uc-sidebar-text)">{{ roleLabel }}</div>
          </div>
          <v-btn icon="mdi-logout" variant="text" size="small" color="grey-lighten-1" aria-label="Cerrar sesión" @click="logout" />
        </div>
      </div>
    </template>
  </v-navigation-drawer>

  <AppTopBar :minimal="auth.isExternal" :title="active?.title" :show-menu="!mdAndUp" @menu="drawer = !drawer" />

  <v-main>
    <v-container fluid class="pa-4 pa-md-8" style="max-width: 1480px">
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
.uc-sidebar { background: var(--uc-sidebar) !important; color: #fff; border-right: 1px solid rgba(255, 255, 255, 0.06) !important; }
.brand-mark {
  width: 40px; height: 40px; border-radius: 12px; background: var(--uc-grad);
  display: flex; align-items: center; justify-content: center;
  font-weight: 800; font-size: 20px; color: #fff; box-shadow: 0 8px 20px -8px rgba(155, 107, 255, 0.9);
}
.brand-name { font-weight: 800; font-size: 18px; letter-spacing: -0.02em; color: #fff; }
.brand-sub { font-size: 11px; color: var(--uc-sidebar-text); }
.nav-label { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #6E6890; }
.nav-item { color: var(--uc-sidebar-text) !important; margin-bottom: 2px; font-weight: 600; }
.nav-item :deep(.v-list-item-title) { font-size: 13.5px; font-weight: 600; }
.nav-item:hover { color: #fff !important; }
.nav-item--active { background: var(--uc-grad) !important; color: #fff !important; box-shadow: 0 10px 24px -12px rgba(155, 107, 255, 0.9); }
.nav-item--active :deep(.v-list-item__overlay) { opacity: 0 !important; }
.user-card { background: var(--uc-sidebar-2); border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.06); }
</style>
