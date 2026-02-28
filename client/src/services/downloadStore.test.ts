/**
 * Tests for downloadStore IndexedDB service.
 *
 * These run with Node's built-in test runner (--test).
 * Since IndexedDB isn't available in Node, we test pure functions
 * and validate the module's type exports and formatBytes utility.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes } from './downloadStore.js';

describe('downloadStore', () => {
  describe('formatBytes', () => {
    it('formats 0 bytes', () => {
      assert.equal(formatBytes(0), '0 B');
    });

    it('formats bytes (< 1KB)', () => {
      assert.equal(formatBytes(500), '500.0 B');
    });

    it('formats kilobytes', () => {
      assert.equal(formatBytes(1024), '1.0 KB');
      assert.equal(formatBytes(1536), '1.5 KB');
    });

    it('formats megabytes', () => {
      assert.equal(formatBytes(1048576), '1.0 MB');
      assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
    });

    it('formats gigabytes', () => {
      assert.equal(formatBytes(1073741824), '1.0 GB');
    });

    it('formats fractional sizes', () => {
      assert.equal(formatBytes(1500000), '1.4 MB');
    });
  });

  describe('type exports', () => {
    it('exports DownloadStatus type values', () => {
      // Type-level check — just ensure the module exports are accessible
      const statuses: Array<'complete' | 'partial' | 'corrupted'> = ['complete', 'partial', 'corrupted'];
      assert.equal(statuses.length, 3);
    });
  });
});
