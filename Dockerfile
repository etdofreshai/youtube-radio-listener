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

# Server dependencies (production only)
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev

# Server build output
COPY --from=server-build /app/server/dist ./server/dist

# Client build output
COPY --from=client-build /app/client/dist ./client/dist

EXPOSE 3001
CMD ["node", "server/dist/index.js"]
