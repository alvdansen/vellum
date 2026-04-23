import { describe, expect, test } from 'vitest';
import { extractTextChunk } from '../png-metadata.js';

/**
 * Test helpers: build a minimal PNG with arbitrary tEXt chunks. No real image
 * data is needed — the chunk walker only cares about chunk layout (length / type
 * / data / crc tuples) and doesn't decode IDAT.
 */
function makeChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); // CRC not validated by extractor — fill with zeros.
  return Buffer.concat([len, typeBuf, data, crc]);
}

function buildPngWithTextChunks(chunks: Array<{ key: string; value: string }>): Buffer {
  const parts: Buffer[] = [];
  // Magic.
  parts.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  // IHDR (13 bytes zeroed — content irrelevant for chunk walker).
  const ihdr = Buffer.alloc(13);
  parts.push(makeChunk('IHDR', ihdr));
  // Arbitrary tEXt chunks.
  for (const { key, value } of chunks) {
    const keyBuf = Buffer.from(key, 'ascii');
    const valBuf = Buffer.from(value, 'utf8');
    const data = Buffer.concat([keyBuf, Buffer.from([0]), valBuf]);
    parts.push(makeChunk('tEXt', data));
  }
  parts.push(makeChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

describe('extractTextChunk (D-PROV-05)', () => {
  test('returns value for matching keyword', () => {
    const buf = buildPngWithTextChunks([{ key: 'prompt', value: '{"3":{"class_type":"KSampler"}}' }]);
    expect(extractTextChunk(buf, 'prompt')).toBe('{"3":{"class_type":"KSampler"}}');
  });

  test('returns correct value when multiple tEXt chunks exist', () => {
    const buf = buildPngWithTextChunks([
      { key: 'workflow', value: '{"nodes":[]}' },
      { key: 'prompt', value: '{"x":1}' },
    ]);
    expect(extractTextChunk(buf, 'prompt')).toBe('{"x":1}');
    expect(extractTextChunk(buf, 'workflow')).toBe('{"nodes":[]}');
  });

  test('returns null for missing keyword', () => {
    const buf = buildPngWithTextChunks([{ key: 'prompt', value: '{}' }]);
    expect(extractTextChunk(buf, 'workflow')).toBeNull();
  });

  test('returns null for non-PNG buffer (wrong magic)', () => {
    expect(extractTextChunk(Buffer.from('not a png'), 'prompt')).toBeNull();
  });

  test('returns null for empty buffer', () => {
    expect(extractTextChunk(Buffer.alloc(0), 'prompt')).toBeNull();
  });

  test('returns null for buffer smaller than PNG magic', () => {
    expect(extractTextChunk(Buffer.from([0x89, 0x50]), 'prompt')).toBeNull();
  });

  test('returns null when chunk length exceeds buffer', () => {
    const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const lenTooBig = Buffer.from([0xff, 0xff, 0xff, 0xff]);
    const type = Buffer.from('tEXt', 'ascii');
    expect(extractTextChunk(Buffer.concat([header, lenTooBig, type]), 'prompt')).toBeNull();
  });

  test('returns first matching chunk if duplicates exist', () => {
    const buf = buildPngWithTextChunks([
      { key: 'prompt', value: 'first' },
      { key: 'prompt', value: 'second' },
    ]);
    expect(extractTextChunk(buf, 'prompt')).toBe('first');
  });

  test('UTF-8 value decoded correctly', () => {
    const buf = buildPngWithTextChunks([{ key: 'prompt', value: '{"note":"café→résumé"}' }]);
    expect(extractTextChunk(buf, 'prompt')).toBe('{"note":"café→résumé"}');
  });

  test('skips non-tEXt chunks (IHDR, IEND)', () => {
    // Build PNG with only IHDR+IEND (no tEXt) — should return null.
    const parts: Buffer[] = [];
    parts.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    parts.push(makeChunk('IHDR', Buffer.alloc(13)));
    parts.push(makeChunk('IEND', Buffer.alloc(0)));
    expect(extractTextChunk(Buffer.concat(parts), 'prompt')).toBeNull();
  });

  test('empty-string value returns empty string', () => {
    const buf = buildPngWithTextChunks([{ key: 'prompt', value: '' }]);
    // Keyword + null + empty value → length is keyword + 1, the tEXt chunk is valid.
    // extractTextChunk returns the substring after the null byte, which is ''.
    expect(extractTextChunk(buf, 'prompt')).toBe('');
  });
});
