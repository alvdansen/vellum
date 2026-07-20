/**
 * ThemeToggle — dark/light switcher in the sidebar header.
 *
 * This component is self-contained per UI-SPEC.md D-WEBUI-16:
 *   - Reads `[data-theme]` from <html> on mount
 *   - Toggles between 'dark' and 'light'
 *   - Persists to localStorage['vellum:theme']
 *   - No props, no callbacks (it owns its own local state)
 *
 * This component is the one exception to the "no side effects" rule for
 * primitives — local-DOM theme management is the component's entire purpose,
 * not a data-fetch or signal-subscription side effect.
 *
 * The SPA shell (index.html) applies the persisted theme BEFORE any render
 * runs (FOUC prevention, D-WEBUI-16). This component just handles the
 * subsequent click-to-toggle interaction.
 *
 * SECURITY — T-5-06: localStorage value is only written to `data-theme`
 * attribute on document.documentElement, never rendered as HTML. Low risk
 * per plan threat register.
 */

import { useState, useEffect } from 'preact/hooks';
import { Sun, Moon } from 'lucide-preact';

const STORAGE_KEY = 'vellum:theme';
const DEFAULT_THEME: Theme = 'dark';

type Theme = 'dark' | 'light';

function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  if (typeof localStorage === 'undefined') return DEFAULT_THEME;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  return DEFAULT_THEME;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  // Sync once on mount — ensures data-theme attribute matches our state even if
  // the SPA shell script was skipped (e.g. in test environments).
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage may be blocked in some privacy modes. Non-fatal.
    }
  }

  // Show moon in light mode (click to go dark), sun in dark mode (click to go light).
  const Icon = theme === 'dark' ? Sun : Moon;
  const nextLabel = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${nextLabel} theme`}
      class="inline-flex items-center justify-center rounded p-1.5 text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
    >
      <Icon size={16} />
    </button>
  );
}
