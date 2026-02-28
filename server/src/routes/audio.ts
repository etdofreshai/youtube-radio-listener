import { Router } from 'express';
import { getAudioFilePath } from '../downloader';

const router = Router();

// GET /api/audio/:trackId — stream audio file for a track
router.get('/:trackId', (req, res) => {
  const trackId = Array.isArray(req.params.trackId) ? req.params.trackId[0] : req.params.trackId;

  const filePath = getAudioFilePath(trackId);
  if (!filePath) {
    res.status(404).json({ error: 'Audio not available' });
    return;
  }

  // Let Express handle range requests and content-type
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ error: 'Failed to stream audio' });
    }
  });
});

export default router;
