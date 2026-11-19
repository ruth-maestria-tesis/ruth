import { defineStore } from 'pinia';
import { Role } from '@thesis/shared';
import type { User } from '~/types/api';
import { authApi } from '~/utils/api';
import { broadcastLogout } from '~/utils/http';

/** Landing route per role (navigation map §2). */
export function homeFor(roles: readonly Role[]): string {
  if (roles.includes(Role.COORDINATOR)) return '/coordinator';
  if (roles.includes(Role.ADMIN)) return '/admin/users';
  if (roles.includes(Role.INTERNAL_JUROR) || roles.includes(Role.EXTERNAL_JUROR)) return '/juror';
  if (roles.includes(Role.STUDENT)) return '/student';
  return '/login';
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as User | null,
    loaded: false,
  }),
  getters: {
    isAuthenticated: (s) => !!s.user,
    roles: (s): Role[] => s.user?.roles ?? [],
    home(): string {
      return homeFor(this.roles);
    },
    displayName: (s) => (s.user ? `${s.user.firstName} ${s.user.lastName}` : ''),
    isExternal: (s) => !!s.user && s.user.roles.every((r) => r === Role.EXTERNAL_JUROR),
  },
  actions: {
    hasRole(...roles: Role[]) {
      return roles.some((r) => this.roles.includes(r));
    },
    async fetchMe() {
      try {
        this.user = (await authApi.me()).user;
      } catch {
        this.user = null;
      } finally {
        this.loaded = true;
      }
    },
    async login(email: string, password: string) {
      this.user = (await authApi.login(email, password)).user;
      this.loaded = true;
    },
    async loginExternal(token: string) {
      this.user = (await authApi.validateExternalToken(token)).user;
      this.loaded = true;
    },
    async logout() {
      try {
        await authApi.logout();
      } catch {
        /* cookies may already be gone */
      }
      this.clear();
      broadcastLogout();
    },
    clear() {
      this.user = null;
      this.loaded = true;
    },
  },
});
