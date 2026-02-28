import { Router } from 'express';
import * as store from '../store';
import type { CreateRadioStationInput, UpdateRadioStationInput } from '../types';

const router = Router();

function paramId(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

// GET /api/radios — list all active stations (use ?all=true for including inactive)
router.get('/', async (req, res) => {
  const includeInactive = req.query.all === 'true';
  const stations = await store.getAllRadioStations(includeInactive);
  res.json(stations);
});

// GET /api/radios/:idOrSlug — get a single station
router.get('/:idOrSlug', async (req, res) => {
  const station = await store.getRadioStation(paramId(req.params.idOrSlug));
  if (!station) { res.status(404).json({ error: 'Radio station not found' }); return; }
  res.json(station);
});

// POST /api/radios — create a new station
router.post('/', async (req, res) => {
  const input = req.body as CreateRadioStationInput;
  if (!input.name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  if (!input.streamUrl?.trim()) { res.status(400).json({ error: 'streamUrl is required' }); return; }

  try {
    const station = await store.createRadioStation({
      ...input,
      name: input.name.trim(),
      streamUrl: input.streamUrl.trim(),
    });
    res.status(201).json(station);
  } catch (err: any) {
    if (err?.code === '23505') {
      res.status(409).json({ error: 'A station with this name/slug already exists' });
    } else {
      console.error('[radios] create error:', err);
      res.status(500).json({ error: 'Failed to create radio station' });
    }
  }
});

// PUT /api/radios/:idOrSlug — update a station
router.put('/:idOrSlug', async (req, res) => {
  const idOrSlug = paramId(req.params.idOrSlug);
  const input = req.body as UpdateRadioStationInput;

  if (input.name !== undefined && !input.name.trim()) {
    res.status(400).json({ error: 'name cannot be empty' });
    return;
  }
  if (input.streamUrl !== undefined && !input.streamUrl.trim()) {
    res.status(400).json({ error: 'streamUrl cannot be empty' });
    return;
  }

  const station = await store.updateRadioStation(idOrSlug, input);
  if (!station) { res.status(404).json({ error: 'Radio station not found' }); return; }
  res.json(station);
});

// DELETE /api/radios/:idOrSlug — delete a station
router.delete('/:idOrSlug', async (req, res) => {
  const deleted = await store.deleteRadioStation(paramId(req.params.idOrSlug));
  if (!deleted) { res.status(404).json({ error: 'Radio station not found' }); return; }
  res.status(204).send();
});

// POST /api/radios/:idOrSlug/toggle — toggle active status
router.post('/:idOrSlug/toggle', async (req, res) => {
  const idOrSlug = paramId(req.params.idOrSlug);
  const station = await store.getRadioStation(idOrSlug);
  if (!station) { res.status(404).json({ error: 'Radio station not found' }); return; }

  const updated = await store.updateRadioStation(idOrSlug, { active: !station.active });
  res.json(updated);
});

export default router;
