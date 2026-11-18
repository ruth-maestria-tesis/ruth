/** `@ArrayUnique` identifier: hex ids that differ only in case are duplicates; non-strings pass through to the other validators. */
export const lowercaseIdentifier = (value: unknown): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;
