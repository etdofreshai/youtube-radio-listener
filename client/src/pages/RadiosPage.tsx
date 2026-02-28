import { useState, useEffect } from 'react';
import type { RadioStation, CreateRadioStationInput } from '../types';
import {
  getRadioStations,
  createRadioStation,
  updateRadioStation,
  deleteRadioStation,
  toggleRadioStation,
} from '../api';
import { useAudioPlayer } from '../components/AudioPlayer';

// ---------- helpers ----------

function LiveBadge({ isLive }: { isLive: boolean }) {
  if (!isLive) return null;
  return <span className="badge-live" title="Live stream" style={{ marginRight: '0.4rem' }}>LIVE</span>;
}

// ---------- Add / Edit form ----------

interface StationFormProps {
  initial?: Partial<CreateRadioStationInput>;
  onSave: (data: CreateRadioStationInput) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}

function StationForm({ initial, onSave, onCancel, saving }: StationFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [streamUrl, setStreamUrl] = useState(initial?.streamUrl ?? '');
  const [homepageUrl, setHomepageUrl] = useState(initial?.homepageUrl ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [isLive, setIsLive] = useState(initial?.isLive ?? true);
  const [tagsRaw, setTagsRaw] = useState((initial?.tags ?? []).join(', '));
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    if (!streamUrl.trim()) { setError('Stream URL is required'); return; }
    setError(null);
    const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
    await onSave({ name: name.trim(), streamUrl: streamUrl.trim(), homepageUrl: homepageUrl.trim() || undefined, description: description.trim() || undefined, isLive, tags });
  }

  return (
    <form onSubmit={handleSubmit} className="station-form" style={{ background: 'var(--surface)', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
      {error && <p style={{ color: 'var(--error, #f87171)', marginBottom: '0.5rem' }}>{error}</p>}
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        <label>
          <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>Name *</span>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Rainwave OCR Remix" required />
        </label>
        <label>
          <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>Stream URL *</span>
          <input className="input" value={streamUrl} onChange={e => setStreamUrl(e.target.value)} placeholder="http://..." required />
        </label>
        <label>
          <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>Homepage URL</span>
          <input className="input" value={homepageUrl} onChange={e => setHomepageUrl(e.target.value)} placeholder="https://..." />
        </label>
        <label>
          <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>Description</span>
          <input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description…" />
        </label>
        <label>
          <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>Tags (comma-separated)</span>
          <input className="input" value={tagsRaw} onChange={e => setTagsRaw(e.target.value)} placeholder="vgm, remix, chiptune" />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input type="checkbox" checked={isLive} onChange={e => setIsLive(e.target.checked)} />
          <span style={{ fontSize: '0.85rem' }}>Live stream (continuous, no seeking)</span>
        </label>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}

// ---------- Station card ----------

interface StationCardProps {
  station: RadioStation;
  isPlaying: boolean;
  onPlay: () => void;
  onStop: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
}

function StationCard({ station, isPlaying, onPlay, onStop, onEdit, onDelete, onToggleActive }: StationCardProps) {
  return (
    <div
      className={`station-card${isPlaying ? ' station-card--playing' : ''}${!station.active ? ' station-card--inactive' : ''}`}
      style={{
        background: 'var(--surface)',
        borderRadius: 8,
        padding: '1rem',
        border: isPlaying ? '1px solid var(--accent, #60a5fa)' : '1px solid transparent',
        opacity: station.active ? 1 : 0.55,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, marginBottom: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
            <LiveBadge isLive={station.isLive} />
            <span>{station.name}</span>
            {isPlaying && <span style={{ fontSize: '0.75rem', color: 'var(--accent, #60a5fa)', animation: 'pulse 1.5s ease-in-out infinite' }}>▶ Playing</span>}
            {!station.active && <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>(inactive)</span>}
          </div>
          {station.description && (
            <div style={{ fontSize: '0.82rem', opacity: 0.7, marginBottom: '0.4rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {station.description}
            </div>
          )}
          {station.tags.length > 0 && (
            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
              {station.tags.map(tag => (
                <span key={tag} style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.1)', borderRadius: 4, padding: '0.1rem 0.4rem' }}>{tag}</span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.3rem' }}>
            {station.homepageUrl && (
              <a
                href={station.homepageUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '0.78rem', opacity: 0.7, textDecoration: 'none', color: 'inherit' }}
                title="Open station homepage"
              >
                🔗 Homepage
              </a>
            )}
            <span style={{ fontSize: '0.72rem', opacity: 0.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
              {station.streamUrl}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', flexShrink: 0 }}>
          {isPlaying ? (
            <button className="btn btn-primary" onClick={onStop} title="Stop">⏹ Stop</button>
          ) : (
            <button className="btn btn-primary" onClick={onPlay} title="Play" disabled={!station.active}>
              ▶ Play
            </button>
          )}
          <button className="btn" onClick={onEdit} title="Edit" style={{ fontSize: '0.8rem' }}>✏️ Edit</button>
          <button className="btn" onClick={onToggleActive} title={station.active ? 'Deactivate' : 'Activate'} style={{ fontSize: '0.8rem' }}>
            {station.active ? '⏸ Disable' : '✅ Enable'}
          </button>
          <button className="btn" onClick={onDelete} title="Delete" style={{ fontSize: '0.8rem', color: 'var(--error, #f87171)' }}>🗑 Delete</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Main page ----------

export default function RadiosPage() {
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const { playRadio, stop, currentRadio, isPlaying } = useAudioPlayer();

  async function load() {
    setLoading(true);
    try {
      const data = await getRadioStations(showAll);
      setStations(data);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load radio stations');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [showAll]);

  async function handleCreate(data: CreateRadioStationInput) {
    setSaving(true);
    try {
      await createRadioStation(data);
      setShowAdd(false);
      await load();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(idOrSlug: string, data: CreateRadioStationInput) {
    setSaving(true);
    try {
      await updateRadioStation(idOrSlug, data);
      setEditingId(null);
      await load();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(station: RadioStation) {
    if (!confirm(`Delete "${station.name}"?`)) return;
    try {
      await deleteRadioStation(station.id);
      if (currentRadio?.id === station.id) stop();
      await load();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  }

  async function handleToggle(station: RadioStation) {
    try {
      await toggleRadioStation(station.id);
      await load();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  }

  function handlePlay(station: RadioStation) {
    playRadio(station);
  }

  function handleStop() {
    stop();
  }

  const activeCount = stations.filter(s => s.active).length;

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>📻 Radio Stations</h1>
          <p style={{ margin: '0.25rem 0 0', opacity: 0.6, fontSize: '0.9rem' }}>
            {activeCount} active station{activeCount !== 1 ? 's' : ''}
            {showAll && stations.length !== activeCount ? ` / ${stations.length} total` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <label style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
            Show inactive
          </label>
          <button className="btn btn-primary" onClick={() => { setShowAdd(true); setEditingId(null); }}>
            + Add Station
          </button>
        </div>
      </div>

      {showAdd && (
        <StationForm
          onSave={handleCreate}
          onCancel={() => setShowAdd(false)}
          saving={saving}
        />
      )}

      {loading && <p style={{ opacity: 0.6 }}>Loading…</p>}
      {error && <p style={{ color: 'var(--error, #f87171)' }}>{error}</p>}

      {!loading && stations.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem', opacity: 0.5 }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>📻</div>
          <div>No radio stations yet. Add one to get started!</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {stations.map(station =>
          editingId === station.id ? (
            <StationForm
              key={station.id}
              initial={{
                name: station.name,
                streamUrl: station.streamUrl,
                homepageUrl: station.homepageUrl ?? undefined,
                description: station.description ?? undefined,
                isLive: station.isLive,
                tags: station.tags,
              }}
              onSave={data => handleUpdate(station.id, data)}
              onCancel={() => setEditingId(null)}
              saving={saving}
            />
          ) : (
            <StationCard
              key={station.id}
              station={station}
              isPlaying={currentRadio?.id === station.id && isPlaying}
              onPlay={() => handlePlay(station)}
              onStop={handleStop}
              onEdit={() => { setEditingId(station.id); setShowAdd(false); }}
              onDelete={() => handleDelete(station)}
              onToggleActive={() => handleToggle(station)}
            />
          )
        )}
      </div>
    </div>
  );
}
