import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import healthRouter from './routes/health';
import tracksRouter from './routes/tracks';
import playlistsRouter from './routes/playlists';
import favoritesRouter from './routes/favorites';
import audioRouter from './routes/audio';
import eventsRouter from './routes/events';
import sessionsRouter from './routes/sessions';
import artistsRouter from './routes/artists';
import albumsRouter from './routes/albums';
import { startScheduler } from './services/scheduler';
import { logStartupDiagnostics } from './deps';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api', healthRouter);
app.use('/api/tracks', tracksRouter);
app.use('/api/playlists', playlistsRouter);
app.use('/api/favorites', favoritesRouter);
app.use('/api/audio', audioRouter);
app.use('/api/events', eventsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/artists', artistsRouter);
app.use('/api/albums', albumsRouter);

// Serve static frontend in production
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

async function start() {
  // Database connectivity check + auto-migration
  if (process.env.DATABASE_URL) {
    try {
      const { checkConnection } = await import('./db/pool');
      const ok = await checkConnection();
      if (ok) {
        console.log('   ✅ Database: PostgreSQL connected');
      } else {
        console.error('   ❌ Database: connection failed — falling back to in-memory would require restart without DATABASE_URL');
        process.exit(1);
      }

      // Auto-migrate: ensure all tables and columns exist (idempotent)
      const { ensureSchema, validateSchema } = await import('./db/migrate');
      const migrated = await ensureSchema();
      if (!migrated) {
        console.error('   ❌ Database: schema migration failed');
        process.exit(1);
      }
      console.log('   ✅ Database: schema up to date');

      // Validate critical tables before proceeding
      const valid = await validateSchema();
      if (!valid) {
        console.error('   ❌ Database: schema validation failed — required tables/columns missing');
        process.exit(1);
      }
    } catch (err) {
      console.error('   ❌ Database: connection error:', err);
      process.exit(1);
    }
  } else {
    console.log('   ⚠️  Database: In-memory (set DATABASE_URL for persistence)');
  }

  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🌊 Nightwave server running on http://localhost:${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Store: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'In-memory'}`);

    // Check external dependencies (yt-dlp, ffmpeg)
    await logStartupDiagnostics();

    // Start background enrichment scheduler
    const disableScheduler = process.env.ENRICH_SCHEDULER_DISABLED === 'true';
    if (!disableScheduler) {
      startScheduler();
    } else {
      console.log('   Enrichment scheduler: disabled');
    }
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
