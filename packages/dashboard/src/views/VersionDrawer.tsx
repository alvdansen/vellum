/**
 * VersionDrawer — right-rail drawer rendering the selected version's detail.
 *
 * Per must-have contract (Plan 05-10 frontmatter):
 *   "VersionDrawer renders version timeline + a provenance section + a
 *    'View Diff' button"
 *
 * Composition:
 *   - header: label + status pill + View Diff button + close button
 *   - timeline section: created / completed timestamps (the version's own
 *     lifecycle events; fills "timeline" contract at a single-version scope)
 *   - provenance section: events array from GET /api/versions/:id/provenance,
 *     each rendered via JsonBlock (Plan 09 primitive — auto-escaped text node)
 *   - when View Diff is clicked: opens a DiffDrawer with the previous version
 *     (by version_number in the shot's versions list) as "before" and this
 *     version as "after". Also lazy-fetches the structured diff summary.
 *
 * Drawer width locked via --drawer-version-width (560px) per UI-SPEC.md.
 *
 * SECURITY — T-5-06: all dynamic content flows through JSX text children or
 * through JsonBlock (which wraps in <pre>{JSON.stringify(...)}</pre>). No
 * dangerouslySetInnerHTML. Provenance events never interpolate into HTML.
 */

import { useState, useEffect } from 'preact/hooks';
import { StatusPill } from '../components/StatusPill.js';
import type { Status } from '../components/StatusPill.js';
import { JsonBlock } from '../components/JsonBlock.js';
import { EmptyState } from '../components/EmptyState.js';
import { DiffDrawer } from './DiffDrawer.js';
import { getProvenance, diffVersion, getOutputUrl } from '../lib/api.js';
import type { Version } from '../types/entities.js';
import { versionLabel, normalizeStatus } from '../lib/shape.js';

/**
 * Shape of the /api/versions/:id/provenance JSON response (Plan 08's
 * getProvenance returns `unknown`; we narrow to the documented shape here).
 * `events` is the chronological ProvenanceEvent array; each element is an
 * opaque record the dashboard renders verbatim via JsonBlock.
 */
interface ProvenanceResponse {
  events: Array<Record<string, unknown>>;
  breadcrumb?: unknown;
}

interface DiffSummaryShape {
  summary: string;
  changes?: unknown;
}

export interface VersionDrawerProps {
  version: Version;
  /** The "prior" version on the same shot by version_number, if any. */
  priorVersion: Version | null;
  onClose: () => void;
}

export function VersionDrawer({ version, priorVersion, onClose }: VersionDrawerProps) {
  const [provenance, setProvenance] = useState<Array<Record<string, unknown>>>([]);
  const [diff, setDiff] = useState<DiffSummaryShape | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => {
    // Lazy-load provenance on version change. Swallow errors into empty list
    // so a 404 on a version reaped between click and fetch does not crash the
    // drawer — user sees the empty state copy instead.
    let alive = true;
    getProvenance(version.id)
      .then((res) => {
        if (!alive) return;
        const shaped = res as ProvenanceResponse;
        setProvenance(Array.isArray(shaped?.events) ? shaped.events : []);
      })
      .catch(() => {
        if (alive) setProvenance([]);
      });
    return () => {
      alive = false;
    };
  }, [version.id]);

  async function handleViewDiff() {
    if (!priorVersion) {
      // Nothing to diff against — still open the drawer so the user sees the
      // "No prior version" empty state rather than a silent click.
      setShowDiff(true);
      return;
    }
    if (!diff) {
      try {
        const d = (await diffVersion(priorVersion.id, version.id)) as DiffSummaryShape;
        setDiff(d);
      } catch {
        // keep diff=null; DiffDrawer will just render the two cards.
      }
    }
    setShowDiff(true);
  }

  const label = versionLabel(version);
  const status: Status = normalizeStatus(version.status);
  const completedAt = (version as Version & { completed_at?: number | string | null })
    .completed_at;

  return (
    <>
      <aside
        class="fixed inset-y-0 right-0 z-10 flex flex-col gap-4 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-bg)] p-4 shadow-xl"
        style={{ width: 'var(--drawer-version-width)' }}
        role="dialog"
        aria-label={`Version ${label}`}
      >
        <header class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <h2
              class="version-label text-base font-semibold text-[var(--color-fg)]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {label}
            </h2>
            <StatusPill status={status} />
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              onClick={handleViewDiff}
              class="rounded bg-[var(--color-accent)] px-2 py-1 text-xs font-normal text-[var(--color-bg)] transition-colors hover:opacity-90"
            >
              View Diff
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              class="inline-flex items-center justify-center rounded p-1 text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
            >
              ×
            </button>
          </div>
        </header>

        {status === 'complete' ? (
          <section>
            <h3 class="label-uppercase mb-2 text-[var(--color-fg-muted)]">Output</h3>
            <a
              href={getOutputUrl(version.id)}
              target="_blank"
              rel="noopener noreferrer"
              class="block overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-surface)]"
            >
              <img
                src={getOutputUrl(version.id)}
                alt={`Output for ${label}`}
                class="block h-auto w-full"
                loading="lazy"
              />
            </a>
          </section>
        ) : null}

        <section>
          <h3 class="label-uppercase mb-2 text-[var(--color-fg-muted)]">Timeline</h3>
          <ul class="flex flex-col gap-1 rounded bg-[var(--color-surface)] p-3 text-sm text-[var(--color-fg)]">
            {version.created_at ? (
              <li class="flex justify-between gap-2">
                <span class="text-[var(--color-fg-muted)]">Created</span>
                <span class="timestamp">{formatTimestamp(version.created_at)}</span>
              </li>
            ) : null}
            {completedAt ? (
              <li class="flex justify-between gap-2">
                <span class="text-[var(--color-fg-muted)]">Completed</span>
                <span class="timestamp">{formatTimestamp(completedAt)}</span>
              </li>
            ) : null}
            {!version.created_at ? (
              <li class="text-[var(--color-fg-muted)]">No timeline yet</li>
            ) : null}
          </ul>
        </section>

        <section>
          <h3 class="label-uppercase mb-2 text-[var(--color-fg-muted)]">Provenance</h3>
          {provenance.length === 0 ? (
            <EmptyState message="No provenance records" />
          ) : (
            <ul class="flex flex-col gap-2">
              {provenance.map((record, i) => (
                <li key={i}>
                  <JsonBlock data={record} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>

      {showDiff && (
        <DiffDrawer
          before={
            priorVersion
              ? {
                  id: priorVersion.id,
                  label: versionLabel(priorVersion),
                  status: normalizeStatus(priorVersion.status),
                }
              : null
          }
          after={{ id: version.id, label, status }}
          diff={diff}
          onClose={() => setShowDiff(false)}
        />
      )}
    </>
  );
}

/** Render an epoch-ms or ISO-string timestamp as ISO-8601 (UTC). */
function formatTimestamp(ts: number | string): string {
  try {
    const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    return d.toISOString();
  } catch {
    return String(ts);
  }
}
