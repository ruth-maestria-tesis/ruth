/** Stored in the file metadata (`files.files` metadata.kind, spec §5). */
export enum FileKind {
  MANUSCRIPT = 'MANUSCRIPT',
  CORRECTION = 'CORRECTION',
  FEEDBACK_EVIDENCE = 'FEEDBACK_EVIDENCE',
  MINUTES_PDF = 'MINUTES_PDF',
}

/** How the browser sends a file: straight to Blob storage (DIRECT) or through the API (MULTIPART). */
export enum UploadStrategy {
  DIRECT = 'DIRECT',
  MULTIPART = 'MULTIPART',
}
