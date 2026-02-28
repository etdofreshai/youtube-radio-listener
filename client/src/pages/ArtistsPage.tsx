import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Artist } from '../types';
import * as api from '../api';
import FavoriteButton from '../components/FavoriteButton';

export default function ArtistsPage() {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getArtists()
      .then(setArtists)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-header"><h1>Loading…</h1></div>;

  return (
    <>
      <div className="page-header">
        <h1>Artists</h1>
      </div>

      {artists.length === 0 ? (
        <div className="empty-state">
          <h3>No artists yet</h3>
          <p>Artists are created automatically when you add tracks.</p>
        </div>
      ) : (
        <div className="entity-grid">
          {artists.map(a => (
            <Link key={a.id} to={`/artists/${a.slug}`} className="entity-card">
              {a.imageUrl ? (
                <img src={a.imageUrl} alt={a.name} className="entity-card-image" />
              ) : (
                <div className="entity-card-placeholder">🎤</div>
              )}
              <div className="entity-card-name" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', justifyContent: 'center' }}>
                {a.name}
                <span onClick={e => e.preventDefault()}>
                  <FavoriteButton type="artist" entityId={a.id} size="sm" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
