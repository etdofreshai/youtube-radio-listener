# Nightwave — YouTube Radio Listener

Dark, Spotify-inspired web app for managing YouTube music tracks, playlists, and favorites.

## Tech Stack

- **Frontend:** Vite + React + TypeScript (dark theme)
- **Backend:** Express + TypeScript
- **Database:** PostgreSQL-ready (in-memory fallback for dev)
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

# Install all dependencies
npm run install:all

# Start development (both client + server)
npm run dev
```

- **Frontend:** http://localhost:5173 (Vite dev server, proxies `/api` to backend)
- **Backend:** http://localhost:3001
- **Health check:** http://localhost:3001/api/health

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
| `YOUTUBE_API_KEY` | _(empty)_ | YouTube Data API key (future) |
| `AUTH_SECRET` | _(empty)_ | JWT/session secret (future) |
| `YT_DLP_PATH` | `yt-dlp` | Path to yt-dlp binary |
| `FFMPEG_PATH` | `ffmpeg` | Path to ffmpeg binary |
| `FFPROBE_PATH` | `ffprobe` | Path to ffprobe binary |

## Project Structure

```
├── client/               # Vite + React frontend
│   ├── src/
│   │   ├── components/   # Reusable UI components
│   │   ├── pages/        # Route pages
│   │   ├── styles/       # Global CSS
│   │   ├── api.ts        # API client
│   │   └── types.ts      # TypeScript types
│   └── vite.config.ts
├── server/               # Express backend
│   ├── src/
│   │   ├── routes/       # API route handlers
│   │   ├── store/        # In-memory data store
│   │   ├── db/           # SQL schema + migrations
│   │   └── types.ts      # Shared types
│   └── tsconfig.json
├── Dockerfile            # Multi-stage production build
├── .env.example          # Environment template
└── REQUEST.md            # Full product spec
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/tracks` | List all tracks |
| POST | `/api/tracks` | Create track |
| GET | `/api/tracks/:id` | Get track |
| PUT | `/api/tracks/:id` | Update track |
| DELETE | `/api/tracks/:id` | Delete track |
| GET | `/api/playlists` | List playlists |
| POST | `/api/playlists` | Create playlist |
| GET | `/api/playlists/:id` | Get playlist |
| PUT | `/api/playlists/:id` | Update playlist |
| DELETE | `/api/playlists/:id` | Delete playlist |
| GET | `/api/favorites` | List favorites (with track data) |
| POST | `/api/favorites` | Add favorite `{ trackId }` |
| DELETE | `/api/favorites/:trackId` | Remove favorite |

## Track Fields

| Field | Type | Description |
|---|---|---|
| `youtubeUrl` | string | YouTube video URL |
| `title` | string | Track title |
| `artist` | string | Artist name |
| `startTimeSec` | number \| null | Playback start position (seconds) |
| `endTimeSec` | number \| null | Playback end position (seconds) |
| `volume` | number (0-100) | Preferred playback volume |
| `notes` | string | Freeform notes |

## Database

Currently uses in-memory storage. PostgreSQL schema is available at `server/src/db/schema.sql`.

```bash
# Apply schema to Postgres
psql $DATABASE_URL -f server/src/db/schema.sql
```

## Dokploy Deployment

1. Connect your GitHub repo in Dokploy
2. Set build type to **Dockerfile**
3. Add environment variables (at minimum `PORT=3001`)
4. Set `DATABASE_URL` if using external PostgreSQL
5. Deploy — the Dockerfile handles building client + server

## What's Next (Phase 2)

- [ ] PostgreSQL integration (connect in-memory store to real DB)
- [ ] User authentication (JWT)
- [ ] YouTube embed player
- [ ] Search via YouTube Data API
- [ ] Import/export JSON/CSV
- [ ] Drag-and-drop playlist reordering

## License

Private project.
