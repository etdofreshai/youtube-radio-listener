import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Album } from '../types';
import * as api from '../api';

export default function AlbumsPage() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAlbums()
      .then(setAlbums)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-header"><h1>Loading…</h1></div>;

  return (
    <>
      <div className="page-header">
        <h1>Albums</h1>
      </div>

      {albums.length === 0 ? (
        <div className="empty-state">
          <h3>No albums yet</h3>
          <p>Albums are created when tracks are enriched with album metadata.</p>
        </div>
      ) : (
        <div className="entity-grid">
          {albums.map(a => (
            <Link key={a.id} to={`/albums/${a.slug}`} className="entity-card">
              {a.artworkUrl ? (
                <img src={a.artworkUrl} alt={a.title} className="entity-card-image" />
              ) : (
                <div className="entity-card-placeholder">💿</div>
              )}
              <div className="entity-card-name">{a.title}</div>
              {a.artistName && <div className="entity-card-sub">{a.artistName}</div>}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
