import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { PlaySession, SessionState, SessionMember, Track } from '../types';
import * as api from '../api';

const POLL_INTERVAL = 2000; // 2s polling for shared state

function formatTime(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function SessionPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<PlaySession | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [members, setMembers] = useState<SessionMember[]>([]);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [queueTracks, setQueueTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(false);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<number | null>(null);
  const currentTokenRef = useRef(token);
  currentTokenRef.current = token;

  // Initial load
  const loadSession = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      const data = await api.getSession(token);
      setSession(data.session);
      setState(data.state);
      setMembers(data.members);
      if (data.currentTrack) setCurrentTrack(data.currentTrack);
      setJoined(true); // if we got here, treat as joined
      setError('');

      // Load queue track details
      if (data.state.queue.length > 0) {
        loadQueueTracks(data.state.queue);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Session not found');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadQueueTracks = async (trackIds: string[]) => {
    try {
      const tracks = await Promise.all(
        trackIds.map(id => api.getTrack(id).catch(() => null))
      );
      setQueueTracks(tracks.filter((t): t is Track => t !== null));
    } catch {
      // ignore
    }
  };

  // Poll for state updates
  useEffect(() => {
    if (!token || !joined || !session?.isActive) return;

    const poll = async () => {
      try {
        const data = await api.getSessionState(currentTokenRef.current!);
        setState(data.state);
        if (data.currentTrack) setCurrentTrack(data.currentTrack);
      } catch {
        // ignore poll errors
      }
    };

    pollRef.current = window.setInterval(poll, POLL_INTERVAL);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [token, joined, session?.isActive]);

  useEffect(() => { loadSession(); }, [loadSession]);

  // Actions
  const handleAction = async (action: string, data?: any) => {
    if (!token) return;
    try {
      const result = await api.updateSessionState(token, action, data);
      setState(result.state);
      if (result.currentTrack) setCurrentTrack(result.currentTrack);
    } catch (err) {
      console.error('Session action failed:', err);
    }
  };

  const handleJoin = async () => {
    if (!token) return;
    try {
      const data = await api.joinSession(token);
      setSession(data.session);
      setState(data.state);
      setMembers(data.members);
      setJoined(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join session');
    }
  };

  const handleLeave = async () => {
    if (!token) return;
    try {
      await api.leaveSession(token);
      navigate('/');
    } catch (err) {
      console.error('Leave failed:', err);
    }
  };

  const handleRegenerate = async () => {
    if (!token) return;
    try {
      const result = await api.regenerateSessionToken(token);
      navigate(`/session/${result.token}`, { replace: true });
      setSession(prev => prev ? { ...prev, token: result.token } : prev);
    } catch (err) {
      console.error('Regenerate failed:', err);
    }
  };

  const handleEnd = async () => {
    if (!token) return;
    if (!confirm('End this session? All members will be disconnected.')) return;
    try {
      await api.endSessionApi(token);
      setSession(prev => prev ? { ...prev, isActive: false } : prev);
      setState(prev => prev ? { ...prev, isPlaying: false } : prev);
    } catch (err) {
      console.error('End session failed:', err);
    }
  };

  const copyLink = () => {
    const url = `${window.location.origin}/session/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleTrackClick = (trackId: string) => {
    handleAction('set_track', { trackId });
  };

  if (loading) return <div className="page-header"><h1>Loading session...</h1></div>;
  if (error) return (
    <div className="page-header">
      <h1>Session Error</h1>
      <p style={{ color: 'var(--danger)' }}>{error}</p>
      {!joined && (
        <button className="btn btn-primary" onClick={handleJoin}>Join Session</button>
      )}
    </div>
  );
  if (!session || !state) return <div className="page-header"><h1>Session not found</h1></div>;

  const isOwner = session.ownerId === '00000000-0000-0000-0000-000000000001'; // Default user

  // Calculate actual position: positionSec + elapsed time since positionUpdatedAt (if playing)
  const elapsed = state.isPlaying
    ? (Date.now() - new Date(state.positionUpdatedAt).getTime()) / 1000
    : 0;
  const actualPosition = state.positionSec + elapsed;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>🎧 {session.name}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {session.isActive ? '🟢 Active' : '🔴 Ended'}
            {' · '}{members.length} member{members.length !== 1 ? 's' : ''}
            {' · '}Created {timeAgo(session.createdAt)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={copyLink}>
            {copied ? '✅ Copied!' : '🔗 Copy Link'}
          </button>
          {isOwner && session.isActive && (
            <>
              <button className="btn btn-secondary" onClick={handleRegenerate} title="Generate new share link">
                🔄 New Link
              </button>
              <button className="btn btn-secondary" onClick={handleEnd} style={{ color: 'var(--danger)' }}>
                ⏹ End Session
              </button>
            </>
          )}
          <button className="btn btn-secondary" onClick={handleLeave}>
            🚪 Leave
          </button>
        </div>
      </div>

      {/* Now Playing */}
      <div className="session-now-playing">
        <div className="session-np-art">
          {currentTrack?.ytThumbnailUrl ? (
            <img src={currentTrack.ytThumbnailUrl} alt="" />
          ) : (
            <div className="session-np-placeholder">🎵</div>
          )}
        </div>
        <div className="session-np-info">
          <div className="session-np-title">{currentTrack?.title ?? 'No track selected'}</div>
          <div className="session-np-artist">{currentTrack?.artist ?? ''}</div>
          <div className="session-np-position">
            {formatTime(actualPosition)} / {formatTime(currentTrack?.duration ?? 0)}
          </div>
        </div>
        <div className="session-np-controls">
          <button className="btn-icon" onClick={() => handleAction('previous')} disabled={!session.isActive}>⏮</button>
          {state.isPlaying ? (
            <button className="btn-icon session-play-btn" onClick={() => handleAction('pause', { positionSec: actualPosition })} disabled={!session.isActive}>⏸</button>
          ) : (
            <button className="btn-icon session-play-btn" onClick={() => handleAction('play', { positionSec: state.positionSec })} disabled={!session.isActive}>▶️</button>
          )}
          <button className="btn-icon" onClick={() => handleAction('next')} disabled={!session.isActive}>⏭</button>
        </div>
      </div>

      {/* Queue */}
      <div className="session-section">
        <h2>Queue ({state.queue.length} tracks)</h2>
        <div className="session-queue">
          {queueTracks.length === 0 && state.queue.length > 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading queue...</p>
          ) : queueTracks.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No tracks in queue. Add tracks from the Tracks page.</p>
          ) : (
            queueTracks.map((track, idx) => (
              <div
                key={track.id}
                className={`session-queue-item ${state.currentTrackId === track.id ? 'session-queue-active' : ''}`}
                onClick={() => session.isActive && handleTrackClick(track.id)}
                style={{ cursor: session.isActive ? 'pointer' : 'default' }}
              >
                <span className="session-queue-num">{idx + 1}</span>
                <span className="session-queue-title">{track.title}</span>
                <span className="session-queue-artist">{track.artist}</span>
                <span className="session-queue-dur">{formatTime(track.duration ?? 0)}</span>
                {state.currentTrackId === track.id && (
                  <span className="session-queue-playing">{state.isPlaying ? '🔊' : '⏸'}</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Members */}
      <div className="session-section">
        <h2>Members</h2>
        <div className="session-members">
          {members.map(m => (
            <div key={m.id} className="session-member">
              <span>{m.role === 'owner' ? '👑' : '👤'}</span>
              <span>{m.role === 'owner' ? 'Host' : 'Listener'}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
