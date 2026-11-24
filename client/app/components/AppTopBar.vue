<script setup lang="ts">
import { useAuthStore } from '~/stores/auth';
import { ROLE_LABELS } from '~/utils/i18n';

defineProps<{ minimal?: boolean; title?: string; showMenu?: boolean }>();
defineEmits<{ menu: [] }>();
const auth = useAuthStore();
const { isDark, toggle } = useAppTheme();
const passwordOpen = ref(false);

const firstName = computed(() => (auth.displayName || '').split(' ')[0]);

async function logout() {
  await auth.logout();
  await navigateTo('/login');
}
</script>

<template>
  <v-app-bar flat height="76" class="uc-topbar" color="background">
    <v-app-bar-nav-icon v-if="showMenu" class="ml-2" aria-label="Abrir menú" @click="$emit('menu')" />
    <div class="px-4 px-md-8" style="min-width: 0">
      <div class="text-eyebrow">{{ title || 'Plataforma de tesis' }}</div>
      <div class="greeting text-truncate">Hola, {{ firstName || 'bienvenido' }}</div>
    </div>
    <v-spacer />
    <template v-if="auth.user">
      <v-btn
        :icon="isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
        variant="text"
        :aria-label="isDark ? 'Usar tema claro' : 'Usar tema oscuro'"
        @click="toggle"
      />
      <NotificationsBell v-if="!minimal" />
      <v-menu location="bottom end">
        <template #activator="{ props }">
          <v-btn v-bind="props" icon variant="text" class="mr-4 ml-1" aria-label="Cuenta">
            <v-icon icon="mdi-account-circle-outline" size="28" />
          </v-btn>
        </template>
        <v-list density="compact" min-width="240" rounded="lg">
          <v-list-item :title="auth.displayName" :subtitle="auth.user.email" />
          <v-list-item>
            <div class="d-flex flex-wrap ga-1">
              <v-chip v-for="r in auth.roles" :key="r" color="primary" variant="tonal">{{ ROLE_LABELS[r] }}</v-chip>
            </div>
          </v-list-item>
          <v-divider class="my-1" />
          <v-list-item v-if="!auth.isExternal" prepend-icon="mdi-lock-reset" title="Cambiar contraseña" @click="passwordOpen = true" />
          <v-list-item prepend-icon="mdi-logout" title="Cerrar sesión" @click="logout" />
        </v-list>
      </v-menu>
    </template>
    <ChangePasswordDialog v-model="passwordOpen" />
  </v-app-bar>
</template>

<style scoped>
.uc-topbar { border-bottom: 1px solid var(--uc-border) !important; backdrop-filter: blur(8px); }
.greeting { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.2; }
</style>
