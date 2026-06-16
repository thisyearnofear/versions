// MODULAR: Multipart parser unit tests. Pure functions; no IO.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMultipart } = require('../runtime/multipart');

function makeBody(parts, boundary) {
  // MODULAR: a helper that builds a raw multipart body. The
  // boundary appears between parts and at the end (with '--').
  const chunks = [];
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

test('parseMultipart: extracts a single text field', () => {
  const body = makeBody([
    { headers: { 'Content-Disposition': 'form-data; name="title"' }, body: Buffer.from('Hello') }
  ], 'BOUNDARY');
  const fields = {};
  const files = [];
  parseMultipart({
    contentType: 'multipart/form-data; boundary=BOUNDARY',
    body,
    onField: (n, v) => { fields[n] = v; },
    onFile: (n, fn, ct, d) => { files.push({ n, fn, ct, size: d.length }); }
  });
  assert.equal(fields.title, 'Hello');
  assert.equal(files.length, 0);
});

test('parseMultipart: extracts a file part', () => {
  const body = makeBody([
    {
      headers: {
        'Content-Disposition': 'form-data; name="audio"; filename="a.wav"',
        'Content-Type': 'audio/wav'
      },
      body: Buffer.from([0x52, 0x49, 0x46, 0x46])   // "RIFF"
    }
  ], 'B');
  const files = [];
  parseMultipart({
    contentType: 'multipart/form-data; boundary=B',
    body,
    onField: () => {},
    onFile: (n, fn, ct, d) => { files.push({ n, fn, ct, head: d.slice(0, 4).toString() }); }
  });
  assert.equal(files.length, 1);
  assert.equal(files[0].n, 'audio');
  assert.equal(files[0].fn, 'a.wav');
  assert.equal(files[0].ct, 'audio/wav');
  assert.equal(files[0].head, 'RIFF');
});

test('parseMultipart: extracts mixed fields + files', () => {
  const body = makeBody([
    { headers: { 'Content-Disposition': 'form-data; name="signature"' }, body: Buffer.from('abc123') },
    { headers: { 'Content-Disposition': 'form-data; name="metadata"' }, body: Buffer.from('{"x":1}') },
    {
      headers: {
        'Content-Disposition': 'form-data; name="audio"; filename="x.mp3"',
        'Content-Type': 'audio/mpeg'
      },
      body: Buffer.from([0xff, 0xfb, 0x90, 0x00])
    }
  ], 'X');
  const fields = {};
  const files = [];
  parseMultipart({
    contentType: 'multipart/form-data; boundary=X',
    body,
    onField: (n, v) => { fields[n] = v; },
    onFile: (n) => { files.push(n); }
  });
  assert.equal(fields.signature, 'abc123');
  assert.equal(fields.metadata, '{"x":1}');
  assert.deepEqual(files, ['audio']);
});

test('parseMultipart: throws on missing boundary', () => {
  assert.throws(() => parseMultipart({
    contentType: 'application/json',
    body: Buffer.alloc(0),
    onField: () => {}, onFile: () => {}
  }), /Missing boundary/);
});

test('parseMultipart: handles quoted boundary', () => {
  const body = makeBody([
    { headers: { 'Content-Disposition': 'form-data; name="x"' }, body: Buffer.from('y') }
  ], 'WITH-SPACE');
  const fields = {};
  parseMultipart({
    contentType: 'multipart/form-data; boundary="WITH-SPACE"',
    body,
    onField: (n, v) => { fields[n] = v; },
    onFile: () => {}
  });
  assert.equal(fields.x, 'y');
});

test('parseMultipart: handles multiple files of the same field', () => {
  const body = makeBody([
    { headers: { 'Content-Disposition': 'form-data; name="audio"; filename="a.mp3"', 'Content-Type': 'audio/mpeg' }, body: Buffer.from([1, 2, 3]) },
    { headers: { 'Content-Disposition': 'form-data; name="audio"; filename="b.mp3"', 'Content-Type': 'audio/mpeg' }, body: Buffer.from([4, 5, 6]) }
  ], 'B');
  const files = [];
  parseMultipart({
    contentType: 'multipart/form-data; boundary=B',
    body,
    onField: () => {},
    onFile: (n, fn, ct, d) => { files.push({ fn, head: Array.from(d) }); }
  });
  assert.equal(files.length, 2);
  assert.equal(files[0].fn, 'a.mp3');
  assert.deepEqual(files[0].head, [1, 2, 3]);
  assert.equal(files[1].fn, 'b.mp3');
  assert.deepEqual(files[1].head, [4, 5, 6]);
});
