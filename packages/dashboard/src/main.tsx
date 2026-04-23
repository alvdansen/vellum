/**
 * main.tsx — Vite entry. Mounts <App /> into #app.
 *
 * Theme bootstrap: the SPA shell (index.html) already applies the persisted
 * theme BEFORE any render runs (FOUC prevention, D-WEBUI-16). This file only
 * guards against the attribute being missing (e.g. in a minimal test harness
 * or if the inline script was stripped) by reading localStorage and falling
 * back to the 'dark' default per must-have contract.
 */

import { render } from 'preact';
import { App } from './App.js';
import './styles/theme.css';

// Ensure data-theme is set before first render so theme.css CSS variables
// resolve to the correct dark/light values.
if (typeof document !== 'undefined') {
  const current = document.documentElement.getAttribute('data-theme');
  if (current !== 'dark' && current !== 'light') {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('vfx-familiar:theme');
    } catch {
      // localStorage may be unavailable in some privacy modes — fall through.
    }
    const theme = saved === 'light' || saved === 'dark' ? saved : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  }
}

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}
