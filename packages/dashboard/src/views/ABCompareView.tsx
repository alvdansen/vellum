/**
 * Phase 22 / Plan 22-06 — ABCompareView.
 *
 * Full-viewport modal for side-by-side version comparison (D-15, REV-03).
 * Two thumbnails preload in PARALLEL via Promise.all([img.decode(),
 * img.decode()]) — both resolve at the same time so the panel doesn't
 * flash one thumbnail before the other (D-17). Below the thumbnails,
 * MetadataDiff renders the diffVersionsAB response (summary + structured
 * changes from 22-03).
 *
 * Pitfall 7 mitigation: `.decode()` is the primary preload path, but very
 * old browsers / certain test environments don't support it (the spec was
 * Chrome-first). `preloadOne` falls back to a bare `.onload + .onerror`
 * Promise chain — wires BOTH so a 404 rejects instead of spinning forever.
 *
 * Close paths (3 — D-15):
 *  - ESC keydown on document
 *  - Backdrop click (e.target === e.currentTarget)
 *  - Explicit close button
 *
 * z-30 backdrop + modal body — RESEARCH Q4 ladder. The right-rail
 * review/version drawer (z-10) and DiffDrawer (z-20) stay BENEATH this.
 *
 * Architecture-purity (D-WEBUI-31): only sibling dashboard imports.
 */

import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { X } from 'lucide-preact';
import { getThumbnailUrl, diffVersionsAB } from '../lib/api.js';
import { Thumbnail } from '../components/Thumbnail.js';
import { SkeletonThumbnail } from '../components/SkeletonThumbnail.js';
import { MetadataDiff } from '../components/MetadataDiff.js';
import type { DiffChanges } from '../components/MetadataDiff.js';
import {
  COMPARE_MODAL_TITLE_PREFIX,
  COMPARE_MODAL_TITLE_INFIX,
  COMPARE_MODAL_ARIA_LABEL_PREFIX,
  COMPARE_MODAL_CLOSE_ARIA,
  COMPARE_MODAL_SECTION_THUMBNAILS,
  COMPARE_MODAL_DIFF_LOADING,
  COMPARE_MODAL_DIFF_ERROR,
  COMPARE_MODAL_THUMB_LOAD_FAIL,
} from '../lib/copy.js';

export interface ABCompareViewProps {
  shotName: string;
  versionA: { id: string; version_number: number };
  versionB: { id: string; version_number: number };
  onClose: () => void;
}

function preloadOne(url: string): Promise<void> {
  const img = new Image();
  img.src = url;
  // .decode() is the modern preload path — resolves only when the image is
  // paint-ready. Fall back to a bare onload/onerror Promise when .decode is
  // unavailable or rejects (Pitfall 7 — old browsers / certain test envs).
  return img.decode().catch(
    () =>
      new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (e) => reject(e);
      }),
  );
}

function preloadBoth(a: string, b: string): Promise<void> {
  return Promise.all([
    preloadOne(getThumbnailUrl(a)),
    preloadOne(getThumbnailUrl(b)),
  ]).then(() => undefined);
}

type PreloadState = 'loading' | 'ready' | 'error';
type DiffState = {
  data: { summary: string; changes?: DiffChanges } | null;
  error: string | null;
};

export function ABCompareView({
  shotName,
  versionA,
  versionB,
  onClose,
}: ABCompareViewProps): JSX.Element {
  const [preloadState, setPreloadState] = useState<PreloadState>('loading');
  const [diff, setDiff] = useState<DiffState>({ data: null, error: null });
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // Preload effect
  useEffect(() => {
    let alive = true;
    setPreloadState('loading');
    preloadBoth(versionA.id, versionB.id)
      .then(() => {
        if (alive) setPreloadState('ready');
      })
      .catch(() => {
        if (alive) setPreloadState('error');
      });
    return () => {
      alive = false;
    };
  }, [versionA.id, versionB.id]);

  // Diff fetch effect (independent of preload — runs in parallel)
  useEffect(() => {
    let alive = true;
    setDiff({ data: null, error: null });
    diffVersionsAB(versionA.id, versionB.id)
      .then((raw) => {
        if (!alive) return;
        const data = raw as { summary: string; changes?: DiffChanges };
        setDiff({ data, error: null });
      })
      .catch(() => {
        if (!alive) return;
        setDiff({ data: null, error: COMPARE_MODAL_DIFF_ERROR });
      });
    return () => {
      alive = false;
    };
  }, [versionA.id, versionB.id]);

  // Focus + ESC handler
  useEffect(() => {
    closeBtnRef.current?.focus();
    function onDocKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onDocKeyDown);
    return () => document.removeEventListener('keydown', onDocKeyDown);
  }, [onClose]);

  const titleText = `${COMPARE_MODAL_TITLE_PREFIX}${shotName}: v${versionA.version_number}${COMPARE_MODAL_TITLE_INFIX}v${versionB.version_number}`;

  return (
    <div
      class="fixed inset-0 z-30 flex items-center justify-center bg-black/60 motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out"
      data-testid="ab-compare-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={`${COMPARE_MODAL_ARIA_LABEL_PREFIX}${titleText}`}
        class="relative flex flex-col gap-6 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-4 shadow-2xl"
        style={{
          width: 'min(1200px, calc(100vw - 96px))',
          maxHeight: 'calc(100vh - 96px)',
          overflowY: 'auto',
        }}
      >
        <header class="flex items-center justify-between">
          <h2
            id={titleId}
            class="text-base font-semibold text-[var(--color-fg)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {titleText}
          </h2>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label={COMPARE_MODAL_CLOSE_ARIA}
            class="inline-flex items-center justify-center rounded p-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)] motion-safe:transition-colors"
          >
            <X size={16} />
          </button>
        </header>

        <section>
          <h3 class="label-uppercase mb-2 text-[var(--color-fg-muted)]">
            {COMPARE_MODAL_SECTION_THUMBNAILS}
          </h3>
          {preloadState === 'error' ? (
            <p class="text-sm text-[var(--color-fg-muted)]">
              {COMPARE_MODAL_THUMB_LOAD_FAIL}
            </p>
          ) : (
            <div class="grid grid-cols-2 gap-4">
              <div>
                <h4 class="label-uppercase mb-2 text-[var(--color-fg-muted)]">
                  v{versionA.version_number}
                </h4>
                {preloadState === 'ready' ? (
                  <Thumbnail
                    version={{
                      id: versionA.id,
                      label: `v${versionA.version_number}`,
                      status: 'complete',
                    }}
                    size="card"
                  />
                ) : (
                  <SkeletonThumbnail width={640} height={360} />
                )}
              </div>
              <div>
                <h4 class="label-uppercase mb-2 text-[var(--color-fg-muted)]">
                  v{versionB.version_number}
                </h4>
                {preloadState === 'ready' ? (
                  <Thumbnail
                    version={{
                      id: versionB.id,
                      label: `v${versionB.version_number}`,
                      status: 'complete',
                    }}
                    size="card"
                  />
                ) : (
                  <SkeletonThumbnail width={640} height={360} />
                )}
              </div>
            </div>
          )}
        </section>

        {diff.error ? (
          <p class="text-sm text-[var(--color-fg-muted)]">{diff.error}</p>
        ) : diff.data === null ? (
          <p class="text-sm text-[var(--color-fg-muted)]">
            {COMPARE_MODAL_DIFF_LOADING}
          </p>
        ) : (
          <MetadataDiff
            summary={diff.data.summary}
            changes={diff.data.changes}
          />
        )}
      </div>
    </div>
  );
}
