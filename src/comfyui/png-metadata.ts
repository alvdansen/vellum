/**
 * D-PROV-05: extract tEXt chunk values from PNG buffers.
 *
 * ComfyUI writes the resolved prompt JSON into a tEXt chunk with keyword
 * 'prompt' on every image output; the source workflow JSON lands in a
 * separate tEXt chunk with keyword 'workflow'. This module is the primary
 * path for reading the resolved prompt blob at completion time.
 *
 * Pure: takes a Buffer in, returns string|null. Zero IO beyond reading the
 * buffer. Returns null on any malformed input — callers surface
 * PROVENANCE_UNAVAILABLE downstream.
 */

// PNG magic: 137 80 78 71 13 10 26 10
export const PNG_MAGIC: ReadonlyArray<number> = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function hasPngMagic(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  for (let i = 0; i < 8; i++) if (buf[i] !== PNG_MAGIC[i]) return false;
  return true;
}

/**
 * Return the tEXt chunk value for `key`, or null if absent / malformed / not a PNG.
 * PNG chunk layout: [length:u32be][type:4-ascii][data:length][crc:u32].
 * tEXt layout inside data: ASCII keyword + null byte + Latin-1 text.
 *
 * CRC is NOT validated — ComfyUI writes correct CRCs, and strict CRC checking
 * would make the parser intolerant of otherwise-valid test fixtures. Callers
 * that need wire-level integrity should verify separately.
 */
export function extractTextChunk(buf: Buffer, key: string): string | null {
  if (!hasPngMagic(buf)) return null;
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const next = dataEnd + 4; // +4 CRC
    if (dataEnd > buf.length || next > buf.length) return null; // malformed
    if (type === 'IEND') return null;
    if (type === 'tEXt' && length > 0) {
      // Find first null byte separating keyword and text.
      let nul = -1;
      for (let i = dataStart; i < dataEnd; i++) {
        if (buf[i] === 0) {
          nul = i;
          break;
        }
      }
      if (nul !== -1) {
        const keyword = buf.toString('ascii', dataStart, nul);
        if (keyword === key) {
          // Value is Latin-1 in the spec, but ComfyUI writes UTF-8 JSON.
          return buf.toString('utf8', nul + 1, dataEnd);
        }
      }
    }
    offset = next;
  }
  return null;
}
