# Nightwave — YouTube Radio Listener

Dark, Spotify-inspired web app for managing YouTube music tracks, playlists, and favorites.

## Tech Stack

- **Frontend:** Vite + React + TypeScript (dark theme)
- **Backend:** Express + TypeScript
- **Database:** PostgreSQL (with in-memory fallback for dev)
- **Deploy:** Docker / Dokploy

## Quick Start

### Prerequisites
- Node.js 22+
- npm 10+
- **yt-dlp** (required for audio download + enrichment)
- **ffmpeg** (required for audio conversion)
- PostgreSQL (optional — uses in-memory store without it)

#### Installing yt-dlp + ffmpeg

```bash
# macOS
brew install yt-dlp ffmpeg

# Ubuntu/Debian
sudo apt update && sudo apt install -y ffmpeg python3-pip
pip install yt-dlp

# Alpine (Docker)
apk add ffmpeg python3 py3-pip
python3 -m pip install --break-system-packages yt-dlp

# Or set custom paths via env vars:
export YT_DLP_PATH=/usr/local/bin/yt-dlp
export FFMPEG_PATH=/usr/bin/ffmpeg
```

### Setup

```bash
# Clone and enter
git clone https://github.com/etdofreshai/youtube-radio-listener.git
cd youtube-radio-listener

# Copy environment config
cp .env.example .env
# Edit .env — set DATABASE_URL for persistence

# Install all dependencies
npm run install:all

# Apply database migrations (if using PostgreSQL)
psql $DATABASE_URL -f server/src/db/migrate-v4-persistence.sql

# Start development (both client + server)
npm run dev
```

- **Frontend:** http://localhost:5173 (Vite dev server, proxies `/api` to backend)
- **Backend:** http://localhost:3001
- **Health check:** http://localhost:3001/api/health

### Database Setup

The v4 migration creates all tables (idempotent, safe to re-run):

```bash
# Apply the unified migration
psql $DATABASE_URL -f server/src/db/migrate-v4-persistence.sql
```

This creates:
- `users` — user accounts (seeded with a default 'local' user)
- `tracks` — all track data including audio/enrichment/verification fields
- `playlists` — playlist metadata
- `playlist_tracks` — ordered track associations with position, addedAt, addedBy
- `favorites` — favorited tracks
- `events` — append-only audit log of all app activity

### Build for Production

```bash
npm run build
npm start
# Serves frontend + API on http://localhost:3001
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | _(empty)_ | PostgreSQL connection string. Leave blank for in-memory. |
| `PORT` | `3001` | Server port |
| `NODE_ENV` | `development` | Environment |
| `VITE_API_URL` | _(empty)_ | API base URL for frontend (blank = same origin) |
| `YT_DLP_PATH` | `yt-dlp` | Path to yt-dlp binary |
| `FFMPEG_PATH` | `ffmpeg` | Path to ffmpeg binary |
| `FFPROBE_PATH` | `ffprobe` | Path to ffprobe binary |
| `ENRICH_INTERVAL_MS` | `180000` | Background scheduler interval (ms) |
| `ENRICH_BATCH_SIZE` | `2` | Tracks per scheduler tick |
| `ENRICH_MAX_CONCURRENCY` | `2` | Max concurrent enrichment jobs |
| `ENRICH_MAX_AI_PER_HOUR` | `10` | AI enrichment budget per hour |
| `ENRICH_MAX_AI_PER_DAY` | `50` | AI enrichment budget per day |
| `ENRICH_SCHEDULER_DISABLED` | `false` | Disable background enrichment |
| `OPENAI_API_KEY` | _(empty)_ | Required for Stage B AI enrichment |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model for AI research |

## Persistence & Event History

### Architecture

When `DATABASE_URL` is set, all data is persisted to PostgreSQL:
- **Tracks, playlists, favorites** — fully persisted, survive restarts
- **Audio/enrichment state** — persisted including status, errors, attempts
- **Event audit log** — every significant action recorded

The app uses a **store abstraction layer** (`server/src/store/index.ts`) that routes to either the in-memory or PostgreSQL backend based on `DATABASE_URL`.

### Event Types

All user actions are recorded in the `events` table:

| Event Type | Description |
|---|---|
| `track.created` | New track added |
| `track.updated` | Track metadata edited |
| `track.deleted` | Track removed |
| `track.played` | Audio streamed |
| `track.verified` / `track.unverified` | Verification toggled |
| `track.download_started` / `track.download_completed` | Audio download |
| `track.refresh_started` | Audio re-downloaded |
| `track.enrich_started` | Manual enrichment triggered |
| `track.enrichment_stage_a_completed` | Stage A enrichment done |
| `track.enrichment_stage_b_completed` | Stage B AI enrichment done |
| `playlist.created` / `playlist.updated` / `playlist.deleted` | Playlist CRUD |
| `playlist.track_added` / `playlist.track_removed` | Playlist tracks changed |
| `playlist.reordered` | Playlist track order changed |
| `favorite.added` / `favorite.removed` | Favorites changed |

### User Model

A default "local" user (`00000000-0000-0000-0000-000000000001`) is seeded for pre-auth usage. The `users` table schema is ready for full auth integration. Currently, the user ID can be set via the `X-User-Id` request header.

## Project Structure

```
├── client/               # Vite + React frontend
│   ├── src/
│   │   ├── components/   # Reusable UI components
│   │   ├── pages/        # Route pages (Tracks, Playlists, Favorites, History)
│   │   ├── styles/       # Global CSS
│   │   ├── api.ts        # API client
│   │   └── types.ts      # TypeScript types
│   └── vite.config.ts
├── server/               # Express backend
│   ├── src/
│   │   ├── routes/       # API route handlers
│   │   ├── store/        # Store abstraction (memory + postgres)
│   │   │   ├── index.ts  # Store router (picks backend based on DATABASE_URL)
│   │   │   ├── memory.ts # In-memory store
│   │   │   └── postgres.ts # PostgreSQL store
│   │   ├── db/           # SQL schema + migrations
│   │   │   ├── pool.ts   # Connection pool
│   │   │   └── migrate-v4-persistence.sql  # Unified migration
│   │   ├── services/     # Enrichment pipeline + scheduler
│   │   └── types.ts      # Shared types
│   └── tsconfig.json
├── Dockerfile            # Multi-stage production build
├── .env.example          # Environment template
└── REQUEST.md            # Full product spec
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check (includes DB status) |
| GET | `/api/tracks` | List tracks (paginated, sortable, searchable) |
| POST | `/api/tracks` | Create track |
| GET | `/api/tracks/:id` | Get track |
| PUT | `/api/tracks/:id` | Update track |
| DELETE | `/api/tracks/:id` | Delete track |
| POST | `/api/tracks/:id/verify` | Toggle verification |
| POST | `/api/tracks/:id/enrich` | Trigger enrichment |
| POST | `/api/tracks/:id/download` | Download audio |
| POST | `/api/tracks/:id/refresh` | Re-download audio |
| GET | `/api/playlists` | List playlists |
| POST | `/api/playlists` | Create playlist |
| GET | `/api/playlists/:id` | Get playlist |
| PUT | `/api/playlists/:id` | Update playlist |
| DELETE | `/api/playlists/:id` | Delete playlist |
| POST | `/api/playlists/:id/tracks` | Add track to playlist |
| DELETE | `/api/playlists/:id/tracks/:trackId` | Remove track from playlist |
| PUT | `/api/playlists/:id/reorder` | Reorder playlist tracks |
| GET | `/api/favorites` | List favorites (with track data) |
| POST | `/api/favorites` | Add favorite `{ trackId }` |
| DELETE | `/api/favorites/:trackId` | Remove favorite |
| GET | `/api/events` | Event history (paginated, filterable) |
| GET | `/api/events/my` | Current user's event history |
| GET | `/api/audio/:trackId` | Stream track audio |

## Dokploy Deployment

1. Connect your GitHub repo in Dokploy
2. Set build type to **Dockerfile**
3. Add environment variables (at minimum `PORT=3001` and `DATABASE_URL`)
4. Deploy — the Dockerfile handles building client + server

## License

Private project.
