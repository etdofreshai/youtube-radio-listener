import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { getVideoFilePath } from '../downloader';

const router = Router();

// MIME types for video formats yt-dlp may produce
const MIME_MAP: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
};

// GET /api/video/:trackId — stream video file with range support
router.get('/:trackId', async (req, res) => {
  const trackId = Array.isArray(req.params.trackId) ? req.params.trackId[0] : req.params.trackId;

  const filePath = await getVideoFilePath(trackId);
  if (!filePath) {
    res.status(404).json({ error: 'Video not available' });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_MAP[ext] || 'video/mp4';
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  const range = req.headers.range;

  if (range) {
    // Parse range header: "bytes=start-end"
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });

    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
  } else {
    // No range — send full file
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });

    fs.createReadStream(filePath).pipe(res);
  }
});

export default router;
