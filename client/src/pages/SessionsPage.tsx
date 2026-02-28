import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PlaySession } from '../types';
import * as api from '../api';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function SessionsPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<PlaySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [joinToken, setJoinToken] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getMySessions();
      setSessions(data);
    } catch (e) {
      console.error('Failed to load sessions:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const result = await api.createSession({ name: sessionName || undefined });
      navigate(`/session/${result.session.token}`);
    } catch (err) {
      console.error('Failed to create session:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = () => {
    const t = joinToken.trim();
    if (!t) return;
    // Allow pasting full URL or just token
    const match = t.match(/session\/([0-9a-f-]{36})/i);
    const token = match ? match[1] : t;
    navigate(`/session/${token}`);
  };

  const activeSessions = sessions.filter(s => s.isActive);
  const pastSessions = sessions.filter(s => !s.isActive);

  return (
    <>
      <div className="page-header">
        <h1>🎧 Listening Sessions</h1>
      </div>

      {/* Create / Join */}
      <div className="session-actions-panel">
        <div className="session-create">
          <h3>Start a Session</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="search-input"
              placeholder="Session name (optional)"
              value={sessionName}
              onChange={e => setSessionName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
              {creating ? '⏳' : '🎵'} Create
            </button>
          </div>
        </div>
        <div className="session-join">
          <h3>Join a Session</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="search-input"
              placeholder="Paste session link or token"
              value={joinToken}
              onChange={e => setJoinToken(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleJoin()}
              style={{ flex: 1 }}
            />
            <button className="btn btn-secondary" onClick={handleJoin} disabled={!joinToken.trim()}>
              🔗 Join
            </button>
          </div>
        </div>
      </div>

      {/* Active Sessions */}
      {activeSessions.length > 0 && (
        <div className="session-section">
          <h2>🟢 Active Sessions</h2>
          <div className="session-list">
            {activeSessions.map(s => (
              <div
                key={s.id}
                className="session-list-item"
                onClick={() => navigate(`/session/${s.token}`)}
              >
                <div className="session-list-info">
                  <span className="session-list-name">{s.name}</span>
                  <span className="session-list-meta">Started {timeAgo(s.createdAt)}</span>
                </div>
                <span className="session-list-status active">Active</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Past Sessions */}
      {pastSessions.length > 0 && (
        <div className="session-section">
          <h2>🔴 Past Sessions</h2>
          <div className="session-list">
            {pastSessions.map(s => (
              <div
                key={s.id}
                className="session-list-item"
                onClick={() => navigate(`/session/${s.token}`)}
              >
                <div className="session-list-info">
                  <span className="session-list-name">{s.name}</span>
                  <span className="session-list-meta">Ended {timeAgo(s.endedAt ?? s.updatedAt)}</span>
                </div>
                <span className="session-list-status ended">Ended</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 32 }}>Loading sessions...</p>}
      {!loading && sessions.length === 0 && (
        <div className="empty-state">
          <h3>No sessions yet</h3>
          <p>Create a listening session to share music with friends in real-time.</p>
        </div>
      )}
    </>
  );
}
