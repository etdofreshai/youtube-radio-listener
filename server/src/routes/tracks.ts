import { Router } from 'express';
import * as store from '../store';
import { downloadTrackAudio, refreshTrackAudio, downloadTrackVideo, deleteTrackAudio, deleteTrackVideo } from '../downloader';
import { enrichTrack, enrichTrackSync, enrichAllTracks, listProviders, budgetTracker } from '../services/enrichment';
import { getSchedulerStatus, forceTick, startScheduler, stopScheduler } from '../services/scheduler';
import {
  fetchYouTubeMetadata,
  parseArtistTitle,
  isValidYouTubeUrl,
  searchYouTube,
  analyzeYouTubeUrl,
  fetchYouTubePlaylistItems,
  type YouTubePlaylistItem,
} from '../services/youtube-metadata';
import { importPlaylistTracks } from '../services/playlist-import';
import { fetchLyrics } from '../services/lyrics';
import type {
  Track,
  CreateTrackInput,
  UpdateTrackInput,
  CreateVariantInput,
  UpdateVariantInput,
  SortableTrackField,
  SortDirection,
  LinkTrackInput,
  SetPreferredLinkedTrackInput,
} from '../types';

const router = Router();

/** Resolve actor user ID from request (header or default) */
function getActorId(req: any): string {
  return req.headers['x-user-id'] as string || '00000000-0000-0000-0000-000000000001';
}

function paramId(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

const SORTABLE_FIELDS: SortableTrackField[] = [
  'artist', 'title', 'youtubeUrl', 'createdAt', 'updatedAt',
  'duration', 'verified', 'album', 'genre', 'releaseYear',
];

const DEFAULT_PLAYLIST_IMPORT_LIMIT = 100;
const MAX_PLAYLIST_IMPORT_LIMIT = 500;

function playlistImportLimit(): number {
  const raw = parseInt(process.env.PLAYLIST_IMPORT_MAX_ITEMS || '', 10);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.min(MAX_PLAYLIST_IMPORT_LIMIT, raw);
  }
  return DEFAULT_PLAYLIST_IMPORT_LIMIT;
}

type TrackCreateOutcome =
  | { kind: 'created'; track: Track }
  | { kind: 'response'; status: number; body: Record<string, unknown> };

async function createTrackWithPipeline(
  req: any,
  input: CreateTrackInput,
  options?: { detectDuplicates?: boolean; forceCreate?: boolean; linkToTrackId?: string },
): Promise<TrackCreateOutcome> {
  const { youtubeUrl, title, artist, artistIds, startTimeSec, endTimeSec, volume, notes } = input;
  let { isLiveStream } = input;

  if (!youtubeUrl) {
    return { kind: 'response', status: 400, body: { error: 'youtubeUrl is required' } };
  }

  if (volume != null && (volume < 0 || volume > 200)) {
    return { kind: 'response', status: 400, body: { error: 'volume must be between 0 and 200' } };
  }

  // Check for duplicate video ID across existing variants
  const videoId = store.extractVideoId(youtubeUrl);
  if (videoId && videoId !== 'unknown') {
    const existingVariant = await store.findVariantByVideoId(videoId);
    if (existingVariant) {
      const existingTrack = await store.getTrack(existingVariant.trackId);
      return {
        kind: 'response',
        status: 409,
        body: {
          error: 'This YouTube video already exists as a variant',
          existingTrack,
          existingVariant,
        },
      };
    }
  }

  // Determine title and artist — prefer user-provided, fall back to YouTube metadata
  let resolvedTitle = title?.trim() || '';
  let resolvedArtist = artist?.trim() || '';
  let fetchedIsLive: boolean | undefined;

  if (!resolvedTitle || !resolvedArtist) {
    // Need to fetch metadata from YouTube
    if (!isValidYouTubeUrl(youtubeUrl)) {
      return {
        kind: 'response',
        status: 400,
        body: { error: 'Invalid YouTube URL. Provide a valid URL or supply title and artist manually.' },
      };
    }

    try {
      const ytInfo = await fetchYouTubeMetadata(youtubeUrl);
      const parsed = parseArtistTitle(ytInfo.videoTitle, ytInfo.channel);

      if (!resolvedTitle) resolvedTitle = parsed.title;
      if (!resolvedArtist) resolvedArtist = parsed.artist;

      fetchedIsLive = ytInfo.isLive;

      // Auto-detect live stream if not explicitly set
      if (isLiveStream === undefined && ytInfo.isLive) {
        isLiveStream = true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[tracks] YouTube metadata fetch failed:', msg);
      return {
        kind: 'response',
        status: 422,
        body: {
          error: 'Could not extract metadata from YouTube URL. Provide title and artist manually.',
          detail: msg,
        },
      };
    }
  }

  // If metadata fetch wasn't needed for title/artist, still attempt live detection.
  if (isLiveStream === undefined && fetchedIsLive === undefined && isValidYouTubeUrl(youtubeUrl)) {
    try {
      const ytInfo = await fetchYouTubeMetadata(youtubeUrl);
      isLiveStream = ytInfo.isLive;
    } catch {
      // Best effort only — do not block track creation on detection failures.
    }
  }

  // Canonical identity detection: check if a track with same title+artist exists.
  // De-duplicate suggestions by trackGroupId to avoid noisy repeats.
  const detectDuplicates = options?.detectDuplicates ?? true;
  const forceCreate = options?.forceCreate ?? false;
  if (detectDuplicates && !forceCreate && store.isPostgres()) {
    const matches = await store.findTracksByCanonicalIdentity(resolvedTitle, resolvedArtist);
    if (matches.length > 0) {
      const hydrated = (await Promise.all(matches.map(m => store.getTrack(m.id))))
        .filter(Boolean) as any[];

      const seen = new Set<string>();
      const deduped: any[] = [];
      for (const t of hydrated) {
        const key = t.trackGroupId || t.id;
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(t);
        }
      }

      return {
        kind: 'response',
        status: 200,
        body: {
          potentialMatch: deduped[0] || hydrated[0],
          potentialMatches: deduped,
          resolvedTitle,
          resolvedArtist,
          youtubeUrl,
          message: 'A track with the same title and artist already exists. Add as variant, link to existing, or force-create a new standalone track.',
        },
      };
    }
  }

  const track = await store.createTrack({
    youtubeUrl,
    title: resolvedTitle,
    artist: resolvedArtist,
    artistIds,
    startTimeSec,
    endTimeSec,
    volume,
    notes,
    isLiveStream: isLiveStream ?? false,
  });

  if (options?.linkToTrackId && store.isPostgres()) {
    try {
      await store.linkTracks(track.id, options.linkToTrackId);
    } catch (err) {
      console.warn(`[tracks] Could not auto-link new track ${track.id} to ${options.linkToTrackId}:`, err);
    }
  }

  // Record event
  const userId = getActorId(req);
  store.recordEvent('track.created', {
    userId,
    entityType: 'track',
    entityId: track.id,
    metadata: { title: track.title, artist: track.artist, youtubeUrl: track.youtubeUrl, isLiveStream: track.isLiveStream },
  }).catch(() => {});

  // Auto-download audio (skip for live streams — they stream at play time)
  if (!track.isLiveStream) {
    downloadTrackAudio(track.id).catch(err => {
      console.error(`[tracks] Auto-download failed for ${track.id}:`, err);
    });
  }

  // Auto-enrich via queue (Stage A)
  enrichTrack(track.id);

  return { kind: 'created', track };
}

function buildPlaylistTrackInput(base: CreateTrackInput, item: YouTubePlaylistItem): CreateTrackInput {
  return {
    youtubeUrl: item.youtubeUrl,
    title: item.title?.trim() || undefined,
    artist: item.channel?.trim() || undefined,
    artistIds: base.artistIds,
    startTimeSec: base.startTimeSec,
    endTimeSec: base.endTimeSec,
    volume: base.volume,
    notes: base.notes,
  };
}

// ============================================================
// Static routes (before /:id to avoid param capture)
// ============================================================

// GET /api/tracks/enrichment/providers
router.get('/enrichment/providers', (_req, res) => {
  res.json(listProviders());
});

// GET /api/tracks/enrichment/status — scheduler + queue status
router.get('/enrichment/status', async (_req, res) => {
  res.json(await getSchedulerStatus());
});

// GET /api/tracks/search-youtube?q=...&maxResults=10
router.get('/search-youtube', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) {
    res.status(400).json({ error: 'q (query) is required' });
    return;
  }
  if (q.length > 200) {
    res.status(400).json({ error: 'q (query) is too long (max 200 chars)' });
    return;
  }

  const maxResultsRaw = parseInt(String(req.query.maxResults || '10'), 10);
  const maxResults = Number.isFinite(maxResultsRaw) ? Math.min(Math.max(maxResultsRaw, 1), 20) : 10;

  try {
    const results = await searchYouTube(q, maxResults);
    res.json({ query: q, results, maxResults });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg || 'YouTube search failed' });
  }
});

// GET /api/tracks (paginated)
router.get('/', async (req, res) => {
  const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(String(req.query.pageSize || '50'), 10) || 50, 1), 200);

  const sortByRaw = typeof req.query.sortBy === 'string' ? req.query.sortBy : 'createdAt';
  const sortDirRaw = typeof req.query.sortDir === 'string' ? req.query.sortDir : 'desc';

  const sortBy: SortableTrackField = SORTABLE_FIELDS.includes(sortByRaw as SortableTrackField)
    ? (sortByRaw as SortableTrackField)
    : 'createdAt';
  const sortDir: SortDirection = sortDirRaw === 'asc' ? 'asc' : 'desc';

  const search = typeof req.query.query === 'string'
    ? req.query.query
    : typeof req.query.search === 'string'
      ? req.query.search
      : undefined;

  const data = await store.getTracksPaginated({ page, pageSize, sortBy, sortDir, search });
  res.json(data);
});

// POST /api/tracks
router.post('/', async (req, res) => {
  const input = req.body as CreateTrackInput;
  const youtubeUrl = input.youtubeUrl?.trim();

  if (!youtubeUrl) {
    res.status(400).json({ error: 'youtubeUrl is required' });
    return;
  }

  const detectDuplicates = req.query.detectDuplicates !== 'false';
  const forceCreate = req.query.forceCreate === 'true';
  const linkToTrackId = typeof req.query.linkToTrackId === 'string' ? req.query.linkToTrackId : undefined;

  const urlAnalysis = analyzeYouTubeUrl(youtubeUrl);
  if (urlAnalysis.kind === 'invalid') {
    const outcome = await createTrackWithPipeline(req, { ...input, youtubeUrl }, {
      detectDuplicates,
      forceCreate,
      linkToTrackId,
    });
    if (outcome.kind === 'created') {
      res.status(201).json(outcome.track);
    } else {
      res.status(outcome.status).json(outcome.body);
    }
    return;
  }

  if (urlAnalysis.kind === 'playlist') {
    const maxItems = playlistImportLimit();

    try {
      const playlistInfo = await fetchYouTubePlaylistItems(youtubeUrl, { maxItems });

      const importResult = await importPlaylistTracks(playlistInfo, {
        findExistingByVideoId: async (videoId: string) => store.findVariantByVideoId(videoId),
        createTrackForItem: async (item: YouTubePlaylistItem) => {
          const outcome = await createTrackWithPipeline(
            req,
            buildPlaylistTrackInput(input, item),
            {
              detectDuplicates: false,
              forceCreate: true,
              linkToTrackId,
            },
          );

          if (outcome.kind !== 'created') {
            const body = outcome.body as Record<string, unknown>;
            const detail = typeof body.detail === 'string' ? body.detail : '';
            const msg = typeof body.error === 'string' ? body.error : 'Failed to create track';
            throw new Error(detail ? `${msg}: ${detail}` : msg);
          }

          return outcome.track;
        },
      });

      res.status(200).json(importResult);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[tracks] Playlist import failed:', msg);
      res.status(422).json({
        error: 'Could not import playlist',
        detail: msg,
      });
      return;
    }
  }

  const outcome = await createTrackWithPipeline(req, { ...input, youtubeUrl }, {
    detectDuplicates,
    forceCreate,
    linkToTrackId,
  });

  if (outcome.kind === 'created') {
    res.status(201).json(outcome.track);
  } else {
    res.status(outcome.status).json(outcome.body);
  }
});

// GET /api/tracks/:id
router.get('/:id', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  if (!track) {
    res.status(404).json({ error: 'Track not found' });
    return;
  }
  res.json(track);
});

// PUT /api/tracks/:id
router.put('/:id', async (req, res) => {
  const id = paramId(req.params.id);
  const input = req.body as UpdateTrackInput;
  if (input.volume != null && (input.volume < 0 || input.volume > 200)) {
    res.status(400).json({ error: 'volume must be between 0 and 200' });
    return;
  }

  const existing = await store.getTrack(id);
  if (!existing) { res.status(404).json({ error: 'Track not found' }); return; }

  // If URL changed and mode wasn't explicitly set, auto-detect live mode from YouTube metadata.
  if (input.youtubeUrl && input.isLiveStream === undefined && isValidYouTubeUrl(input.youtubeUrl)) {
    try {
      const ytInfo = await fetchYouTubeMetadata(input.youtubeUrl);
      input.isLiveStream = ytInfo.isLive;
    } catch {
      // Best effort only — don't block updates on detection failure.
    }
  }

  // Pass the full input including artistIds and albumId
  const updatedTrack = await store.updateTrack(id, input);
  if (!updatedTrack) { res.status(404).json({ error: 'Track not found' }); return; }

  // Record event
  const userId = getActorId(req);
  store.recordEvent('track.updated', {
    userId,
    entityType: 'track',
    entityId: updatedTrack.id,
    metadata: { changes: Object.keys(input) },
  }).catch(() => {});

  const modeChanged = input.isLiveStream !== undefined && input.isLiveStream !== existing.isLiveStream;

  if (input.youtubeUrl || modeChanged) {
    if (updatedTrack.isLiveStream) {
      // Stream-only mode: clear download artifacts and mark ready
      deleteTrackAudio(updatedTrack.id);
      await store.updateTrackAudio(updatedTrack.id, {
        audioStatus: 'ready',
        audioFilename: null,
        audioError: null,
        duration: null,
        lastDownloadAt: null,
      });
    } else {
      // Downloaded mode: refresh local file when URL or mode changes
      refreshTrackAudio(updatedTrack.id).catch(err => {
        console.error(`[tracks] Re-download failed for ${updatedTrack.id}:`, err);
      });
    }

    // URL or mode changed → re-enrich from scratch
    await store.updateTrackMetadata(updatedTrack.id, {
      enrichmentStatus: 'none',
      stageACompletedAt: null,
      stageBCompletedAt: null,
      enrichmentAttempts: 0,
    });
    enrichTrack(updatedTrack.id);

    // Return latest track snapshot after audio state adjustment
    const latest = await store.getTrack(updatedTrack.id);
    res.json(latest || updatedTrack);
    return;
  }

  res.json(updatedTrack);
});

// DELETE /api/tracks/:id
router.delete('/:id', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  const deleted = await store.deleteTrack(id);
  if (!deleted) { res.status(404).json({ error: 'Track not found' }); return; }

  // Clean up local media files
  deleteTrackAudio(id);
  deleteTrackVideo(id);

  // Record event
  const userId = getActorId(req);
  store.recordEvent('track.deleted', {
    userId,
    entityType: 'track',
    entityId: id,
    metadata: { title: track?.title, artist: track?.artist },
  }).catch(() => {});

  res.status(204).send();
});

// ============================================================
// Audio actions
// ============================================================

router.post('/:id/download', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }
  if (track.isLiveStream) { res.status(400).json({ error: 'Live stream tracks cannot be downloaded' }); return; }

  store.recordEvent('track.download_started', {
    userId: getActorId(req),
    entityType: 'track',
    entityId: id,
  }).catch(() => {});

  downloadTrackAudio(id).catch(err => console.error(`[tracks] Download failed for ${id}:`, err));
  res.json(await store.getTrack(id));
});

router.post('/:id/refresh', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }
  if (track.isLiveStream) { res.status(400).json({ error: 'Live stream tracks cannot be re-downloaded' }); return; }

  store.recordEvent('track.refresh_started', {
    userId: getActorId(req),
    entityType: 'track',
    entityId: id,
  }).catch(() => {});

  refreshTrackAudio(id).catch(err => console.error(`[tracks] Refresh failed for ${id}:`, err));
  res.json(await store.getTrack(id));
});

// ============================================================
// Video actions
// ============================================================

router.post('/:id/download-video', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  store.recordEvent('track.video_download_started', {
    userId: getActorId(req),
    entityType: 'track',
    entityId: id,
  }).catch(() => {});

  downloadTrackVideo(id).catch(err => console.error(`[tracks] Video download failed for ${id}:`, err));
  // Return track immediately (videoStatus will be 'downloading')
  res.json(await store.getTrack(id));
});

// ============================================================
// Lyrics
// ============================================================

// GET /api/tracks/:id/lyrics — get cached lyrics or return null
router.get('/:id/lyrics', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }
  res.json({ lyrics: track.lyrics, lyricsSource: track.lyricsSource });
});

// POST /api/tracks/:id/fetch-lyrics — fetch and cache lyrics
router.post('/:id/fetch-lyrics', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  // If already have lyrics, return them
  if (track.lyrics) {
    res.json({ lyrics: track.lyrics, lyricsSource: track.lyricsSource, cached: true });
    return;
  }

  try {
    const result = await fetchLyrics(id);
    if (result) {
      await store.updateTrackLyrics(id, result.lyrics, result.source);
      store.recordEvent('track.lyrics_fetched', {
        userId: getActorId(req),
        entityType: 'track',
        entityId: id,
        metadata: { source: result.source, length: result.lyrics.length },
      }).catch(() => {});
      res.json({ lyrics: result.lyrics, lyricsSource: result.source, cached: false });
    } else {
      res.json({ lyrics: null, lyricsSource: null, cached: false });
    }
  } catch (err) {
    console.error(`[tracks] Lyrics fetch failed for ${id}:`, err);
    res.status(500).json({ error: 'Lyrics fetch failed' });
  }
});

// ============================================================
// Verification
// ============================================================

router.post('/:id/verify', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  const { verified, verifiedBy } = req.body || {};
  const newVerified = typeof verified === 'boolean' ? verified : !track.verified;

  const updated = await store.verifyTrack(id, newVerified, verifiedBy || null);
  if (!updated) { res.status(404).json({ error: 'Track not found' }); return; }

  store.recordEvent(newVerified ? 'track.verified' : 'track.unverified', {
    userId: getActorId(req),
    entityType: 'track',
    entityId: id,
    metadata: { verifiedBy: verifiedBy || null },
  }).catch(() => {});

  res.json(updated);
});

// ============================================================
// Enrichment (single track)
// ============================================================

// POST /api/tracks/:id/enrich — synchronous enrichment (waits for result)
router.post('/:id/enrich', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  store.recordEvent('track.enrich_started', {
    userId: getActorId(req),
    entityType: 'track',
    entityId: id,
  }).catch(() => {});

  try {
    const enriched = await enrichTrackSync(id);
    res.json(enriched);
  } catch (err) {
    console.error(`[tracks] Enrichment failed for ${id}:`, err);
    res.status(500).json({ error: 'Enrichment failed' });
  }
});

// ============================================================
// Track links / groups
// ============================================================

// GET /api/tracks/:id/links
router.get('/:id/links', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  if (!store.isPostgres()) {
    res.status(501).json({ error: 'Track linking requires PostgreSQL' });
    return;
  }

  const linkedTracks = await store.getLinkedTracks(id);
  const group = await store.getTrackGroup(id);
  res.json({
    trackId: id,
    trackGroupId: group?.id || null,
    group,
    linkedTracks,
  });
});

// POST /api/tracks/:id/links
router.post('/:id/links', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  if (!store.isPostgres()) {
    res.status(501).json({ error: 'Track linking requires PostgreSQL' });
    return;
  }

  const body = req.body as LinkTrackInput;
  const targetTrackId = body.targetTrackId;
  const groupName = body.groupName;

  if (!targetTrackId) {
    res.status(400).json({ error: 'targetTrackId is required' });
    return;
  }

  try {
    const group = await store.linkTracks(id, targetTrackId, groupName);

    store.recordEvent('track.linked', {
      userId: getActorId(req),
      entityType: 'track',
      entityId: id,
      metadata: { targetTrackId, trackGroupId: group.id, groupName: group.name || null },
    }).catch(() => {});

    // Return fresh track with linkedTracks populated
    const updated = await store.getTrack(id);
    res.json({ track: updated, group });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg || 'Failed to link tracks' });
  }
});

// DELETE /api/tracks/:id/links/:targetTrackId
router.delete('/:id/links/:targetTrackId', async (req, res) => {
  const id = paramId(req.params.id);
  const targetTrackId = paramId(req.params.targetTrackId);

  if (!store.isPostgres()) {
    res.status(501).json({ error: 'Track linking requires PostgreSQL' });
    return;
  }

  try {
    const removed = await store.unlinkTracks(id, targetTrackId);
    if (!removed) {
      res.status(404).json({ error: 'Link not found' });
      return;
    }

    store.recordEvent('track.unlinked', {
      userId: getActorId(req),
      entityType: 'track',
      entityId: id,
      metadata: { targetTrackId },
    }).catch(() => {});

    res.status(204).send();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg || 'Failed to unlink tracks' });
  }
});

// POST /api/tracks/:id/links/preferred
router.post('/:id/links/preferred', async (req, res) => {
  const id = paramId(req.params.id);

  if (!store.isPostgres()) {
    res.status(501).json({ error: 'Track linking requires PostgreSQL' });
    return;
  }

  const body = req.body as SetPreferredLinkedTrackInput;
  const preferredTrackId = body.preferredTrackId;
  if (!preferredTrackId) {
    res.status(400).json({ error: 'preferredTrackId is required' });
    return;
  }

  try {
    const group = await store.setPreferredLinkedTrack(id, preferredTrackId);
    if (!group) {
      res.status(404).json({ error: 'Track group not found or preferred track is not in group' });
      return;
    }

    store.recordEvent('track.link_preferred_set', {
      userId: getActorId(req),
      entityType: 'track',
      entityId: id,
      metadata: { preferredTrackId, trackGroupId: group.id },
    }).catch(() => {});

    res.json(group);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg || 'Failed to set preferred linked track' });
  }
});

// GET /api/tracks/:id/playback-source
router.get('/:id/playback-source', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  if (!track) {
    res.status(404).json({ error: 'Track not found' });
    return;
  }

  if (!store.isPostgres()) {
    res.json({ requestedTrackId: id, preferredTrackId: id, track });
    return;
  }

  const preferred = await store.getPreferredPlaybackTrack(id);
  if (!preferred) {
    res.status(404).json({ error: 'Track not found' });
    return;
  }

  res.json({
    requestedTrackId: id,
    preferredTrackId: preferred.id,
    track: preferred,
  });
});

// ============================================================
// Variants
// ============================================================

// GET /api/tracks/:id/variants
router.get('/:id/variants', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }
  const variants = await store.getVariants(id);
  res.json(variants);
});

// POST /api/tracks/:id/variants — add a variant
router.post('/:id/variants', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  const input = req.body as CreateVariantInput;
  if (!input.youtubeUrl) {
    res.status(400).json({ error: 'youtubeUrl is required' });
    return;
  }

  // Check for duplicate video ID
  const videoId = store.extractVideoId(input.youtubeUrl);
  if (videoId && videoId !== 'unknown') {
    const existingVariant = await store.findVariantByVideoId(videoId);
    if (existingVariant) {
      res.status(409).json({
        error: 'This YouTube video already exists as a variant',
        existingVariant,
      });
      return;
    }
  }

  try {
    const variant = await store.createVariant(id, input);

    const userId = getActorId(req);
    store.recordEvent('variant.created', {
      userId,
      entityType: 'track',
      entityId: id,
      metadata: { variantId: variant.id, kind: variant.kind, youtubeUrl: variant.youtubeUrl },
    }).catch(() => {});

    res.status(201).json(variant);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[tracks] Create variant failed for ${id}:`, msg);
    res.status(500).json({ error: 'Failed to create variant', detail: msg });
  }
});

// PUT /api/tracks/:id/variants/:variantId — update a variant
router.put('/:id/variants/:variantId', async (req, res) => {
  const trackId = paramId(req.params.id);
  const variantId = paramId(req.params.variantId);
  const input = req.body as UpdateVariantInput;

  try {
    const variant = await store.updateVariant(trackId, variantId, input);
    if (!variant) { res.status(404).json({ error: 'Variant not found' }); return; }

    const userId = getActorId(req);
    store.recordEvent('variant.updated', {
      userId,
      entityType: 'track',
      entityId: trackId,
      metadata: { variantId, changes: Object.keys(input) },
    }).catch(() => {});

    res.json(variant);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to update variant', detail: msg });
  }
});

// DELETE /api/tracks/:id/variants/:variantId — remove a variant
router.delete('/:id/variants/:variantId', async (req, res) => {
  const trackId = paramId(req.params.id);
  const variantId = paramId(req.params.variantId);

  try {
    const deleted = await store.deleteVariant(trackId, variantId);
    if (!deleted) { res.status(404).json({ error: 'Variant not found' }); return; }

    const userId = getActorId(req);
    store.recordEvent('variant.deleted', {
      userId,
      entityType: 'track',
      entityId: trackId,
      metadata: { variantId },
    }).catch(() => {});

    res.status(204).send();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Cannot delete the last variant')) {
      res.status(400).json({ error: msg });
    } else {
      res.status(500).json({ error: 'Failed to delete variant', detail: msg });
    }
  }
});

// POST /api/tracks/:id/variants/:variantId/prefer — set as preferred
router.post('/:id/variants/:variantId/prefer', async (req, res) => {
  const trackId = paramId(req.params.id);
  const variantId = paramId(req.params.variantId);

  try {
    const variant = await store.setPreferredVariant(trackId, variantId);
    if (!variant) { res.status(404).json({ error: 'Variant not found' }); return; }

    const userId = getActorId(req);
    store.recordEvent('variant.preferred', {
      userId,
      entityType: 'track',
      entityId: trackId,
      metadata: { variantId, youtubeUrl: variant.youtubeUrl },
    }).catch(() => {});

    // Re-download audio with the new preferred URL
    refreshTrackAudio(trackId).catch(err => {
      console.error(`[tracks] Re-download after variant switch failed for ${trackId}:`, err);
    });

    // Return updated track with all variants
    const updatedTrack = await store.getTrack(trackId);
    res.json(updatedTrack);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to set preferred variant', detail: msg });
  }
});

// ============================================================
// Learning Resources (Learn/Play)
// ============================================================

import { searchLearningResources } from '../services/learn';
import type { LearningResource, CreateLearningResourceInput } from '../types';

// GET /api/tracks/:id/learn — get learning resources for a track
router.get('/:id/learn', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  if (!store.isPostgres()) {
    res.status(501).json({ error: 'Learning resources require PostgreSQL' });
    return;
  }

  const refresh = req.query.refresh === 'true';

  try {
    // If refresh=true, clear cache first
    if (refresh) {
      await store.clearCachedLearningResources(id);
    }

    const result = await searchLearningResources(id);

    store.recordEvent('track.learn_searched', {
      userId: getActorId(req),
      entityType: 'track',
      entityId: id,
      metadata: { cached: result.cached, searchQuery: result.searchQuery },
    }).catch(() => {});

    res.json(result);
  } catch (err) {
    console.error(`[tracks] Learn search failed for ${id}:`, err);
    res.status(500).json({ error: 'Learning resource search failed' });
  }
});

// GET /api/tracks/:id/learn/saved — get saved/bookmarked learning resources
router.get('/:id/learn/saved', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  if (!store.isPostgres()) {
    res.status(501).json({ error: 'Learning resources require PostgreSQL' });
    return;
  }

  const resources = await store.getSavedLearningResources(id);
  res.json(resources);
});

// POST /api/tracks/:id/learn — add a manual learning resource
router.post('/:id/learn', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  if (!store.isPostgres()) {
    res.status(501).json({ error: 'Learning resources require PostgreSQL' });
    return;
  }

  const input = req.body as CreateLearningResourceInput;

  // Validate required fields
  if (!input.resourceType || !input.title || !input.provider || !input.url) {
    res.status(400).json({ error: 'resourceType, title, provider, and url are required' });
    return;
  }

  const validTypes = ['guitar-tabs', 'guitar-chords', 'piano-keys', 'sheet-music', 'tutorial'];
  if (!validTypes.includes(input.resourceType)) {
    res.status(400).json({ error: `resourceType must be one of: ${validTypes.join(', ')}` });
    return;
  }

  try {
    const resource = await store.createLearningResource(id, input);

    store.recordEvent('track.learn_resource_added', {
      userId: getActorId(req),
      entityType: 'track',
      entityId: id,
      metadata: { resourceId: resource.id, resourceType: resource.resourceType, url: resource.url },
    }).catch(() => {});

    res.status(201).json(resource);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to create learning resource', detail: msg });
  }
});

// POST /api/tracks/:id/learn/:resourceId/save — bookmark a learning resource
router.post('/:id/learn/:resourceId/save', async (req, res) => {
  const trackId = paramId(req.params.id);
  const resourceId = paramId(req.params.resourceId);

  if (!store.isPostgres()) {
    res.status(501).json({ error: 'Learning resources require PostgreSQL' });
    return;
  }

  try {
    const resource = await store.saveLearningResource(trackId, resourceId);
    if (!resource) { res.status(404).json({ error: 'Resource not found' }); return; }

    store.recordEvent('track.learn_resource_saved', {
      userId: getActorId(req),
      entityType: 'track',
      entityId: trackId,
      metadata: { resourceId, url: resource.url },
    }).catch(() => {});

    res.json(resource);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to save learning resource', detail: msg });
  }
});

// DELETE /api/tracks/:id/learn/:resourceId/save — unbookmark a learning resource
router.delete('/:id/learn/:resourceId/save', async (req, res) => {
  const trackId = paramId(req.params.id);
  const resourceId = paramId(req.params.resourceId);

  if (!store.isPostgres()) {
    res.status(501).json({ error: 'Learning resources require PostgreSQL' });
    return;
  }

  try {
    const resource = await store.unsaveLearningResource(trackId, resourceId);
    if (!resource) { res.status(404).json({ error: 'Resource not found' }); return; }

    res.json(resource);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to unsave learning resource', detail: msg });
  }
});

// DELETE /api/tracks/:id/learn/:resourceId — delete a learning resource
router.delete('/:id/learn/:resourceId', async (req, res) => {
  const trackId = paramId(req.params.id);
  const resourceId = paramId(req.params.resourceId);

  if (!store.isPostgres()) {
    res.status(501).json({ error: 'Learning resources require PostgreSQL' });
    return;
  }

  try {
    const deleted = await store.deleteLearningResource(trackId, resourceId);
    if (!deleted) { res.status(404).json({ error: 'Resource not found' }); return; }

    store.recordEvent('track.learn_resource_deleted', {
      userId: getActorId(req),
      entityType: 'track',
      entityId: trackId,
      metadata: { resourceId },
    }).catch(() => {});

    res.status(204).send();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to delete learning resource', detail: msg });
  }
});

export default router;
