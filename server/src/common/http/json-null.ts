/**
 * Nest answers an empty body for null/undefined. Routes typed `View | null` pair
 * `@Header('Content-Type', 'application/json')` with `orJsonNull()` so the client gets `null`.
 */
export function orJsonNull<T>(value: T | null | undefined): T | 'null' {
  return value ?? 'null';
}
