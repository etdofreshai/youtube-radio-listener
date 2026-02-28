import { Router, Request, Response } from 'express';
import * as store from '../store';

const router = Router();

function p(v: string | string[]): string { return Array.isArray(v) ? v[0] : v; }

// GET /api/albums
router.get('/', async (_req: Request, res: Response) => {
  res.json(await store.getAllAlbums());
});

// GET /api/albums/:idOrSlug
router.get('/:idOrSlug', async (req: Request, res: Response) => {
  const album = await store.getAlbum(p(req.params.idOrSlug));
  if (!album) { res.status(404).json({ error: 'Album not found' }); return; }

  // Include tracks on this album
  const tracks = await store.getTracksByAlbum(album.id);
  res.json({ ...album, tracks });
});

// POST /api/albums
router.post('/', async (req: Request, res: Response) => {
  const { title, artistId, releaseYear, artworkUrl } = req.body;
  if (!title || !title.trim()) { res.status(400).json({ error: 'title is required' }); return; }
  const album = await store.createAlbum({ title: title.trim(), artistId, releaseYear, artworkUrl });
  res.status(201).json(album);
});

export default router;
