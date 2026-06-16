// MODULAR: Multipart form-data parser. Hand-rolled boundary walker.
// DRY: the only multipart code in the codebase.
//
// CLEAN: the cursor advances through these positions, always
// landing on the START of a boundary line (or the end of the body):
//   - start: position of \r\n (before the first boundary)
//   - skip 2 to get to the boundary
//   - compare with the boundary bytes; advance
//   - check for closing '--' (end of body) or \r\n (continuing)
//   - read headers until empty line
//   - read body until the next \r\n+boundary
//   - leave cursor at the \r\n (next loop iteration handles it)

'use strict';

const CRLF = '\r\n';
const CRLF_BUF = Buffer.from(CRLF);

function readLine(buf, start) {
  // MODULAR: scan for the next \r\n. Returns the line (without
  // \r\n) and the offset of the byte AFTER the \r\n. If no \r\n
  // is found, returns the rest of the buffer.
  const idx = buf.indexOf(CRLF_BUF, start);
  if (idx === -1) return { line: buf.slice(start), next: buf.length };
  return { line: buf.slice(start, idx), next: idx + 2 };
}

function parseContentDisposition(headerBuf) {
  // MODULAR: extract name="..." and filename="..." (optional) from
  // a Content-Disposition header. Returns { name, filename }.
  const s = headerBuf.toString('utf8');
  const nameMatch = /name="([^"]+)"/.exec(s);
  const fileMatch = /filename="([^"]*)"/.exec(s);
  return {
    name: nameMatch ? nameMatch[1] : null,
    filename: fileMatch ? fileMatch[1] : null
  };
}

export function parseMultipart({ contentType, body, onField, onFile }) {
  // MODULAR: extract the boundary from the Content-Type header.
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) throw new Error('Missing boundary in Content-Type');
  const boundary = '--' + (m[1] || m[2]).trim();
  const boundaryBuf = Buffer.from(boundary);
  const BOUNDARY_LEN = boundaryBuf.length;

  let cursor = 0;
  while (cursor < body.length) {
    // MODULAR: the boundary is preceded by \r\n. If we're at the
    // start of the body, the boundary is the first 10+ bytes; if
    // we're past the first part, cursor is at the \r\n that
    // precedes the next boundary. Handle both.
    if (cursor === 0) {
      // First boundary is at position 0.
    } else {
      // Skip the \r\n that precedes the boundary.
      if (body.slice(cursor, cursor + 2).toString() !== CRLF) {
        throw new Error('Multipart: expected CRLF before next boundary');
      }
      cursor += 2;
    }
    // MODULAR: verify + skip the boundary.
    if (body.slice(cursor, cursor + BOUNDARY_LEN).toString() !== boundary) {
      throw new Error('Multipart: expected boundary');
    }
    cursor += BOUNDARY_LEN;
    // Closing boundary: '--' follows. End of the multipart body.
    if (body.slice(cursor, cursor + 2).toString() === '--') {
      break;
    }
    // Otherwise expect \r\n.
    if (body.slice(cursor, cursor + 2).toString() !== CRLF) {
      throw new Error('Multipart: malformed boundary delimiter');
    }
    cursor += 2;

    // MODULAR: read the part's headers. They're terminated by a
    // blank \r\n. The body of the part follows the blank line.
    const headers = {};
    while (true) {
      const { line, next } = readLine(body, cursor);
      if (line.length === 0) { cursor = next; break; }
      const colon = line.indexOf(':');
      if (colon > 0) {
        const name = line.slice(0, colon).toString('utf8').trim().toLowerCase();
        const value = line.slice(colon + 1).toString('utf8').trim();
        headers[name] = value;
      }
      cursor = next;
    }

    // MODULAR: read the part's body until the next boundary.
    // The next boundary is preceded by \r\n; we slice the body
    // from cursor up to that \r\n (exclusive). The cursor is
    // left at the \r\n so the next loop iteration skips it.
    const nextCRLF = body.indexOf(Buffer.concat([CRLF_BUF, boundaryBuf]), cursor);
    if (nextCRLF === -1) throw new Error('Multipart: unterminated part');
    const partBody = body.slice(cursor, nextCRLF);
    cursor = nextCRLF;

    const disposition = parseContentDisposition(Buffer.from(headers['content-disposition'] || ''));
    if (!disposition.name) continue;
    if (disposition.filename != null) {
      onFile(disposition.name, disposition.filename, headers['content-type'] || 'application/octet-stream', partBody);
    } else {
      onField(disposition.name, partBody.toString('utf8'));
    }
  }
}
