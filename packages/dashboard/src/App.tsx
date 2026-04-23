/**
 * App — root component. Owns:
 *   - Top-level layout (header with brand + ThemeToggle; flexible body)
 *   - SSE lifecycle (startSse on mount, stopSse on unmount per D-WEBUI-03)
 *   - SSE → signals bridge:
 *       onSseEvent('version.created', onVersionCreated)
 *       onSseEvent('version.status_changed', onVersionStatusChanged)
 *   - View routing (single-view for now — HomeView; right panel is the
 *     ActiveGenerationsPanel fixture)
 *
 * Pure glue — no fetch (views own their own hydration), no mutation other
 * than signal updates via the SSE bridge.
 *
 * SECURITY — T-5-06: brand text is a literal; no dynamic HTML rendering here.
 */

import { useEffect } from 'preact/hooks';
import { HomeView } from './views/HomeView.js';
import { ActiveGenerationsPanel } from './views/ActiveGenerationsPanel.js';
import { ThemeToggle } from './components/ThemeToggle.js';
import { startSse, stopSse, onSseEvent, offSseEvent } from './lib/events.js';
import {
  onVersionCreated,
  onVersionStatusChanged,
} from './state/active-generations.js';

export function App() {
  useEffect(() => {
    onSseEvent('version.created', onVersionCreated);
    onSseEvent('version.status_changed', onVersionStatusChanged);
    startSse();
    return () => {
      offSseEvent('version.created', onVersionCreated);
      offSseEvent('version.status_changed', onVersionStatusChanged);
      stopSse();
    };
  }, []);

  return (
    <div class="flex h-screen flex-col bg-[var(--color-bg)] text-[var(--color-fg)]">
      <header class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <span
          class="text-sm font-semibold text-[var(--color-accent)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          VFX Familiar
        </span>
        <ThemeToggle />
      </header>
      <div class="flex flex-1 overflow-hidden">
        <div class="flex-1 overflow-hidden">
          <HomeView />
        </div>
        <ActiveGenerationsPanel />
      </div>
    </div>
  );
}
