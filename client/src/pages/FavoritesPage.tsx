import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { UserFavorite, FavoriteType } from '../types';
import * as api from '../api';
import { useFavorites } from '../context/FavoritesContext';
import FavoriteButton from '../components/FavoriteButton';
import { useAudioPlayer } from '../components/AudioPlayer';

const TYPE_LABELS: Record<FavoriteType, string> = {
  track: '🎵 Tracks',
  artist: '🎤 Artists',
  album: '💿 Albums',
  radio_station: '📻 Radio Stations',
  playlist: '📋 Playlists',
};

const TYPE_ORDER: FavoriteType[] = ['track', 'artist', 'album', 'radio_station', 'playlist'];

type FilterType = 'all' | FavoriteType;

export default function FavoritesPage() {
  const [favorites, setFavorites] = useState<UserFavorite[]>([]);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [loading, setLoading] = useState(true);
  const { refreshFavorites } = useFavorites();
  const { play: playTrack } = useAudioPlayer();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const type = filter === 'all' ? undefined : filter;
      const favs = await api.getUserFavorites(type);
      setFavorites(favs);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load favorites');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const handleRemove = async (type: FavoriteType, entityId: string) => {
    await api.removeUserFavorite(type, entityId);
    refreshFavorites();
    load();
  };

  const handlePlayTrack = async (trackId: string) => {
    try {
      const track = await api.getTrack(trackId);
      playTrack(track);
    } catch {
      // ignore
    }
  };

  // Group favorites by type
  const grouped = TYPE_ORDER.reduce<Record<FavoriteType, UserFavorite[]>>((acc, t) => {
    acc[t] = favorites.filter(f => f.favoriteType === t);
    return acc;
  }, { track: [], artist: [], album: [], radio_station: [], playlist: [] });

  const totalCount = favorites.length;

  return (
    <>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <h1>❤️ Favorites</h1>
        {totalCount > 0 && (
          <span style={{ fontSize: '0.85rem', opacity: 0.6 }}>
            {totalCount} item{totalCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Type filter tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <FilterTab active={filter === 'all'} onClick={() => setFilter('all')} label="All" />
        {TYPE_ORDER.map(t => (
          <FilterTab key={t} active={filter === t} onClick={() => setFilter(t)} label={TYPE_LABELS[t]} />
        ))}
      </div>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {loading ? (
        <p style={{ opacity: 0.5 }}>Loading favorites…</p>
      ) : totalCount === 0 ? (
        <div className="empty-state">
          <h3>No favorites yet</h3>
          <p>Click the ❤️ icon on tracks, artists, albums, playlists, or radio stations to add them here.</p>
        </div>
      ) : filter === 'all' ? (
        // Grouped view
        TYPE_ORDER.map(type => {
          const items = grouped[type];
          if (items.length === 0) return null;
          return (
            <section key={type} style={{ marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>{TYPE_LABELS[type]}</h2>
              <FavoritesList
                items={items}
                onRemove={handleRemove}
                onPlayTrack={handlePlayTrack}
              />
            </section>
          );
        })
      ) : (
        // Flat filtered view
        <FavoritesList
          items={favorites}
          onRemove={handleRemove}
          onPlayTrack={handlePlayTrack}
        />
      )}
    </>
  );
}

function FilterTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      className={`btn btn-sm ${active ? 'btn-primary' : ''}`}
      onClick={onClick}
      style={{
        background: active ? 'var(--primary)' : 'var(--surface)',
        color: active ? '#fff' : 'var(--text)',
        border: '1px solid var(--border)',
        borderRadius: '1rem',
        padding: '0.3rem 0.8rem',
        fontSize: '0.8rem',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

interface FavoritesListProps {
  items: UserFavorite[];
  onRemove: (type: FavoriteType, entityId: string) => void;
  onPlayTrack: (trackId: string) => void;
}

function FavoritesList({ items, onRemove, onPlayTrack }: FavoritesListProps) {
  return (
    <div className="track-list">
      {items.map(fav => (
        <FavoriteRow key={fav.id} fav={fav} onRemove={onRemove} onPlayTrack={onPlayTrack} />
      ))}
    </div>
  );
}

function FavoriteRow({ fav, onRemove, onPlayTrack }: { fav: UserFavorite; onRemove: (type: FavoriteType, entityId: string) => void; onPlayTrack: (trackId: string) => void }) {
  const entityLink = getEntityLink(fav);
  const typeEmoji = getTypeEmoji(fav.favoriteType);

  return (
    <div className="track-row" style={{ gridTemplateColumns: 'auto 1fr auto auto', alignItems: 'center', gap: '0.75rem' }}>
      {/* Play button for tracks */}
      <div style={{ width: '2rem', textAlign: 'center' }}>
        {fav.favoriteType === 'track' ? (
          <button
            className="btn-icon"
            onClick={() => onPlayTrack(fav.entityId)}
            title="Play"
            style={{ fontSize: '1.1rem' }}
          >
            ▶
          </button>
        ) : (
          <span style={{ fontSize: '1.1rem' }}>{typeEmoji}</span>
        )}
      </div>

      {/* Name + subtitle */}
      <div style={{ minWidth: 0 }}>
        {entityLink ? (
          <Link to={entityLink} className="track-title" style={{ textDecoration: 'none' }}>
            {fav.entityName ?? 'Unknown'}
          </Link>
        ) : (
          <div className="track-title">{fav.entityName ?? 'Unknown'}</div>
        )}
        <div className="track-artist" style={{ fontSize: '0.8rem', opacity: 0.6 }}>
          {getSubtitle(fav)}
        </div>
      </div>

      {/* Date */}
      <div className="track-meta" style={{ fontSize: '0.75rem', opacity: 0.5, whiteSpace: 'nowrap' }}>
        {new Date(fav.addedAt).toLocaleDateString()}
      </div>

      {/* Favorite button */}
      <FavoriteButton type={fav.favoriteType} entityId={fav.entityId} size="md" />
    </div>
  );
}

function getTypeEmoji(type: FavoriteType): string {
  switch (type) {
    case 'track': return '🎵';
    case 'artist': return '🎤';
    case 'album': return '💿';
    case 'radio_station': return '📻';
    case 'playlist': return '📋';
  }
}

function getEntityLink(fav: UserFavorite): string | null {
  switch (fav.favoriteType) {
    case 'artist': return `/artists/${fav.entityMeta?.slug || fav.entityId}`;
    case 'album': return `/albums/${fav.entityMeta?.slug || fav.entityId}`;
    case 'playlist': return `/playlists/${fav.entityId}`;
    default: return null;
  }
}

function getSubtitle(fav: UserFavorite): string {
  switch (fav.favoriteType) {
    case 'track': return fav.entityMeta?.artist ?? '';
    case 'album': return fav.entityMeta?.artistName ?? '';
    case 'radio_station': return 'Radio Station';
    case 'playlist': return 'Playlist';
    case 'artist': return 'Artist';
    default: return '';
  }
}
