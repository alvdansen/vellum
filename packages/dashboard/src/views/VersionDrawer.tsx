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

import { useState, useEffect, useRef } from 'preact/hooks';
import { StatusPill } from '../components/StatusPill.js';
import type { Status } from '../components/StatusPill.js';
import { WarningPill } from '../components/WarningPill.js';
import { C2paBadge } from '../components/C2paBadge.js';
import { JsonBlock } from '../components/JsonBlock.js';
import { EmptyState } from '../components/EmptyState.js';
import { SummarySection } from '../components/SummarySection.js';
import { DiffDrawer } from './DiffDrawer.js';
import {
  getProvenance,
  diffVersion,
  getOutputUrl,
  getC2paStatus,
} from '../lib/api.js';
import type { C2paStatus } from '../lib/api.js';
import {
  summarySignal,
  fetchSummary,
  type SummaryState,
} from '../state/summaries.js';
import {
  PROVENANCE_HEADING,
  SUMMARY_DISCLOSURE_TOGGLE,
  SUMMARY_FIRST_USE_LOCALSTORAGE_KEY,
} from '../lib/copy.js';
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

/**
 * Phase 12 — DEMO-03 (D-CTX-4) divergence shape carried on the diff response
 * envelope when version B is reproduce-lineage. `null` means either "not a
 * reproduce-lineage diff" or "bytes match AND no warnings" — the dashboard
 * renders nothing in that case (criterion #4).
 *
 * The shape is duplicated here verbatim from the engine layer's
 * src/types/provenance.ts::ReproductionDivergence per D-WEBUI-31 (no
 * server-tree imports under packages/dashboard/src/**).
 */
interface ReproductionDivergence {
  sha256_mismatch: { parent: string; reproduction: string } | null;
  warnings: string[];
  parent_output_present: boolean;
  reproduction_output_present: boolean;
}

interface DiffSummaryShape {
  summary: string;
  changes?: unknown;
  reproduction_divergence?: ReproductionDivergence | null;
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
  // Phase 14 Plan 04 Task 2 — C2PA signing status for the version's primary
  // output. Default { status: 'unknown' } so the badge renders 'C2PA: pending'
  // immediately on mount and updates once the HEAD response lands. Network
  // errors leave it at 'unknown' (getC2paStatus never throws — defence in
  // depth).
  const [c2paStatus, setC2paStatus] = useState<C2paStatus>({ status: 'unknown' });

  // Phase 19 / Plan 19-06 — per-version AI conversational summary state +
  // auto-fetch on version.id change + 500ms client-side debounce on
  // Regenerate. Mirrors the C2PA status auto-fetch pattern at lines 119-133
  // verbatim (let alive = true cancellation guard).
  const [summary, setSummary] = useState<SummaryState>({ state: 'loading' });

  // D-PRIV-2 — first-use disclosure gate. Reads localStorage at mount; the
  // muted "AI summary uses your prompt text" note renders ABOVE the body
  // until the user clicks Regenerate (auto-acks the disclosure) or until
  // localStorage explicitly carries the ack key. SSR / privacy-mode browsers
  // (where localStorage throws) degrade to "no first-use note" via the
  // try/catch — acceptable per UI-SPEC researcher discretion.
  const [showFirstUseDisclosure, setShowFirstUseDisclosure] = useState<boolean>(
    () => {
      try {
        return (
          typeof localStorage !== 'undefined' &&
          localStorage.getItem(SUMMARY_FIRST_USE_LOCALSTORAGE_KEY) !== 'true'
        );
      } catch {
        return false;
      }
    },
  );

  // 500ms client-side debounce for Regenerate (SUM-04 + D-FB-4). Captured as
  // a ref so successive clicks are compared against the most-recent click
  // timestamp without re-rendering the drawer.
  const lastRegenerateClickRef = useRef<number>(0);

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

  // Phase 14 Plan 04 Task 2 — auto-fetch C2PA signing status via HEAD on the
  // output route. The HEAD is lightweight (no body); the route reads the
  // latest manifest_signed event written by Plan 14-03's downloader hook.
  // getC2paStatus never throws (defence in depth) — it collapses network /
  // parse failures to { status: 'unknown' }, so the badge always renders.
  useEffect(() => {
    let alive = true;
    getC2paStatus(version.id)
      .then((s) => {
        if (alive) setC2paStatus(s);
      })
      .catch(() => {
        // getC2paStatus is documented as never-throwing, but defence in depth
        // — leave c2paStatus at its current value.
        if (alive) setC2paStatus({ status: 'unknown' });
      });
    return () => {
      alive = false;
    };
  }, [version.id]);

  // Phase 19 / Plan 19-06 — auto-fetch the AI summary on version.id change.
  // Mirrors the C2PA effect above (lines 159-173) verbatim — same `let alive
  // = true` cancellation guard, same defensive `.catch` collapsing to a
  // local error state. Mirrors the global summarySignal so cross-component
  // reads see the same value. fetchSummary is contract-bound to never throw
  // (lib/api collapses errors to { state: 'error' } envelopes), but the
  // .catch is defence-in-depth.
  useEffect(() => {
    let alive = true;
    setSummary({ state: 'loading' });
    fetchSummary(version.id)
      .then((s) => {
        if (alive) {
          setSummary(s);
          summarySignal.value = new Map(summarySignal.value).set(version.id, s);
        }
      })
      .catch(() => {
        if (alive) setSummary({ state: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [version.id]);

  async function handleRegenerate(): Promise<void> {
    // 500ms client-side debounce — captures the most-recent click timestamp;
    // ignores clicks that fire faster than the debounce window. Pairs with
    // the 60s server-side throttle (Plan 19-05) to form the 2-line defence
    // against thrash (T-19-35 mitigation).
    const now = Date.now();
    if (now - lastRegenerateClickRef.current < 500) return;
    lastRegenerateClickRef.current = now;

    // D-PRIV-2 — auto-ack the first-use disclosure on the first Regenerate
    // click. localStorage may throw in privacy-mode browsers; the try/catch
    // degrades the ack to in-memory only (acceptable per UI-SPEC researcher
    // discretion).
    if (showFirstUseDisclosure) {
      try {
        localStorage.setItem(SUMMARY_FIRST_USE_LOCALSTORAGE_KEY, 'true');
      } catch {
        /* defensive — privacy-mode or SSR */
      }
      setShowFirstUseDisclosure(false);
    }

    // Optimistic UI flip — show the loading skeleton while the live LLM call
    // is in flight. The Regenerate button shows 'Regenerating…' via
    // SummarySection's isLoading branch.
    setSummary({ state: 'loading' });
    try {
      const fresh = await fetchSummary(version.id, { regenerate: true });
      setSummary(fresh);
      summarySignal.value = new Map(summarySignal.value).set(version.id, fresh);
    } catch {
      setSummary({ state: 'error' });
    }
  }

  // Read regenerateAvailableAtMs from the current summary state. Only present
  // on success/fallback variants — error/loading state defaults to undefined,
  // which leaves the RegenerateButton enabled (no cooldown).
  const regenerateAvailableAtMs =
    summary.state === 'success' || summary.state === 'fallback'
      ? summary.regenerateAvailableAtMs
      : null;

  // Phase 12 — DEMO-03 (D-CTX-2). Auto-fetch diff when this version is
  // reproduce-lineage AND a priorVersion exists, so the WarningPill and
  // side-by-side comparison block can render on drawer mount without the user
  // having to click "View Diff". Reuses the same `diff` state slot as the
  // "View Diff" button, so a subsequent click does not refetch (T-12-10
  // mitigation: `diff !== null` early-return guarantees a single fetch per
  // drawer-open). Network failures leave diff=null — pill and block do not
  // render, which is the same UX as the bit-identical happy path.
  useEffect(() => {
    if (version.lineage_type !== 'reproduce') return;
    if (!priorVersion) return;
    if (diff !== null) return;
    let alive = true;
    diffVersion(priorVersion.id, version.id)
      .then((d) => {
        if (!alive) return;
        setDiff(d as DiffSummaryShape);
      })
      .catch(() => {
        // Graceful degradation: leave diff=null; no pill, no block.
      });
    return () => {
      alive = false;
    };
    // `diff` intentionally NOT in the deps array — including it would retrigger
    // the effect on every successful fetch. The `if (diff !== null) return`
    // guard inside the body handles the re-render-with-already-loaded case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version.id, priorVersion?.id, version.lineage_type]);

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
            {/* Phase 12 — DEMO-03. Pill renders iff the engine attached a
                non-null reproduction_divergence on the diff response. Hardcoded
                ariaLabel — no user-controlled data flows here (T-12-11). */}
            {diff?.reproduction_divergence != null && (
              <WarningPill
                label="non-deterministic"
                ariaLabel="non-deterministic — outputs may differ from parent"
              />
            )}
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

        {/* Phase 19 / Plan 19-06 — AI conversational summary section.
            Renders FIRST in the drawer body (above Output) per UI-SPEC visual
            hierarchy. Children are the relocated SUM-07 Provenance disclosure
            (the standalone Provenance <section> from Phase 5 is now wrapped in
            a <details> here for the SUM-07 collapsed-by-default contract). */}
        <SummarySection
          summary={summary}
          regenerateAvailableAtMs={regenerateAvailableAtMs}
          showFirstUseDisclosure={showFirstUseDisclosure}
          onRegenerate={handleRegenerate}
          versionLabel={label}
        >
          <h3 class="label-uppercase mb-2 mt-4 text-[var(--color-fg-muted)]">
            {PROVENANCE_HEADING}
          </h3>
          <details data-testid="provenance-disclosure">
            <summary class="cursor-pointer text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
              {SUMMARY_DISCLOSURE_TOGGLE}
            </summary>
            {provenance.length === 0 ? (
              <div class="mt-2">
                <EmptyState message="No provenance records" />
              </div>
            ) : (
              <ul class="mt-2 flex flex-col gap-2">
                {provenance.map((record, i) => (
                  <li key={i}>
                    <JsonBlock data={record} />
                  </li>
                ))}
              </ul>
            )}
          </details>
        </SummarySection>

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
            {/* Phase 14 Plan 04 Task 2 — C2PA signing badge. Reads status via
                HEAD on the output route (X-C2PA-Signing-Status header) so no
                additional bytes are transferred. v1.1 has NO sidecar download
                link (Concern #2 scope reduction); v1.2 will add one when
                c2pa-node exposes a real sidecar API. */}
            <div class="mt-2 flex items-center gap-2">
              <C2paBadge status={c2paStatus} />
            </div>
          </section>
        ) : null}

        {/* Phase 12 — DEMO-03. Side-by-side parent vs reproduction comparison.
            Renders iff the engine reports both outputs are present on disk
            (parent_output_present && reproduction_output_present). Per
            criterion #4, when bytes match AND no warnings the engine sends
            reproduction_divergence: null and this block does not render.
            T-12-08 disposition: <img> srcs reuse the existing
            /api/versions/:id/output route (same auth posture as the single-
            output render above). */}
        {diff?.reproduction_divergence?.parent_output_present &&
        diff?.reproduction_divergence?.reproduction_output_present &&
        priorVersion ? (
          <section data-testid="reproduction-comparison">
            <h3 class="label-uppercase mb-2 text-[var(--color-fg-muted)]">
              Parent vs Reproduction
            </h3>
            <div class="grid grid-cols-2 gap-3">
              <figure>
                <img
                  src={getOutputUrl(priorVersion.id)}
                  alt={`Parent output (${versionLabel(priorVersion)})`}
                  class="block h-auto w-full rounded border border-[var(--color-border)]"
                  loading="lazy"
                />
                <figcaption class="mt-1 text-xs text-[var(--color-fg-muted)]">
                  Parent ({versionLabel(priorVersion)})
                </figcaption>
              </figure>
              <figure>
                <img
                  src={getOutputUrl(version.id)}
                  alt={`Reproduction output (${label})`}
                  class="block h-auto w-full rounded border border-[var(--color-border)]"
                  loading="lazy"
                />
                <figcaption class="mt-1 text-xs text-[var(--color-fg-muted)]">
                  Reproduction ({label})
                </figcaption>
              </figure>
            </div>
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

        {/* Phase 19 / Plan 19-06 (SUM-07): the standalone Provenance section
            previously rendered here is now relocated INSIDE <SummarySection>'s
            children slot above as a <details>/<summary> disclosure. */}
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
