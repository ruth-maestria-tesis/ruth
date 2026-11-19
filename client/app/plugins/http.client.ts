import { configureHttp, onBroadcastLogout } from '~/utils/http';
import { configureMocks } from '~/utils/mocks';
import { useAuthStore } from '~/stores/auth';
import { useUiStore } from '~/stores/ui';

export default defineNuxtPlugin({
  name: 'http',
  enforce: 'pre',
  setup(nuxtApp) {
    const config = useRuntimeConfig();
    const router = useRouter();
    const goLogin = () => {
      const auth = useAuthStore(nuxtApp.$pinia as never);
      // Concurrent 401s (and the logout broadcast) must redirect and notify only once; login resets it.
      if (auth.sessionLost) return;
      const wasExternal = auth.isExternal;
      auth.clear();
      auth.sessionLost = true;
      useUiStore(nuxtApp.$pinia as never).notify('Su sesión expiró. Vuelva a iniciar sesión.', 'warning');
      const current = router.currentRoute.value;
      if (current.path.startsWith('/external') || current.path === '/auth/external-access') return;
      // RF-J14: external sessions have no refresh; the juror reopens the emailed link.
      if (wasExternal) {
        router.push('/external/expired');
        return;
      }
      if (current.path !== '/login') {
        router.push({ path: '/login', query: { redirect: current.fullPath } });
      }
    };
    configureHttp({ apiBase: String(config.public.apiBase), onSessionLost: goLogin });
    configureMocks(config.public.mockModules as string);
    onBroadcastLogout(goLogin);
  },
});
