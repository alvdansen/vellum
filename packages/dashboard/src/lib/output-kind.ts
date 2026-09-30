/** Read only the primary output's display metadata; never trust a stored URL. */
export function primaryOutput(outputsJson?: string | null): {
  kind: 'image' | 'video' | 'audio' | 'file' | 'unknown';
  filename?: string;
} {
  try {
    const outputs: unknown = JSON.parse(outputsJson ?? 'null');
    const output = Array.isArray(outputs) ? outputs[0] : null;
    if (!output || typeof output !== 'object') return { kind: 'unknown' };
    const filename = typeof output.filename === 'string' ? output.filename : undefined;
    const mime = typeof output.content_type === 'string'
      ? output.content_type.split(';')[0].trim().toLowerCase() : '';
    if (mime.startsWith('image/')) return { kind: 'image', filename };
    if (mime.startsWith('video/')) return { kind: 'video', filename };
    if (mime.startsWith('audio/')) return { kind: 'audio', filename };
    if (mime) return { kind: 'file', filename };
    // Legacy outputs can lack MIME metadata. Only recognize known document extensions.
    if (filename && /\.(md|txt|json|jsonl|csv|yaml|yml|pdf)$/i.test(filename)) {
      return { kind: 'file', filename };
    }
    return { kind: 'unknown', filename };
  } catch {
    return { kind: 'unknown' };
  }
}
