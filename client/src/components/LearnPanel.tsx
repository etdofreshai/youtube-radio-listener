/**
 * LearnPanel - Shows learning resources (tabs, chords, sheets, tutorials) for a track.
 *
 * Features:
 * - Grouped by type (Guitar Tabs/Chords, Piano/Keys, Sheet Music, Tutorials)
 * - Save/bookmark useful resources
 * - Add manual resources
 * - Loading, empty, and error states
 * - External links clearly labeled
 */

import { useState, useEffect, useCallback } from 'react';
import type {
  Track,
  LearningResource,
  LearningResourceGrouped,
  SearchLearningResourcesResult,
  CreateLearningResourceInput,
  LearningResourceType,
} from '../types';
import * as api from '../api';

interface LearnPanelProps {
  track: Track;
  onClose: () => void;
}

const RESOURCE_TYPE_LABELS: Record<LearningResourceType, { label: string; icon: string }> = {
  'guitar-tabs': { label: 'Guitar Tabs', icon: '🎸' },
  'guitar-chords': { label: 'Guitar Chords', icon: '🎼' },
  'piano-keys': { label: 'Piano / Keys', icon: '🎹' },
  'sheet-music': { label: 'Sheet Music', icon: '📄' },
  'tutorial': { label: 'Tutorials', icon: '📺' },
};

function ResourceTypeBadge({ type }: { type: LearningResourceType }) {
  const info = RESOURCE_TYPE_LABELS[type];
  return (
    <span className="learn-type-badge" title={info.label}>
      {info.icon} {info.label}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string | null }) {
  if (!confidence) return null;
  const colors: Record<string, string> = {
    high: 'var(--success)',
    medium: 'var(--warning)',
    low: 'var(--text-muted)',
  };
  return (
    <span
      className="learn-confidence-badge"
      style={{ backgroundColor: colors[confidence] || 'var(--text-muted)' }}
      title={`Confidence: ${confidence}`}
    >
      {confidence}
    </span>
  );
}

function ResourceCard({
  resource,
  onSave,
  onUnsave,
  onDelete,
}: {
  resource: LearningResource;
  onSave: () => void;
  onUnsave: () => void;
  onDelete: () => void;
}) {
  const [showActions, setShowActions] = useState(false);

  return (
    <div
      className={`learn-resource-card ${resource.isSaved ? 'saved' : ''}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className="learn-resource-header">
        <a
          href={resource.url}
          target="_blank"
          rel="noopener noreferrer"
          className="learn-resource-title"
        >
          {resource.title}
        </a>
        {resource.isSaved && <span className="learn-saved-badge">★ Saved</span>}
      </div>

      <div className="learn-resource-meta">
        <ResourceTypeBadge type={resource.resourceType} />
        <ConfidenceBadge confidence={resource.confidence} />
        <span className="learn-provider">via {resource.provider}</span>
      </div>

      {resource.snippet && (
        <p className="learn-resource-snippet">{resource.snippet}</p>
      )}

      <div className="learn-resource-actions" style={{ opacity: showActions ? 1 : 0 }}>
        <a
          href={resource.url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-sm btn-primary"
        >
          Open ↗
        </a>
        {resource.isSaved ? (
          <button className="btn btn-sm btn-secondary" onClick={onUnsave}>
            Unsave
          </button>
        ) : (
          <button className="btn btn-sm btn-secondary" onClick={onSave}>
            Save
          </button>
        )}
        <button className="btn btn-sm btn-danger" onClick={onDelete}>
          ✕
        </button>
      </div>

      <p className="learn-external-notice">
        🔗 External link — opens in new tab
      </p>
    </div>
  );
}

function ResourceSection({
  title,
  icon,
  resources,
  onResourceAction,
}: {
  title: string;
  icon: string;
  resources: LearningResource[];
  onResourceAction: (resourceId: string, action: 'save' | 'unsave' | 'delete') => void;
}) {
  if (resources.length === 0) return null;

  return (
    <div className="learn-section">
      <h4 className="learn-section-title">
        {icon} {title}
        <span className="learn-section-count">({resources.length})</span>
      </h4>
      <div className="learn-resources-grid">
        {resources.map(r => (
          <ResourceCard
            key={r.id}
            resource={r}
            onSave={() => onResourceAction(r.id, 'save')}
            onUnsave={() => onResourceAction(r.id, 'unsave')}
            onDelete={() => onResourceAction(r.id, 'delete')}
          />
        ))}
      </div>
    </div>
  );
}

function AddResourceForm({
  trackId,
  onAdded,
  onCancel,
}: {
  trackId: string;
  onAdded: (resource: LearningResource) => void;
  onCancel: () => void;
}) {
  const [resourceType, setResourceType] = useState<LearningResourceType>('guitar-chords');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [provider, setProvider] = useState('');
  const [snippet, setSnippet] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !url.trim()) {
      setError('Title and URL are required');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      // Auto-extract provider from URL if not provided
      let finalProvider = provider.trim();
      if (!finalProvider) {
        try {
          const urlObj = new URL(url);
          finalProvider = urlObj.hostname.replace(/^www\./, '');
        } catch {
          finalProvider = 'unknown';
        }
      }

      const resource = await api.addLearningResource(trackId, {
        resourceType,
        title: title.trim(),
        url: url.trim(),
        provider: finalProvider,
        snippet: snippet.trim() || undefined,
      });

      onAdded(resource);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add resource');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="learn-add-form">
      <h5>Add Learning Resource</h5>
      {error && <p className="error">{error}</p>}

      <div className="form-group">
        <label>Type</label>
        <select value={resourceType} onChange={e => setResourceType(e.target.value as LearningResourceType)}>
          {Object.entries(RESOURCE_TYPE_LABELS).map(([type, info]) => (
            <option key={type} value={type}>
              {info.icon} {info.label}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Title *</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g., Guitar Tab - Ultimate Guitar"
        />
      </div>

      <div className="form-group">
        <label>URL *</label>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://..."
          type="url"
        />
      </div>

      <div className="form-group">
        <label>Provider (optional)</label>
        <input
          value={provider}
          onChange={e => setProvider(e.target.value)}
          placeholder="Auto-detected from URL"
        />
      </div>

      <div className="form-group">
        <label>Description (optional)</label>
        <textarea
          value={snippet}
          onChange={e => setSnippet(e.target.value)}
          placeholder="Brief description of this resource"
          rows={2}
        />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Adding...' : 'Add Resource'}
        </button>
      </div>
    </form>
  );
}

export default function LearnPanel({ track, onClose }: LearnPanelProps) {
  const [result, setResult] = useState<SearchLearningResourcesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const loadResources = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getLearningResources(track.id, refresh);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load resources');
    } finally {
      setLoading(false);
    }
  }, [track.id]);

  useEffect(() => {
    loadResources();
  }, [loadResources]);

  const handleResourceAction = async (resourceId: string, action: 'save' | 'unsave' | 'delete') => {
    try {
      if (action === 'save') {
        const updated = await api.saveLearningResource(track.id, resourceId);
        updateResourceInState(updated);
      } else if (action === 'unsave') {
        const updated = await api.unsaveLearningResource(track.id, resourceId);
        updateResourceInState(updated);
      } else if (action === 'delete') {
        await api.deleteLearningResource(track.id, resourceId);
        removeResourceFromState(resourceId);
      }
    } catch (err) {
      console.error('Resource action failed:', err);
    }
  };

  const updateResourceInState = (updated: LearningResource) => {
    if (!result) return;
    const updateGroup = (resources: LearningResource[]) =>
      resources.map(r => (r.id === updated.id ? updated : r));

    setResult({
      ...result,
      resources: {
        guitarTabs: updateGroup(result.resources.guitarTabs),
        guitarChords: updateGroup(result.resources.guitarChords),
        pianoKeys: updateGroup(result.resources.pianoKeys),
        sheetMusic: updateGroup(result.resources.sheetMusic),
        tutorials: updateGroup(result.resources.tutorials),
      },
    });
  };

  const removeResourceFromState = (resourceId: string) => {
    if (!result) return;
    const filterGroup = (resources: LearningResource[]) =>
      resources.filter(r => r.id !== resourceId);

    setResult({
      ...result,
      resources: {
        guitarTabs: filterGroup(result.resources.guitarTabs),
        guitarChords: filterGroup(result.resources.guitarChords),
        pianoKeys: filterGroup(result.resources.pianoKeys),
        sheetMusic: filterGroup(result.resources.sheetMusic),
        tutorials: filterGroup(result.resources.tutorials),
      },
    });
  };

  const handleResourceAdded = (resource: LearningResource) => {
    setShowAddForm(false);
    // Add to appropriate group
    if (!result) return;
    const group = resource.resourceType === 'guitar-tabs' ? 'guitarTabs'
      : resource.resourceType === 'guitar-chords' ? 'guitarChords'
      : resource.resourceType === 'piano-keys' ? 'pianoKeys'
      : resource.resourceType === 'sheet-music' ? 'sheetMusic'
      : 'tutorials';

    setResult({
      ...result,
      resources: {
        ...result.resources,
        [group]: [resource, ...result.resources[group]],
      },
    });
  };

  const totalResources = result
    ? result.resources.guitarTabs.length +
      result.resources.guitarChords.length +
      result.resources.pianoKeys.length +
      result.resources.sheetMusic.length +
      result.resources.tutorials.length
    : 0;

  return (
    <div className="learn-panel">
      <div className="learn-panel-header">
        <h3>
          🎸 Learn to Play
          <span className="learn-track-title">: {track.title}</span>
        </h3>
        <button className="btn btn-sm btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>

      <p className="learn-description">
        Find tabs, chords, sheet music, and tutorials for <strong>{track.title}</strong> by <strong>{track.artist}</strong>.
        All links open externally.
      </p>

      <div className="learn-panel-actions">
        <button
          className="btn btn-sm btn-secondary"
          onClick={() => loadResources(true)}
          disabled={loading}
        >
          {loading ? 'Searching...' : '🔄 Refresh Search'}
        </button>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => setShowAddForm(true)}
        >
          + Add Resource
        </button>
      </div>

      {result?.cached && (
        <p className="learn-cache-notice">
          💾 Showing cached results from {new Date(result.searchedAt).toLocaleDateString()}
        </p>
      )}

      {loading && !result && (
        <div className="learn-loading">
          <div className="spinner"></div>
          <p>Searching for learning resources...</p>
        </div>
      )}

      {error && (
        <div className="learn-error">
          <p>⚠️ {error}</p>
          <button className="btn btn-sm btn-secondary" onClick={() => loadResources()}>
            Try Again
          </button>
        </div>
      )}

      {!loading && !error && result && totalResources === 0 && (
        <div className="learn-empty">
          <p>No learning resources found for this track.</p>
          <p>Try adding one manually or refresh the search.</p>
        </div>
      )}

      {result && totalResources > 0 && (
        <div className="learn-results">
          <ResourceSection
            title="Guitar Tabs"
            icon="🎸"
            resources={result.resources.guitarTabs}
            onResourceAction={handleResourceAction}
          />
          <ResourceSection
            title="Guitar Chords"
            icon="🎼"
            resources={result.resources.guitarChords}
            onResourceAction={handleResourceAction}
          />
          <ResourceSection
            title="Piano / Keys"
            icon="🎹"
            resources={result.resources.pianoKeys}
            onResourceAction={handleResourceAction}
          />
          <ResourceSection
            title="Sheet Music"
            icon="📄"
            resources={result.resources.sheetMusic}
            onResourceAction={handleResourceAction}
          />
          <ResourceSection
            title="Tutorials"
            icon="📺"
            resources={result.resources.tutorials}
            onResourceAction={handleResourceAction}
          />
        </div>
      )}

      {showAddForm && (
        <div className="modal-overlay" onClick={() => setShowAddForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <AddResourceForm
              trackId={track.id}
              onAdded={handleResourceAdded}
              onCancel={() => setShowAddForm(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
