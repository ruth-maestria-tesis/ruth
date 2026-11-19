import type { Role } from '@thesis/shared';

declare module '#app' {
  interface PageMeta {
    roles?: Role[];
  }
}
export {};
