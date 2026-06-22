// MODULAR: multipart parser port. Pure; no IO.

import { describe, it, expect } from 'vitest';
import { parseMultipart } from '../../src/lib/multipart';

function makeBody(
  parts: Array<{ headers: Record<string, string>; body?: Buffer }>,
  boundary: string,
): Buffer {
  const chunks: Buffer[] = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    const headerLines = Object.entries(p.headers).map(([k, v]) => `${k}: ${v}\r\n`);
    chunks.push(Buffer.from(headerLines.join('')));
    if (p.body) {
      chunks.push(Buffer.from('\r\n'));
      chunks.push(p.body);
      chunks.push(Buffer.from('\r\n'));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

describe('parseMultipart', () => {
  it('extracts a single text field', () => {
    const body = makeBody(
      [
        {
          headers: { 'Content-Disposition': 'form-data; name="title"' },
          body: Buffer.from('Hello'),
        },
      ],
      'BOUNDARY',
    );
    const fields: Record<string, string> = {};
    const files: unknown[] = [];
    parseMultipart({
      contentType: 'multipart/form-data; boundary=BOUNDARY',
      body,
      onField: (n, v) => {
        fields[n] = v;
      },
      onFile: () => {},
    });
    expect(fields.title).toBe('Hello');
    expect(files.length).toBe(0);
  });

  it('extracts a file part', () => {
    const body = makeBody(
      [
        {
          headers: {
            'Content-Disposition': 'form-data; name="audio"; filename="a.wav"',
            'Content-Type': 'audio/wav',
          },
          body: Buffer.from([0x52, 0x49, 0x46, 0x46]),
        },
      ],
      'B',
    );
    const files: Array<{ n: string; fn: string; ct: string; head: string }> = [];
    parseMultipart({
      contentType: 'multipart/form-data; boundary=B',
      body,
      onField: () => {},
      onFile: (n, fn, ct, d) => {
        files.push({ n, fn, ct, head: d.slice(0, 4).toString() });
      },
    });
    expect(files.length).toBe(1);
    expect(files[0].n).toBe('audio');
    expect(files[0].fn).toBe('a.wav');
    expect(files[0].ct).toBe('audio/wav');
    expect(files[0].head).toBe('RIFF');
  });

  it('extracts mixed fields + files', () => {
    const body = makeBody(
      [
        { headers: { 'Content-Disposition': 'form-data; name="signature"' }, body: Buffer.from('abc123') },
        { headers: { 'Content-Disposition': 'form-data; name="metadata"' }, body: Buffer.from('{"x":1}') },
        {
          headers: {
            'Content-Disposition': 'form-data; name="audio"; filename="x.mp3"',
            'Content-Type': 'audio/mpeg',
          },
          body: Buffer.from([0xff, 0xfb, 0x90, 0x00]),
        },
      ],
      'X',
    );
    const fields: Record<string, string> = {};
    const files: string[] = [];
    parseMultipart({
      contentType: 'multipart/form-data; boundary=X',
      body,
      onField: (n, v) => {
        fields[n] = v;
      },
      onFile: (n) => files.push(n),
    });
    expect(fields.signature).toBe('abc123');
    expect(fields.metadata).toBe('{"x":1}');
    expect(files).toEqual(['audio']);
  });

  it('throws on missing boundary', () => {
    expect(() =>
      parseMultipart({
        contentType: 'application/json',
        body: Buffer.alloc(0),
        onField: () => {},
        onFile: () => {},
      }),
    ).toThrow(/Missing boundary/);
  });

  it('handles quoted boundary', () => {
    const body = makeBody(
      [
        { headers: { 'Content-Disposition': 'form-data; name="x"' }, body: Buffer.from('y') },
      ],
      'WITH-SPACE',
    );
    const fields: Record<string, string> = {};
    parseMultipart({
      contentType: 'multipart/form-data; boundary="WITH-SPACE"',
      body,
      onField: (n, v) => {
        fields[n] = v;
      },
      onFile: () => {},
    });
    expect(fields.x).toBe('y');
  });

  it('handles multiple files of the same field', () => {
    const body = makeBody(
      [
        {
          headers: {
            'Content-Disposition': 'form-data; name="audio"; filename="a.mp3"',
            'Content-Type': 'audio/mpeg',
          },
          body: Buffer.from([1, 2, 3]),
        },
        {
          headers: {
            'Content-Disposition': 'form-data; name="audio"; filename="b.mp3"',
            'Content-Type': 'audio/mpeg',
          },
          body: Buffer.from([4, 5, 6]),
        },
      ],
      'B',
    );
    const files: Array<{ fn: string; head: number[] }> = [];
    parseMultipart({
      contentType: 'multipart/form-data; boundary=B',
      body,
      onField: () => {},
      onFile: (_n, fn, _ct, d) => {
        files.push({ fn, head: Array.from(d) });
      },
    });
    expect(files.length).toBe(2);
    expect(files[0].fn).toBe('a.mp3');
    expect(files[0].head).toEqual([1, 2, 3]);
    expect(files[1].fn).toBe('b.mp3');
    expect(files[1].head).toEqual([4, 5, 6]);
  });
});
