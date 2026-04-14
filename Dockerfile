FROM node:22-alpine AS web-build
WORKDIR /app/web

COPY web/package.json ./package.json
RUN npm install

COPY web .
RUN npm run build

FROM node:22-alpine AS server-deps
WORKDIR /app/server

COPY server/package.json ./package.json
RUN npm install --omit=dev

FROM node:22-alpine AS runtime
RUN apk add --no-cache docker-cli docker-cli-compose

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
ENV WORK_PATH=/workspace

COPY server ./server
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY --from=web-build /app/web/dist ./web/dist

EXPOSE 3000
VOLUME ["/data", "/workspace"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:${PORT}/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "server/src/index.js"]
