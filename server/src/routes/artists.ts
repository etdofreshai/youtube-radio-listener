import { Router, Request, Response } from 'express';
import * as store from '../store';

const router = Router();

function p(v: string | string[]): string { return Array.isArray(v) ? v[0] : v; }

// GET /api/artists
router.get('/', async (_req: Request, res: Response) => {
  res.json(await store.getAllArtists());
});

// GET /api/artists/:idOrSlug
router.get('/:idOrSlug', async (req: Request, res: Response) => {
  const artist = await store.getArtist(p(req.params.idOrSlug));
  if (!artist) { res.status(404).json({ error: 'Artist not found' }); return; }

  // Include tracks by this artist
  const tracks = await store.getTracksByArtist(artist.id);
  res.json({ ...artist, tracks });
});

// POST /api/artists
router.post('/', async (req: Request, res: Response) => {
  const { name, imageUrl, bio } = req.body;
  if (!name || !name.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  const artist = await store.createArtist({ name: name.trim(), imageUrl, bio });
  res.status(201).json(artist);
});

// PUT /api/artists/:id
router.put('/:id', async (req: Request, res: Response) => {
  const { name, imageUrl, bio } = req.body;
  const artist = await store.updateArtist(p(req.params.id), { name, imageUrl, bio });
  if (!artist) { res.status(404).json({ error: 'Artist not found' }); return; }
  res.json(artist);
});

export default router;
