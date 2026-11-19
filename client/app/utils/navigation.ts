import { Role } from '@thesis/shared';

export interface NavItem {
  title: string;
  icon: string;
  to: string;
  roles: Role[];
}

/** Menu per role (mapa-navegacion-rbac.md §2). */
export const NAV_ITEMS: NavItem[] = [
  { title: 'Dashboard Coordinación', icon: 'mdi-view-dashboard-outline', to: '/coordinator', roles: [Role.COORDINATOR] },
  { title: 'Bandeja General de Tesis', icon: 'mdi-folder-multiple-outline', to: '/coordinator/theses', roles: [Role.COORDINATOR, Role.ADMIN] },
  { title: 'Sustentaciones', icon: 'mdi-calendar-clock', to: '/coordinator/defenses', roles: [Role.COORDINATOR] },
  { title: 'Usuarios', icon: 'mdi-account-group-outline', to: '/admin/users', roles: [Role.ADMIN] },
  { title: 'Auditoría', icon: 'mdi-shield-search', to: '/admin/audit', roles: [Role.ADMIN, Role.COORDINATOR] },
  { title: 'Mis designaciones', icon: 'mdi-clipboard-check-outline', to: '/juror', roles: [Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR] },
  { title: 'Mi tesis', icon: 'mdi-school-outline', to: '/student', roles: [Role.STUDENT] },
  { title: 'Observaciones', icon: 'mdi-message-text-outline', to: '/student/feedback', roles: [Role.STUDENT] },
  { title: 'Sustentación y acta', icon: 'mdi-certificate-outline', to: '/student/minutes', roles: [Role.STUDENT] },
];
