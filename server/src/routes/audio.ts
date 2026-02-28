import { Router } from 'express';
import path from 'path';
import { getAudioFilePath } from '../downloader';
import * as store from '../store';

const router = Router();

// MIME types for audio formats yt-dlp may produce
const MIME_MAP: Record<string, string> = {
  '.opus': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.webm': 'audio/webm',
  '.wav': 'audio/wav',
};

// GET /api/audio/:trackId — stream audio file for a track
router.get('/:trackId', async (req, res) => {
  const trackId = Array.isArray(req.params.trackId) ? req.params.trackId[0] : req.params.trackId;

  const filePath = await getAudioFilePath(trackId);
  if (!filePath) {
    res.status(404).json({ error: 'Audio not available' });
    return;
  }

  // Record playback event
  const userId = req.headers['x-user-id'] as string || '00000000-0000-0000-0000-000000000001';
  store.recordEvent('track.played', {
    userId,
    entityType: 'track',
    entityId: trackId,
  }).catch(() => {});

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_MAP[ext] || 'application/octet-stream';

  res.sendFile(filePath, {
    headers: { 'Content-Type': contentType },
  }, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ error: 'Failed to stream audio' });
    }
  });
});

export default router;
