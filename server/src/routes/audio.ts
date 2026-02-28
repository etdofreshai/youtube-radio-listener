import { Router } from 'express';
import path from 'path';
import { getAudioFilePath } from '../downloader';

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
router.get('/:trackId', (req, res) => {
  const trackId = Array.isArray(req.params.trackId) ? req.params.trackId[0] : req.params.trackId;

  const filePath = getAudioFilePath(trackId);
  if (!filePath) {
    res.status(404).json({ error: 'Audio not available' });
    return;
  }

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
