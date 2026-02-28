# REQUEST.md

## Project Name Decision

### Candidate naming direction (from prior discussion themes)
- **Nightwave**
- TubeRadio
- EchoPlay

### Chosen name: **Nightwave**
**Why this is best:**
1. Matches the desired **dark, Spotify-like aesthetic** ("night" feel).
2. Feels like a real consumer music product, not a utility tool.
3. Short, memorable, and flexible for future features beyond YouTube browsing.
4. Works well for branding/UI copy: *Nightwave Library, Nightwave Mix, Nightwave Favorites*.

> Working product name for this build: **Nightwave — YouTube Radio Listener**.

---

## Product Vision
Build a web app that feels like Spotify in a dark theme, but uses YouTube as the content source for listening/discovery. Users can sign in, browse artists/songs, save favorites/playlists, and manage their data with import/export tools.

Core goal: **functional MVP with lowest possible monthly cost (free-first).**

---

## Scope and Requirements

### Must-have MVP Features
1. **Authentication**
   - Email + password login/signup
   - Optional magic-link login (passwordless)
2. **User Library**
   - Favorites (songs/videos)
   - Playlists (create, rename, delete, reorder items)
3. **Discovery/Browse UI**
   - Artist view
   - Song/track results view
   - Search powered by YouTube data
4. **Likes with timestamps**
   - Store when a user liked a track
   - Keep event history for future analytics/recommendations
5. **Data portability**
   - Export user data to **JSON** and **CSV**
   - Import from JSON/CSV with validation and conflict handling
6. **Database-backed user data**
   - Persistent multi-user storage

### Non-goals for MVP
- No ML recommendation engine yet
- No audio clipping/downloading pipeline in MVP
- No advanced moderation/content fingerprinting in MVP

---

## Cost Strategy (Free-first)

### Recommended stack (lowest-cost path)
- **Frontend + API runtime:** Next.js (TypeScript) on **Vercel Hobby** (free)
- **Database/Auth:** **Supabase Free** (Postgres + Auth + Row Level Security)
- **Caching/rate-limit helper (optional):** Upstash Redis free tier
- **Analytics (optional):** PostHog free tier or Vercel Analytics free
- **Object storage (optional exports):** Supabase Storage free tier

### Why this stack
- Avoids paying for separate auth provider initially.
- Single Postgres + Auth source reduces ops overhead.
- Strong TypeScript ecosystem and fast iteration.
- Easy upgrade path when usage grows.

### Cost notes / constraints
- YouTube API quota limits must be respected (cache aggressively).
- Prefer server-side proxy endpoints so API keys are never exposed.
- Design for graceful degradation if quota is exhausted.

---

## Technical Architecture (TypeScript)

### High-level architecture
- **Client:** Next.js App Router + React + Tailwind + shadcn/ui (dark mode first)
- **Server:** Next.js Route Handlers (TypeScript) for API surface
- **Auth/Data:** Supabase Auth + Postgres + RLS
- **External provider:** YouTube Data API v3 for metadata/search
- **Playback:** YouTube embed/player integration (respect ToS)

### Suggested folder structure
```txt
/src
  /app
    /(auth)
    /(dashboard)
    /api
  /components
  /features
    /auth
    /library
    /search
    /playlists
  /lib
    /db
    /youtube
    /validation
  /types
```

### Security/engineering baseline
- Zod validation for all API inputs
- RLS policies on user-owned tables
- API rate limiting per user/IP
- Server-only handling of provider keys
- Audit log table for critical user actions

---

## Data Model Draft (PostgreSQL)

```sql
-- users handled by Supabase auth.users

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz default now()
);

create table artists (
  id text primary key, -- youtube channel/artist id
  name text not null,
  image_url text,
  created_at timestamptz default now()
);

create table tracks (
  id text primary key, -- youtube video id
  artist_id text references artists(id),
  title text not null,
  duration_seconds int,
  thumbnail_url text,
  source text not null default 'youtube',
  created_at timestamptz default now()
);

create table playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table playlist_items (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references playlists(id) on delete cascade,
  track_id text not null references tracks(id),
  position int not null,
  added_at timestamptz default now(),
  unique (playlist_id, track_id)
);

create table favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id text not null references tracks(id),
  liked_at timestamptz not null default now(),
  unique (user_id, track_id)
);

create table like_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id text not null references tracks(id),
  event_type text not null check (event_type in ('liked','unliked')),
  event_at timestamptz not null default now()
);
```

---

## API Draft (Route-level)

### Auth
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/magic-link`
- `POST /api/auth/logout`

### YouTube discovery/search
- `GET /api/search?q=...&type=track|artist&page=...`
- `GET /api/tracks/:id`
- `GET /api/artists/:id`

### Library
- `GET /api/me/favorites`
- `POST /api/me/favorites` (like)
- `DELETE /api/me/favorites/:trackId` (unlike)

### Playlists
- `GET /api/me/playlists`
- `POST /api/me/playlists`
- `PATCH /api/me/playlists/:id`
- `DELETE /api/me/playlists/:id`
- `POST /api/me/playlists/:id/items`
- `PATCH /api/me/playlists/:id/items/reorder`
- `DELETE /api/me/playlists/:id/items/:itemId`

### Import / Export
- `GET /api/me/export?format=json|csv`
- `POST /api/me/import?format=json|csv`

---

## Phased Roadmap

### Phase 1 — MVP (now)
- Auth (email/password + magic link)
- Dark UI shell + responsive layout
- Search tracks/artists via YouTube API
- Favorites with `liked_at` timestamp
- Playlists CRUD + add/remove/reorder
- Import/export JSON/CSV
- Basic observability (error logs, minimal analytics)

### Phase 2 — Quality and retention
- Better library filters/sorting
- Recently played / continue listening
- Smarter caching and quota optimization
- UX polish and keyboard shortcuts

### Phase 3 — Advanced ideas (future)
1. **Recommendation engine**
   - Start with rule-based/co-occurrence from likes and playlist patterns
   - Later evolve to embedding-based recommendations
2. **Detect non-music segments**
   - Heuristic + metadata + optional audio analysis pipeline
   - Flag intros/outros/talk-heavy segments for skip suggestions
3. **Clip/download concepts (high caution)**
   - Any clipping/downloading must comply with platform ToS, copyright law, and local regulations.
   - Prefer "save references/playlist metadata" over storing copyrighted media files.
   - If introduced, require clear legal policy, DMCA workflow, and jurisdiction review before launch.

---

## Acceptance Criteria (MVP)

### Functional
- User can register/login and persist session.
- User can search YouTube tracks/artists from app UI.
- User can like/unlike a track; `liked_at` is stored and visible in API response.
- User can create playlists and manage items/order.
- User can export full personal library as JSON and CSV.
- User can import JSON/CSV with validation errors surfaced clearly.

### Security/Data
- User can only access own data (RLS enforced).
- Provider keys are never exposed to client.
- Input validation blocks malformed payloads.

### UX/Quality
- App uses dark theme by default.
- Core flows complete within acceptable latency on free-tier infra.
- Error states are user-readable (not raw stack traces).

### Delivery
- Repo includes setup docs and env var template.
- MVP deployable on free-tier services without paid dependencies.

---

## Implementation Notes (practical)
- Start with Supabase schema + RLS first, then wire API routes.
- Build vertical slices: auth → search → likes → playlists → import/export.
- Add seed/demo mode for local dev without exhausting YouTube quota.
- Cache YouTube responses by query + page token.

This request should be treated as the build contract for the initial implementation of **Nightwave**.

---

## v0.1.0 Implementation Status

### Stack (actual)
- **Frontend:** Vite + React + TypeScript (dark Spotify-like theme)
- **Backend:** Express + TypeScript
- **Database:** In-memory store (PostgreSQL schema provided at `server/src/db/schema.sql`)
- **Deploy:** Docker multi-stage build, Dokploy-ready

### What's built
- ✅ Full CRUD API for tracks, playlists, and favorites
- ✅ Health endpoint (`/api/health`)
- ✅ Dark UI shell with sidebar navigation
- ✅ Track management (create/edit/delete) with all fields: youtubeUrl, title, artist, startTimeSec, endTimeSec, volume, notes
- ✅ Playlist create/delete
- ✅ Favorites with track enrichment
- ✅ PostgreSQL migration SQL ready
- ✅ Dockerfile for production deployment
- ✅ Environment variable configuration

### Deferred to Phase 2
- PostgreSQL integration (wire store to real DB)
- User authentication
- YouTube search/embed
- Import/export
- Playlist track management UI
