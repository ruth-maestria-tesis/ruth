import type { Role } from '@thesis/shared';
import { useAuthStore } from '~/stores/auth';
import { useUiStore } from '~/stores/ui';

/** Pages declare `definePageMeta({ middleware: 'role', roles: [...] })`. */
export default defineNuxtRouteMiddleware((to) => {
  const roles = (to.meta.roles ?? []) as Role[];
  const auth = useAuthStore();
  if (!roles.length || auth.hasRole(...roles)) return;
  useUiStore().notify('Acceso restringido para su rol.', 'warning');
  return navigateTo(auth.home);
});
