import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import type { FavoriteType, FavoriteIdEntry } from '../types';
import * as api from '../api';

interface FavoritesContextValue {
  /** Check if entity is favorited (uses local cache) */
  isFavorited: (type: FavoriteType, entityId: string) => boolean;
  /** Toggle favorite on/off — returns new state */
  toggleFavorite: (type: FavoriteType, entityId: string) => Promise<boolean>;
  /** Force refresh the cache from server */
  refreshFavorites: () => Promise<void>;
  /** Loading state */
  loading: boolean;
}

const FavoritesContext = createContext<FavoritesContextValue>({
  isFavorited: () => false,
  toggleFavorite: async () => false,
  refreshFavorites: async () => {},
  loading: true,
});

export function useFavorites() {
  return useContext(FavoritesContext);
}

/** Build a cache key from type + entityId */
function cacheKey(type: FavoriteType, entityId: string): string {
  return `${type}:${entityId}`;
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  // Set of "type:entityId" strings for O(1) lookup
  const [favSet, setFavSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const loadedRef = useRef(false);

  const refreshFavorites = useCallback(async () => {
    try {
      const ids: FavoriteIdEntry[] = await api.getUserFavoriteIds();
      const newSet = new Set(ids.map(e => cacheKey(e.favoriteType, e.entityId)));
      setFavSet(newSet);
    } catch (err) {
      console.error('[FavoritesContext] Failed to load favorites:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount
  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      refreshFavorites();
    }
  }, [refreshFavorites]);

  const isFavorited = useCallback((type: FavoriteType, entityId: string): boolean => {
    return favSet.has(cacheKey(type, entityId));
  }, [favSet]);

  const toggleFavorite = useCallback(async (type: FavoriteType, entityId: string): Promise<boolean> => {
    const key = cacheKey(type, entityId);
    const wasFavorited = favSet.has(key);

    // Optimistic update
    setFavSet(prev => {
      const next = new Set(prev);
      if (wasFavorited) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

    try {
      if (wasFavorited) {
        await api.removeUserFavorite(type, entityId);
        return false;
      } else {
        await api.addUserFavorite(type, entityId);
        return true;
      }
    } catch (err) {
      // Revert optimistic update on error
      console.error('[FavoritesContext] Toggle failed, reverting:', err);
      setFavSet(prev => {
        const next = new Set(prev);
        if (wasFavorited) {
          next.add(key);
        } else {
          next.delete(key);
        }
        return next;
      });
      return wasFavorited;
    }
  }, [favSet]);

  return (
    <FavoritesContext.Provider value={{ isFavorited, toggleFavorite, refreshFavorites, loading }}>
      {children}
    </FavoritesContext.Provider>
  );
}
