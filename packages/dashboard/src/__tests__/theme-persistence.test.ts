// packages/dashboard/src/__tests__/theme-persistence.test.ts
//
// Cross-cutting integration test for ThemeToggle persistence (Plan 05-11, Task 1).
// Verifies the theme → localStorage → DOM attribute chain:
//   - Default data-theme is 'dark' when no saved value exists
//   - Persisted 'light' value in localStorage is re-applied on init
//   - Clicking the toggle switches data-theme (dark → light → dark)
//   - Clicking the toggle writes the new value to localStorage
//
// Environment: jsdom (vitest.config.ts) + per-test localStorage polyfill. Node
// 25+ ships an experimental native `localStorage` global that takes precedence
// over jsdom's implementation and is a no-op without `--localstorage-file`.
// We stub a minimal in-memory polyfill before the module under test is imported
// so the component's `localStorage.setItem` / `localStorage.getItem` calls behave
// as they would in the browser. Scoped to this file via vi.stubGlobal; the
// vitest setup file's afterEach(cleanup) handles DOM teardown.
//
// Architecture-purity invariant (D-WEBUI-31): this file performs zero
// server-tree relative-import traversals. Imports only from the dashboard tree.
//
// Note on `.ts` extension: the plan's must_haves locks this artifact at
// `theme-persistence.test.ts` (not `.tsx`). vite/oxc only applies the JSX
// transform to `.tsx`, so this file calls Preact's `h()` factory directly
// rather than using JSX syntax. Behavior is identical.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { h } from 'preact';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';

/** In-memory localStorage polyfill matching the Web Storage API surface the
 *  component uses (setItem / getItem / clear / removeItem). Replaces the
 *  Node-native no-op global that shadows jsdom's implementation. */
function makeMemoryStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    clear() {
      store = {};
    },
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    key(index: number): string | null {
      return Object.keys(store)[index] ?? null;
    },
    removeItem(key: string): void {
      delete store[key];
    },
    setItem(key: string, value: string): void {
      store[key] = String(value);
    },
  };
}

// Install the polyfill BEFORE importing ThemeToggle so the module-level
// `readInitialTheme()` closure (if any) binds to the real implementation.
vi.stubGlobal('localStorage', makeMemoryStorage());

// Now safe to import the module under test.
// eslint-disable-next-line import/first
import { ThemeToggle } from '../components/ThemeToggle.js';

const STORAGE_KEY = 'vellum:theme';

describe('ThemeToggle persistence', () => {
  beforeEach(() => {
    // Reset persistence surface between tests so each assertion observes a
    // clean starting state: no saved value, no attribute.
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('sets data-theme="dark" on initial render when no localStorage value', async () => {
    render(h(ThemeToggle, null));
    // useEffect runs after the render pass flushes. Wait for the DOM mutation.
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
  });

  it('restores saved theme from localStorage on init', async () => {
    localStorage.setItem(STORAGE_KEY, 'light');
    render(h(ThemeToggle, null));
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
  });

  it('clicking toggle switches data-theme from dark to light', async () => {
    render(h(ThemeToggle, null));
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
    const button = screen.getByRole('button');
    fireEvent.click(button);
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
  });

  it('clicking toggle writes to localStorage', async () => {
    render(h(ThemeToggle, null));
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
  });

  it('clicking toggle twice returns to original dark theme', async () => {
    render(h(ThemeToggle, null));
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
    const button = screen.getByRole('button');
    fireEvent.click(button);
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
    fireEvent.click(button);
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
  });
});
