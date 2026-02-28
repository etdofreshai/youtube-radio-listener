import { useState, useCallback } from 'react';
import type { YouTubeSearchResultItem, Track } from '../types';
import * as api from '../api';
import { usePreviewPlayer } from '../hooks/usePreviewPlayer';
import type { PreviewState } from '../hooks/previewState';

interface YouTubeSearchProps {
  /** Currently loaded tracks — used to detect duplicates */
  existingTracks: Track[];
  /** Called after a track is successfully added */
  onTrackAdded: () => void;
}

type AddState = 'idle' | 'adding' | 'added' | 'error';

interface ResultState {
  addState: AddState;
  error?: string;
}

/* ---------- Preview button sub-component ---------- */

function PreviewControls({
  videoId,
  previewState,
  onPlay,
  onPause,
  onStop,
}: {
  videoId: string;
  previewState: PreviewState;
  onPlay: (videoId: string) => void;
  onPause: () => void;
  onStop: () => void;
}) {
  const isActive = previewState !== 'idle' && previewState !== 'error';

  return (
    <div className="yt-preview-controls">
      {/* Play / Pause toggle */}
      {previewState === 'loading' ? (
        <button className="btn-preview btn-preview-loading" disabled title="Loading preview…">
          <span className="preview-spinner" />
        </button>
      ) : previewState === 'playing' ? (
        <button className="btn-preview btn-preview-pause" onClick={onPause} title="Pause preview">
          ⏸
        </button>
      ) : (
        <button
          className="btn-preview btn-preview-play"
          onClick={() => onPlay(videoId)}
          title={previewState === 'paused' ? 'Resume preview' : 'Preview audio'}
        >
          {previewState === 'paused' ? '▶' : '🔊'}
        </button>
      )}

      {/* Stop button — only visible when active or paused */}
      {isActive && (
        <button className="btn-preview btn-preview-stop" onClick={onStop} title="Stop preview">
          ⏹
        </button>
      )}

      {/* Error state */}
      {previewState === 'error' && (
        <span className="yt-preview-error" title="Preview not available">⚠</span>
      )}
    </div>
  );
}

/* ---------- Main component ---------- */

export default function YouTubeSearch({ existingTracks, onTrackAdded }: YouTubeSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<YouTubeSearchResultItem[]>([]);
  const [resultStates, setResultStates] = useState<Record<string, ResultState>>({});
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  // Track URLs that were added during this session (to persist across re-searches)
  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set());

  // Preview player
  const preview = usePreviewPlayer();

  const isAlreadyInTracks = useCallback((youtubeUrl: string): boolean => {
    if (addedUrls.has(youtubeUrl)) return true;
    return existingTracks.some(t => {
      // Compare by video ID extracted from URL
      try {
        const existingId = new URL(t.youtubeUrl).searchParams.get('v');
        const candidateId = new URL(youtubeUrl).searchParams.get('v');
        return existingId && candidateId && existingId === candidateId;
      } catch {
        return t.youtubeUrl === youtubeUrl;
      }
    });
  }, [existingTracks, addedUrls]);

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;

    // Stop any active preview when starting a new search
    preview.stop();

    setSearching(true);
    setSearchError('');
    setHasSearched(true);
    setResults([]);
    setResultStates({});

    try {
      const data = await api.searchYouTube(q);
      setResults(data.results);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch();
  };

  const handleAdd = async (item: YouTubeSearchResultItem) => {
    setResultStates(prev => ({ ...prev, [item.videoId]: { addState: 'adding' } }));

    try {
      await api.createTrack({ youtubeUrl: item.youtubeUrl });
      setResultStates(prev => ({ ...prev, [item.videoId]: { addState: 'added' } }));
      setAddedUrls(prev => new Set(prev).add(item.youtubeUrl));
      onTrackAdded();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add';
      setResultStates(prev => ({ ...prev, [item.videoId]: { addState: 'error', error: msg } }));
    }
  };

  function formatDuration(sec: number | null): string {
    if (!sec) return '—';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function formatViews(count: number | null): string {
    if (count == null) return '';
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M views`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K views`;
    return `${count} views`;
  }

  return (
    <div className="yt-search">
      <form onSubmit={handleSubmit} className="yt-search-form">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search YouTube for music..."
          className="yt-search-input"
          disabled={searching}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={searching || !query.trim()}
        >
          {searching ? '⏳ Searching…' : '🔍 Search'}
        </button>
      </form>

      {searchError && (
        <div className="yt-search-error">
          ⚠ {searchError}
        </div>
      )}

      {searching && (
        <div className="yt-search-loading">
          <div className="yt-search-spinner" />
          <span>Searching YouTube…</span>
        </div>
      )}

      {!searching && hasSearched && results.length === 0 && !searchError && (
        <div className="yt-search-empty">
          No results found for "{query}"
        </div>
      )}

      {results.length > 0 && (
        <div className="yt-search-results">
          {results.map(item => {
            const state = resultStates[item.videoId];
            const alreadyInTracks = isAlreadyInTracks(item.youtubeUrl);
            const isAdded = state?.addState === 'added' || alreadyInTracks;
            const isAdding = state?.addState === 'adding';
            const previewState = preview.getState(item.videoId);

            return (
              <div key={item.videoId} className={`yt-result-card ${isAdded ? 'yt-result-added' : ''} ${previewState === 'playing' ? 'yt-result-previewing' : ''}`}>
                <div className="yt-result-thumbnail">
                  {item.thumbnailUrl ? (
                    <img src={item.thumbnailUrl} alt={item.title} loading="lazy" />
                  ) : (
                    <div className="yt-result-thumbnail-placeholder">🎵</div>
                  )}
                  {item.duration && (
                    <span className="yt-result-duration">{formatDuration(item.duration)}</span>
                  )}
                </div>

                <div className="yt-result-info">
                  <a
                    className="yt-result-title"
                    href={item.youtubeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={item.title}
                  >
                    {item.title}
                  </a>
                  <div className="yt-result-meta">
                    <span className="yt-result-channel">{item.channel}</span>
                    {item.viewCount != null && (
                      <span className="yt-result-views">{formatViews(item.viewCount)}</span>
                    )}
                  </div>
                  {state?.addState === 'error' && (
                    <div className="yt-result-error">{state.error}</div>
                  )}
                  {previewState === 'error' && preview.activeVideoId === item.videoId && (
                    <div className="yt-result-error">{preview.errorMessage || 'Preview unavailable'}</div>
                  )}
                </div>

                <div className="yt-result-action">
                  <PreviewControls
                    videoId={item.videoId}
                    previewState={previewState}
                    onPlay={preview.play}
                    onPause={preview.pause}
                    onStop={preview.stop}
                  />
                  {isAdded ? (
                    <span className="yt-result-added-badge">✅ Added</span>
                  ) : (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleAdd(item)}
                      disabled={isAdding}
                    >
                      {isAdding ? '⏳' : '+ Add'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
