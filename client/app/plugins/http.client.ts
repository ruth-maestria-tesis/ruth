import { configureHttp, onBroadcastLogout } from '~/utils/http';
import { configureMocks } from '~/utils/mocks';
import { useAuthStore } from '~/stores/auth';

export default defineNuxtPlugin({
  name: 'http',
  enforce: 'pre',
  setup(nuxtApp) {
    const config = useRuntimeConfig();
    const router = useRouter();
    const goLogin = () => {
      const auth = useAuthStore(nuxtApp.$pinia as never);
      auth.clear();
      const current = router.currentRoute.value;
      if (current.path !== '/login' && !current.path.startsWith('/external')) {
        router.push({ path: '/login', query: { redirect: current.fullPath } });
      }
    };
    configureHttp({ apiBase: String(config.public.apiBase), onSessionLost: goLogin });
    configureMocks(config.public.mockModules as string);
    onBroadcastLogout(goLogin);
  },
});
