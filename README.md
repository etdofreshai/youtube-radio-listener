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

### Song Explorations / AI Recommendations

| Variable | Default | Description |
|---|---|---|
| `SONG_EXPLORATIONS_MODE` | `dry-run` | Mode: `dry-run` (mock) or `live` (real YouTube API) |
| `SONG_EXPLORATIONS_DISCOVERY_INTERVAL_MINUTES` | `60` | Discovery interval (hourly by default) |
| `SONG_EXPLORATIONS_HOURLY_IMPORT_CAP` | `5` | Max tracks to import per hour |
| `SONG_EXPLORATIONS_MIN_CONFIDENCE_SCORE` | `0.5` | Minimum score (0-1) to accept a candidate |
| `RECOMMENDATION_ENABLED` | `true` | Enable AI-powered recommendations |
| `RECOMMENDATION_INTERVAL_MINUTES` | `60` | How often to run recommendations (hourly) |
| `RECOMMENDATION_ADD_PER_RUN` | `5` | Max tracks to add per recommendation run |
| `CLAUDE_CODE_RECOMMENDATION_MODEL` | `haiku` | AI model for recommendations (haiku/sonnet/opus) |
| `CLAUDE_CODE_OAUTH_TOKEN` | _(empty)_ | OAuth token for Claude Code authentication |

## Song Explorations — AI Recommendations

Automated music discovery using AI-powered recommendations based on your existing library.

### How It Works

1. **Discovery Pipeline** runs hourly (configurable via `RECOMMENDATION_INTERVAL_MINUTES`)
2. **AI analyzes** your existing tracks (top played + recently added) as seed context
3. **Generates up to 5 recommendations** per run (configurable via `RECOMMENDATION_ADD_PER_RUN`)
4. **Respects hourly cap** — won't exceed `SONG_EXPLORATIONS_HOURLY_IMPORT_CAP` tracks per hour
5. **Manual adds coexist** — manually added tracks count toward the cap but don't block auto-recommendations

### Schedule

- **Cadence:** Hourly (60 minutes by default)
- **Add per run:** 5 tracks max
- **Hourly cap:** 5 tracks total (includes manual + auto)

### AI Response Format

Claude Code returns structured JSON that the importer can parse reliably:

```json
{
  "recommendations": [
    {
      "videoId": "abc123defgh",
      "title": "Track Title",
      "channelName": "Artist Name",
      "channelId": "UC...",
      "durationSeconds": 240,
      "confidence": 0.85,
      "reason": "Similar style to your top tracks"
    }
  ],
  "model": "gpt-4o",
  "generatedAt": "2024-01-15T10:30:00Z",
  "notes": "optional notes"
}
```

### CLI Commands

```bash
# Full pipeline (discover + recommend + import)
npm run song:explore

# Discovery only (YouTube API)
npm run song:discover

# AI recommendations only
npm run song:recommend

# Import pending candidates
npm run song:import

# Show status
npm run song:status

# Print cron setup instructions
npm run song:cron
```

### Manual vs Auto-Recommendations

Both manual track additions and auto-recommendations share the same hourly import cap:

- **Manual adds** via UI/API are immediate
- **Auto-recommendations** run hourly and fill remaining cap space
- If you add 3 tracks manually, only 2 auto-recommendations will be accepted that hour
- Recommendations are based on your existing library, not external trends

### OpenClaw Cron Setup

```bash
# Hourly discovery + import
openclaw cron add --schedule "0 * * * *" \
  --name "song-discovery-hourly" \
  --prompt "Run: cd /path/to/youtube-radio-listener/server && npm run song:explore"
```

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
| `session.created` / `session.ended` | Session lifecycle |
| `session.joined` / `session.left` | Session membership |
| `session.play` / `session.pause` / `session.seek` | Playback control |
| `session.set_track` / `session.next` / `session.previous` | Track navigation |

## Linkable Entities

Everything has a stable URL via slug or token:

| Entity | URL Pattern | Example |
|---|---|---|
| Track | `/api/tracks/:idOrSlug` | `/api/tracks/rick-astley-never-gonna-give-you-up` |
| Artist | `/api/artists/:idOrSlug` | `/api/artists/rick-astley` |
| Album | `/api/albums/:idOrSlug` | `/api/albums/rick-astley-whenever-you-need-somebody` |
| Playlist | `/api/playlists/:idOrSlug` | `/api/playlists/chill-vibes` |
| Session | `/api/sessions/:token` | `/api/sessions/74d9a906-f240-4d74-84b1-b0a5c61b08ab` |

Slugs are auto-generated from names/titles. UUIDs also work for all endpoints.

## Shared Play Sessions

Synchronized listening rooms where multiple users share playback state.

### How It Works

1. **Create** a session → get a shareable UUID token
2. **Share** the link (`/session/:token`) with others
3. **Members** join by visiting the link
4. **Anyone** can control playback (play/pause/seek/next/previous)
5. State syncs via polling (2s interval, designed for future WebSocket upgrade)
6. **Owner** can regenerate the token (invalidates old links) or end the session

### Session State Model

```
session_state
├── current_track_id    → which track is playing
├── is_playing          → play/pause
├── position_sec        → playback position (seconds)
├── position_updated_at → timestamp for drift calculation
├── queue               → ordered track IDs
└── updated_by          → who last changed state
```

Clients calculate actual position: `positionSec + (now - positionUpdatedAt)` when `isPlaying`.

### Session API

| Method | Path | Description |
|---|---|---|
| POST | `/api/sessions` | Create session `{ name?, playlistId?, queue? }` |
| GET | `/api/sessions/mine` | List current user's sessions |
| GET | `/api/sessions/:token` | Get session + state + members |
| POST | `/api/sessions/:token/join` | Join session |
| POST | `/api/sessions/:token/leave` | Leave session |
| GET | `/api/sessions/:token/state` | Poll current playback state |
| PUT | `/api/sessions/:token/state` | Update state `{ action, trackId?, positionSec?, queue? }` |
| POST | `/api/sessions/:token/regenerate` | New token (owner only) |
| POST | `/api/sessions/:token/end` | End session (owner only) |
| GET | `/api/sessions/:token/events` | Session event history |
| GET | `/api/sessions/:token/members` | List members |

**State actions:** `play`, `pause`, `seek`, `set_track`, `next`, `previous`, `update_queue`

### Security Considerations

- **Session tokens are UUIDs** — not guessable (122 bits of entropy)
- **No auth yet** — anyone with the token can join and control playback
- Token regeneration invalidates old links immediately (404)
- Session events are logged for audit trail
- **Future:** Add real user auth, permissions (view-only vs. DJ role), rate limiting

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
| GET | `/api/artists` | List all artists |
| GET | `/api/artists/:idOrSlug` | Get artist by ID or slug |
| POST | `/api/artists` | Create artist `{ name }` |
| PUT | `/api/artists/:id` | Update artist |
| GET | `/api/albums` | List all albums |
| GET | `/api/albums/:idOrSlug` | Get album by ID or slug |
| POST | `/api/albums` | Create album `{ title, artistId? }` |
| POST | `/api/sessions` | Create play session |
| GET | `/api/sessions/mine` | List user's sessions |
| GET | `/api/sessions/:token` | Get session details |
| POST | `/api/sessions/:token/join` | Join session |
| POST | `/api/sessions/:token/leave` | Leave session |
| GET | `/api/sessions/:token/state` | Get playback state |
| PUT | `/api/sessions/:token/state` | Update playback `{ action, ... }` |
| POST | `/api/sessions/:token/regenerate` | New share token |
| POST | `/api/sessions/:token/end` | End session |
| GET | `/api/sessions/:token/events` | Session event log |
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
