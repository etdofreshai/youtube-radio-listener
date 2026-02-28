import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { Artist, Track } from '../types';
import * as api from '../api';
import { useAudioPlayer } from '../components/AudioPlayer';

export default function ArtistPage() {
  const { idOrSlug } = useParams<{ idOrSlug: string }>();
  const [artist, setArtist] = useState<Artist | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const { play, pause, currentTrack, isPlaying } = useAudioPlayer();

  useEffect(() => {
    if (!idOrSlug) return;
    setLoading(true);
    api.getArtist(idOrSlug)
      .then(data => {
        const { tracks: t, ...a } = data;
        setArtist(a);
        setTracks(t || []);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Artist not found'))
      .finally(() => setLoading(false));
  }, [idOrSlug]);

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
  if (error || !artist) return <div className="page-header"><h1>Artist not found</h1><p style={{ color: 'var(--danger)' }}>{error}</p></div>;

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {artist.imageUrl && (
            <img src={artist.imageUrl} alt={artist.name}
              style={{ width: 80, height: 80, borderRadius: 'var(--radius)', objectFit: 'cover' }} />
          )}
          <div>
            <h1>{artist.name}</h1>
            {artist.bio && <p style={{ color: 'var(--text-secondary)', marginTop: 4 }}>{artist.bio}</p>}
          </div>
        </div>
        <Link to="/" className="btn btn-secondary">← Back to Tracks</Link>
      </div>

      {tracks.length === 0 ? (
        <div className="empty-state">
          <h3>No tracks</h3>
          <p>This artist has no tracks yet.</p>
        </div>
      ) : (
        <div className="track-list">
          <div className="track-row track-header">
            <span style={{ width: '40px' }}></span>
            <span>Title</span>
            <span>Album</span>
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
                <div className="track-meta">
                  {t.albumName ? (
                    <Link to={`/albums/${t.albumSlug || t.albumId}`} className="entity-link">
                      {t.albumName}
                    </Link>
                  ) : t.album || '—'}
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
