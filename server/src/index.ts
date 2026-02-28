import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import healthRouter from './routes/health';
import tracksRouter from './routes/tracks';
import playlistsRouter from './routes/playlists';
import favoritesRouter from './routes/favorites';

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

// Serve static frontend in production
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌊 Nightwave server running on http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Database: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'In-memory'}`);
});

export default app;
