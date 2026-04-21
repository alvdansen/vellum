import { expect } from 'vitest';
import type { ErrorCode } from '../engine/errors.js';

expect.extend({
  toThrowTypedError(received: () => unknown, code: ErrorCode) {
    try {
      received();
    } catch (err: any) {
      if (err?.name !== 'TypedError') {
        return {
          pass: false,
          message: () => `expected TypedError, got ${err?.name}: ${err?.message}`,
        };
      }
      if (err.code !== code) {
        return {
          pass: false,
          message: () => `expected code ${code}, got ${err.code}`,
        };
      }
      return { pass: true, message: () => 'ok' };
    }
    return {
      pass: false,
      message: () => `expected function to throw TypedError(${code}) but it did not throw`,
    };
  },
});

// Type augmentation — vitest's Assertion interface gets our custom matcher
declare module 'vitest' {
  interface Assertion<T = any> {
    toThrowTypedError(code: ErrorCode): T;
  }
  interface AsymmetricMatchersContaining {
    toThrowTypedError(code: ErrorCode): unknown;
  }
}
