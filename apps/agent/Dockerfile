# Summa agent (Mastra) — plain Node server.
# Build context: apps/agent/
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app /app
# All persistent state lives on the /data volume (see docker-compose.yml).
ENV CORPUS_DB_PATH=/data/corpus.db \
    APP_DB_PATH=/data/app.db \
    MASTRA_DB_PATH=/data/mastra.db \
    DOCUMENTS_PATH=/data/documents
EXPOSE 4111
# Best-effort corpus seed (no-op when already present), then start.
CMD ["sh", "-c", "npm run corpus:fetch || true; npm start"]
