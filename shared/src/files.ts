/** Stored in GridFS metadata.kind (spec §5). */
export enum FileKind {
  MANUSCRIPT = 'MANUSCRIPT',
  CORRECTION = 'CORRECTION',
  FEEDBACK_EVIDENCE = 'FEEDBACK_EVIDENCE',
  MINUTES_PDF = 'MINUTES_PDF',
}
