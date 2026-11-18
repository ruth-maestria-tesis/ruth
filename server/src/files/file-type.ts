export type AllowedFileType = 'pdf' | 'doc' | 'docx';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const MIME_TYPES: Readonly<Record<AllowedFileType, string>> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Type from magic bytes; the client-declared MIME type is never trusted. */
export function detectFileType(buf: Buffer): AllowedFileType | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-')
    return 'pdf';
  // Known limit: this accepts any OLE compound file (xls, ppt, msg...), not just Word.
  if (buf.length >= 8 && buf.subarray(0, 8).equals(OLE)) return 'doc';
  // ZIP local headers store entry names uncompressed; a docx has both of these parts.
  if (
    buf.length >= 4 &&
    buf.subarray(0, 4).equals(ZIP) &&
    buf.includes('[Content_Types].xml') &&
    buf.includes('word/document.xml')
  )
    return 'docx';
  return null;
}
