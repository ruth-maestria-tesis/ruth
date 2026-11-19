# Thesis Repository — Client (Nuxt 4)

Nuxt 4 SPA (Vue 3 `<script setup lang="ts">`, Pinia, Vuetify 3) for the Universidad de Córdoba postgraduate thesis platform. Code is in English; all UI text is Spanish. Enums come from `@thesis/shared` (aliased to `shared/src`, so no build step is needed).

## Commands (from the repo root)
| Command | What it does |
|---|---|
| `pnpm dev:client` | Dev server on `http://localhost:3000` |
| `pnpm build:client` | Production build (`client/.output`) |
| `pnpm typecheck:client` | `nuxt typecheck` (vue-tsc) |

The API must be running (`pnpm dev:server`, `http://localhost:3001/api`) with `CLIENT_URL=http://localhost:3000` so CORS accepts the cookies.

## Configuration (runtime, via env)
| Variable | Default | Meaning |
|---|---|---|
| `NUXT_PUBLIC_API_BASE` | `http://localhost:3001/api` | API base URL |
| `NUXT_PUBLIC_MOCK_MODULES` | empty (real API for everything) | Modules served by in-memory mock data (`app/utils/mocks.ts`), for demos without a server. Comma list of `evaluations,feedback,disputes,defenses,minutes,notifications,dashboard`, or `all` |

Every module now talks to the real server by default. The mocks follow `docs/superpowers/specs/2026-11-19-mvp-api-contracts.md`, live only in the current tab and reset on reload. While `dashboard` is mocked, its counts come from the real `GET /theses` list.

## Auth
- httpOnly cookies; every request uses `credentials: 'include'` (`app/utils/http.ts`).
- Refresh tokens rotate with strict reuse detection, so refresh is **single-flight**: one in-flight promise per tab, plus the Web Locks API across tabs (a tab that waited skips its refresh if another tab already refreshed). The failed request is retried once; on failure the user goes to `/login?redirect=…`. Logout is broadcast to other tabs.
- Error `code`s map to Spanish messages in one place: `app/utils/i18n.ts`.
- External jurors (RF-J14) enter through `/auth/external-access?token=…` (or `/external/<token>`, or by pasting the link on the login tab).

## Routes per role
| Role | Routes |
|---|---|
| COORDINATOR | `/coordinator` (dashboard), `/coordinator/theses` (inbox), `/coordinator/theses/new`, `/coordinator/theses/:id` (detail, CU-01 assign, replace, external links), `…/:id/feedback`, `…/:id/dispute` (CU-05), `…/:id/defense` (CU-03 + CU-04), `…/:id/traceability` (CU-07), `/coordinator/defenses` |
| ADMIN | `/admin/users`, read access to the inbox |
| INTERNAL_JUROR / EXTERNAL_JUROR | `/juror` (CU-08), `/juror/evaluation/:assignmentId` (PDF + CU-02 rubric), `…/feedback` (CU-06), `…/minutes` (defense confirmation, signature) |
| STUDENT | `/student` (status, progress, concepts, manuscript, graph), `/student/feedback`, `/student/minutes` |

Pages declare `definePageMeta({ middleware: 'role', roles: [...] })`; `middleware/auth.global.ts` loads `/auth/me` once and guards everything except `/login` and the external-access routes.
