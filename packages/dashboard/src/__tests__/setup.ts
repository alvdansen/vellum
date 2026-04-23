// Vitest setup for the @vfx-familiar/dashboard workspace.
// Loads jest-dom matchers (toBeInTheDocument, toHaveClass, etc.) so component
// tests can use idiomatic assertions. Runs after the jsdom environment is up.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/preact';

// Auto-cleanup mounted components after each test to avoid cross-test leaks.
afterEach(() => {
  cleanup();
});
