// src/utils/request-fingerprint.ts — stable identity for a submitted request.
//
// Used by the duplicate-submit guard. A submit whose response never arrived may
// still have been accepted and CHARGED remotely; the version is marked failed
// because no job id came back, so an agent that retries the identical request
// pays for the same work twice. Recognising "this is the same request as the one
// I just sent" needs an identity that is stable across two independent calls.
//
// Stability requirements:
//   - key order must not matter ({a,b} and {b,a} are the same request),
//   - nesting must be handled (provider payloads are deeply structured),
//   - arrays are ORDER-SENSITIVE (a list of prompts is not a set).

import { createHash } from 'node:crypto';

/**
 * Deterministic JSON: objects emit their keys in sorted order, arrays keep
 * theirs. Cycles are impossible here (the input arrived as JSON over MCP/HTTP)
 * but a depth ceiling keeps a pathological payload from blowing the stack.
 */
function canonicalize(value: unknown, depth = 0): string {
  if (depth > 64) return '"[max-depth]"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v, depth + 1)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v, depth + 1)}`);
  return `{${entries.join(',')}}`;
}

/**
 * Fingerprint of "this exact request, to this provider, for this shot".
 *
 * The shot and provider are part of the identity on purpose: the same prompt
 * submitted to a different shot is different work, and the same prompt sent to
 * a different backend is a different spend.
 */
export function fingerprintRequest(
  shotId: string,
  providerId: string,
  request: Record<string, unknown>,
): string {
  return createHash('sha256')
    .update(canonicalize({ shotId, providerId, request }))
    .digest('hex');
}
