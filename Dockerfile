# Multi-stage build for Nightwave
FROM node:22-alpine AS base

# --- Build client ---
FROM base AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm install
COPY client/ ./
RUN npm run build

# --- Build server ---
FROM base AS server-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm install
COPY server/ ./
RUN npm run build

# --- Production ---
FROM base AS production
WORKDIR /app
ENV NODE_ENV=production

# Install yt-dlp + ffmpeg (required for audio download & enrichment)
RUN apk add --no-cache ffmpeg python3 py3-pip \
    && python3 -m pip install --break-system-packages --no-cache-dir yt-dlp \
    && yt-dlp --version \
    && ffmpeg -version | head -1

# Server dependencies (production only)
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev

# Server build output
COPY --from=server-build /app/server/dist ./server/dist

# Client build output
COPY --from=client-build /app/client/dist ./client/dist

# Audio files directory (can be mounted as a volume)
RUN mkdir -p /app/audio

CMD ["node", "server/dist/index.js"]
