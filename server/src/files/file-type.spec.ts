import { detectFileType } from './file-type';

const zip = (...names: string[]) =>
  Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.alloc(26),
    ...names.map((n) => Buffer.from(n)),
  ]);

describe('detectFileType', () => {
  it('detects PDF by its %PDF- header', () => {
    expect(detectFileType(Buffer.from('%PDF-1.7\n...'))).toBe('pdf');
  });

  it('detects legacy Word (OLE compound file)', () => {
    expect(
      detectFileType(
        Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]),
      ),
    ).toBe('doc');
  });

  it('detects docx as a ZIP containing word/ entries', () => {
    expect(
      detectFileType(zip('[Content_Types].xml', 'word/document.xml')),
    ).toBe('docx');
  });

  it('rejects other ZIPs, text, empty and short buffers', () => {
    expect(detectFileType(zip('xl/workbook.xml'))).toBeNull();
    expect(detectFileType(Buffer.from('hello'))).toBeNull();
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
    expect(detectFileType(Buffer.from('%PD'))).toBeNull();
  });
});
