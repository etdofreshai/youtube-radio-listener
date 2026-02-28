import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { Album, Track } from '../types';
import * as api from '../api';
import { useAudioPlayer } from '../components/AudioPlayer';
import FavoriteButton from '../components/FavoriteButton';

export default function AlbumPage() {
  const { idOrSlug } = useParams<{ idOrSlug: string }>();
  const [album, setAlbum] = useState<Album | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const { play, pause, currentTrack, isPlaying, setPlaylist } = useAudioPlayer();

  useEffect(() => {
    if (!idOrSlug) return;
    setLoading(true);
    api.getAlbumDetail(idOrSlug)
      .then(data => {
        const { tracks: t, ...a } = data;
        setAlbum(a);
        setTracks(t || []);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Album not found'))
      .finally(() => setLoading(false));
  }, [idOrSlug]);

  // Set playlist for next/prev when tracks load
  useEffect(() => {
    if (tracks.length > 0) setPlaylist(tracks);
  }, [tracks, setPlaylist]);

  const handlePlay = (track: Track) => {
    if (currentTrack?.id === track.id && isPlaying) pause();
    else play(track);
  };

  function formatDuration(sec: number | null): string {
    if (!sec) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  if (loading) return <div className="page-header"><h1>Loading…</h1></div>;
  if (error || !album) return <div className="page-header"><h1>Album not found</h1><p style={{ color: 'var(--danger)' }}>{error}</p></div>;

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {album.artworkUrl && (
            <img src={album.artworkUrl} alt={album.title}
              style={{ width: 100, height: 100, borderRadius: 'var(--radius)', objectFit: 'cover' }} />
          )}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h1>{album.title}</h1>
              <FavoriteButton type="album" entityId={album.id} size="lg" />
            </div>
            <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>
              {album.artistName && (
                <span>
                  By{' '}
                  {album.artistId ? (
                    <Link to={`/artists/${album.artistId}`} className="entity-link">{album.artistName}</Link>
                  ) : album.artistName}
                </span>
              )}
              {album.releaseYear && <span> · {album.releaseYear}</span>}
            </div>
          </div>
        </div>
        <Link to="/" className="btn btn-secondary">← Back to Tracks</Link>
      </div>

      {tracks.length === 0 ? (
        <div className="empty-state">
          <h3>No tracks</h3>
          <p>This album has no tracks yet.</p>
        </div>
      ) : (
        <div className="track-list">
          <div className="track-row track-header">
            <span style={{ width: '40px' }}></span>
            <span>Title</span>
            <span>Artist</span>
            <span style={{ width: '80px' }}>Duration</span>
          </div>
          {tracks.map(t => {
            const isCurrent = currentTrack?.id === t.id;
            const canPlay = t.audioStatus === 'ready';
            return (
              <div key={t.id} className={`track-row ${isCurrent ? 'track-active' : ''}`}>
                <div>
                  {canPlay ? (
                    <button
                      className={`btn-play ${isCurrent && isPlaying ? 'playing' : ''}`}
                      onClick={() => handlePlay(t)}
                    >
                      {isCurrent && isPlaying ? '⏸' : '▶'}
                    </button>
                  ) : (
                    <span className="btn-play disabled">▶</span>
                  )}
                </div>
                <div className="track-title-cell">
                  <div className="track-title">{t.title}</div>
                </div>
                <div className="track-artist">
                  {t.artists && t.artists.length > 0 ? (
                    t.artists.map((a, i) => (
                      <span key={a.id}>
                        {i > 0 && ', '}
                        <Link to={`/artists/${a.slug}`} className="entity-link">{a.name}</Link>
                      </span>
                    ))
                  ) : t.artist}
                </div>
                <div className="track-meta">{formatDuration(t.duration)}</div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
