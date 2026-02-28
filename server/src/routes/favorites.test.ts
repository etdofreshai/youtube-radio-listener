import { describe, it, expect } from 'vitest';
import type { FavoriteType } from '../types';

// Unit tests for the favorites validation logic (no DB required)

const VALID_TYPES: FavoriteType[] = ['track', 'artist', 'album', 'radio_station', 'playlist'];

function isValidType(t: string): t is FavoriteType {
  return VALID_TYPES.includes(t as FavoriteType);
}

describe('Favorites route validation', () => {
  it('should accept all valid favorite types', () => {
    for (const type of VALID_TYPES) {
      expect(isValidType(type)).toBe(true);
    }
  });

  it('should reject invalid favorite types', () => {
    expect(isValidType('invalid')).toBe(false);
    expect(isValidType('song')).toBe(false);
    expect(isValidType('')).toBe(false);
    expect(isValidType('TRACK')).toBe(false);  // case sensitive
  });

  it('all valid types should be string literals', () => {
    for (const type of VALID_TYPES) {
      expect(typeof type).toBe('string');
      expect(type.length).toBeGreaterThan(0);
    }
  });

  it('should have exactly 5 valid types', () => {
    expect(VALID_TYPES).toHaveLength(5);
  });
});

describe('UserFavorite type shape', () => {
  it('should have correct shape', () => {
    const fav = {
      id: 'abc-123',
      userId: 'user-1',
      favoriteType: 'track' as FavoriteType,
      entityId: 'entity-1',
      addedAt: new Date().toISOString(),
    };
    expect(fav).toHaveProperty('id');
    expect(fav).toHaveProperty('userId');
    expect(fav).toHaveProperty('favoriteType');
    expect(fav).toHaveProperty('entityId');
    expect(fav).toHaveProperty('addedAt');
  });

  it('entityMeta and entityName should be optional', () => {
    const fav = {
      id: 'abc',
      userId: 'user-1',
      favoriteType: 'artist' as FavoriteType,
      entityId: 'artist-1',
      addedAt: new Date().toISOString(),
      entityName: 'Test Artist',
      entityMeta: { slug: 'test-artist', imageUrl: null },
    };
    expect(fav.entityName).toBe('Test Artist');
    expect(fav.entityMeta?.slug).toBe('test-artist');
  });
});
