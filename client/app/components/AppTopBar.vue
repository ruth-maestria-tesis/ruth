<script setup lang="ts">
import { useAuthStore } from '~/stores/auth';
import { ROLE_LABELS } from '~/utils/i18n';

defineProps<{ minimal?: boolean }>();
const auth = useAuthStore();
const passwordOpen = ref(false);

async function logout() {
  await auth.logout();
  await navigateTo('/login');
}
</script>

<template>
  <v-app-bar class="uc-topbar" flat height="64">
    <div class="d-flex align-center ga-3 px-4">
      <div class="brand-logo">UC</div>
      <div class="text-white">
        <div class="font-weight-bold" style="font-size: 1.05rem">Plataforma de Tesis de Posgrado</div>
        <div class="d-none d-sm-block" style="font-size: 0.75rem; opacity: 0.85">
          Universidad de Córdoba — Vicerrectoría de Investigación y Posgrados
        </div>
      </div>
    </div>
    <v-spacer />
    <template v-if="auth.user">
      <NotificationsBell v-if="!minimal" />
      <v-menu location="bottom end">
        <template #activator="{ props }">
          <v-btn v-bind="props" variant="tonal" color="white" class="mr-3 role-pill" prepend-icon="mdi-account-check-outline">
            <span class="d-none d-md-inline">{{ auth.displayName }}</span>
            <span class="d-md-none">Cuenta</span>
          </v-btn>
        </template>
        <v-list density="compact" min-width="240">
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
.brand-logo {
  width: 40px; height: 40px; background: white; border-radius: 8px; display: flex;
  align-items: center; justify-content: center; font-weight: 800; color: #006837; font-size: 1.25rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}
.role-pill { border-radius: 20px !important; }
</style>
