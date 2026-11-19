import { useAuthStore } from '~/stores/auth';

const PUBLIC = ['/login', '/auth/external-access'];

export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useAuthStore();
  if (!auth.loaded) await auth.fetchMe();
  const isPublic = PUBLIC.includes(to.path) || to.path.startsWith('/external/');
  if (isPublic) {
    if (to.path === '/login' && auth.isAuthenticated) return navigateTo(auth.home);
    return;
  }
  if (!auth.isAuthenticated) {
    return navigateTo({ path: '/login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} });
  }
  if (to.path === '/') return navigateTo(auth.home);
});
