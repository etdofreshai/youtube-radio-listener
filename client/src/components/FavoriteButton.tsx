import { useCallback, useState } from 'react';
import type { FavoriteType } from '../types';
import { useFavorites } from '../context/FavoritesContext';

interface FavoriteButtonProps {
  type: FavoriteType;
  entityId: string;
  /** Optional size: 'sm' (track rows), 'md' (cards), 'lg' (detail pages) */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_MAP = {
  sm: { fontSize: '1rem', padding: '0.15rem 0.25rem' },
  md: { fontSize: '1.2rem', padding: '0.25rem 0.35rem' },
  lg: { fontSize: '1.5rem', padding: '0.3rem 0.5rem' },
};

export default function FavoriteButton({ type, entityId, size = 'sm', className = '' }: FavoriteButtonProps) {
  const { isFavorited, toggleFavorite } = useFavorites();
  const [toggling, setToggling] = useState(false);
  const favorited = isFavorited(type, entityId);

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (toggling) return;
    setToggling(true);
    try {
      await toggleFavorite(type, entityId);
    } finally {
      setToggling(false);
    }
  }, [type, entityId, toggling, toggleFavorite]);

  const style = SIZE_MAP[size];

  return (
    <button
      className={`favorite-btn ${favorited ? 'favorited' : ''} ${className}`}
      onClick={handleClick}
      aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
      title={favorited ? 'Remove from favorites' : 'Add to favorites'}
      disabled={toggling}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: style.fontSize,
        padding: style.padding,
        lineHeight: 1,
        opacity: toggling ? 0.5 : 1,
        transition: 'transform 0.15s ease, opacity 0.15s ease',
        transform: toggling ? 'scale(1.3)' : 'scale(1)',
      }}
    >
      {favorited ? '❤️' : '🤍'}
    </button>
  );
}
