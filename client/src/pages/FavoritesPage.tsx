import { useState, useEffect, useCallback } from 'react';
import type { Favorite } from '../types';
import * as api from '../api';

export default function FavoritesPage() {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setFavorites(await api.getFavorites());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load favorites');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRemove = async (trackId: string) => {
    await api.removeFavorite(trackId);
    load();
  };

  return (
    <>
      <div className="page-header">
        <h1>Favorites</h1>
      </div>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {favorites.length === 0 ? (
        <div className="empty-state">
          <h3>No favorites yet</h3>
          <p>Like tracks from the Tracks page to see them here.</p>
        </div>
      ) : (
        <div className="track-list">
          {favorites.map(f => (
            <div key={f.id} className="track-row" style={{ gridTemplateColumns: '1fr 180px 120px 80px' }}>
              <div>
                <div className="track-title">{f.track?.title ?? 'Unknown'}</div>
                <div className="track-artist">{f.track?.artist ?? '—'}</div>
              </div>
              <div className="track-meta" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.track?.youtubeUrl ?? ''}
              </div>
              <div className="track-meta">
                Liked {new Date(f.likedAt).toLocaleDateString()}
              </div>
              <div>
                <button className="btn btn-danger btn-sm" onClick={() => handleRemove(f.trackId)}>
                  Unlike
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
