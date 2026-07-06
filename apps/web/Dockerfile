# Summa web (Next.js) — case-file UI + agent proxy.
# Build context: apps/web/
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Build-time DB access isn't needed (all pages are dynamic), but the env
# vars must exist; point them at the runtime locations.
ENV APP_DB_PATH=/data/app.db DOCUMENTS_PATH=/data/documents
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app /app
ENV APP_DB_PATH=/data/app.db \
    DOCUMENTS_PATH=/data/documents \
    AGENT_INTERNAL_URL=http://agent:4111 \
    NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start"]
