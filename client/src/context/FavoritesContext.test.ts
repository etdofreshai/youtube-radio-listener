import { describe, it } from 'node:test';
import assert from 'node:assert';

// Unit tests for FavoriteButton/Context logic — no React rendering needed.

const VALID_TYPES = ['track', 'artist', 'album', 'radio_station', 'playlist'] as const;
type FavoriteType = (typeof VALID_TYPES)[number];

/** Replicate the cache key logic from FavoritesContext */
function cacheKey(type: FavoriteType, entityId: string): string {
  return `${type}:${entityId}`;
}

describe('FavoritesContext cache key', () => {
  it('generates unique keys for different types + same entity', () => {
    const keys = VALID_TYPES.map(t => cacheKey(t, 'entity-1'));
    const unique = new Set(keys);
    assert.strictEqual(unique.size, keys.length, 'Cache keys should be unique per type');
  });

  it('generates unique keys for same type + different entities', () => {
    const key1 = cacheKey('track', 'aaa');
    const key2 = cacheKey('track', 'bbb');
    assert.notStrictEqual(key1, key2);
  });

  it('generates matching keys for same type + entity (idempotent)', () => {
    const key1 = cacheKey('artist', 'xyz');
    const key2 = cacheKey('artist', 'xyz');
    assert.strictEqual(key1, key2);
  });
});

describe('FavoriteType validation', () => {
  it('should accept all valid types', () => {
    for (const t of VALID_TYPES) {
      assert.ok(VALID_TYPES.includes(t));
    }
  });

  it('should have exactly 5 types', () => {
    assert.strictEqual(VALID_TYPES.length, 5);
  });
});

describe('Optimistic update simulation', () => {
  it('should correctly toggle favorites in a Set', () => {
    const favSet = new Set<string>();

    // Add
    const key = cacheKey('track', 'track-1');
    assert.strictEqual(favSet.has(key), false);

    favSet.add(key);
    assert.strictEqual(favSet.has(key), true);

    // Remove
    favSet.delete(key);
    assert.strictEqual(favSet.has(key), false);
  });

  it('should handle multiple entity types simultaneously', () => {
    const favSet = new Set<string>();

    favSet.add(cacheKey('track', 't1'));
    favSet.add(cacheKey('artist', 'a1'));
    favSet.add(cacheKey('album', 'al1'));
    favSet.add(cacheKey('radio_station', 'r1'));
    favSet.add(cacheKey('playlist', 'p1'));

    assert.strictEqual(favSet.size, 5);
    assert.strictEqual(favSet.has(cacheKey('track', 't1')), true);
    assert.strictEqual(favSet.has(cacheKey('track', 't2')), false);
    assert.strictEqual(favSet.has(cacheKey('playlist', 'p1')), true);
  });
});
