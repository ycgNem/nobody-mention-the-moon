# syntax=docker/dockerfile:1
# Nobody Mention the Moon: one image that serves the built client and runs the game server
# (docs/HOSTING.md).
#
#   docker build -t moon .                              # with the 41 MB speech model
#   docker build -t moon --build-arg SPEECH_MODEL=0 .   # without it (typed chat still works)
#   docker run --rm -p 8080:8080 moon                   # → http://localhost:8080

ARG NODE_VERSION=22.20.0

# ---- speech: the Vosk model, downloaded, checked and repacked as in docs/spikes/M5-keyword-spotting.md
FROM node:${NODE_VERSION}-alpine AS speech
ARG SPEECH_MODEL=1
ARG VOSK_MODEL=vosk-model-small-en-us-0.15
ARG VOSK_SHA256=30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498
WORKDIR /speech
RUN set -eu; \
    if [ "$SPEECH_MODEL" != "1" ]; then echo "SPEECH_MODEL=$SPEECH_MODEL: no speech model in this image"; exit 0; fi; \
    wget -q -O model.zip "https://alphacephei.com/vosk/models/${VOSK_MODEL}.zip"; \
    echo "${VOSK_SHA256}  model.zip" | sha256sum -c -; \
    unzip -q model.zip; \
    conf="${VOSK_MODEL}/conf/model.conf"; \
    sed -i -e 's/rule2.min-trailing-silence=0.5/rule2.min-trailing-silence=0.25/' \
           -e 's/rule3.min-trailing-silence=0.75/rule3.min-trailing-silence=0.4/' \
           -e 's/rule4.min-trailing-silence=1.0/rule4.min-trailing-silence=0.6/' "$conf"; \
    grep -q 'rule2.min-trailing-silence=0.25' "$conf"; \
    grep -q 'rule3.min-trailing-silence=0.4' "$conf"; \
    grep -q 'rule4.min-trailing-silence=0.6' "$conf"; \
    tar -czf "${VOSK_MODEL}.tar.gz" "${VOSK_MODEL}"; \
    rm -rf model.zip "${VOSK_MODEL}"

# ---- build: typecheck everything, build the client
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY client client
COPY tools tools
# Optional fallback ICE list baked into the client (JSON array of RTCIceServer). The server's
# /ice endpoint is the better place for TURN credentials; see docs/HOSTING.md.
ARG VITE_ICE_SERVERS=""
ARG BUILD_ID=""
ENV VITE_ICE_SERVERS=${VITE_ICE_SERVERS} VITE_BUILD_ID=${BUILD_ID}
RUN npm run build

# ---- runtime: server dependencies only, the built client, a non-root user
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
# TypeScript arrives as an optional peer of @colyseus/schema (for its codegen); nothing at runtime
# loads it, and it's 24 MB.
RUN npm ci --omit=dev --workspace server --no-audit --no-fund \
    && rm -rf node_modules/typescript \
    && npm cache clean --force
COPY tsconfig.base.json ./
COPY shared/tsconfig.json shared/
COPY shared/src shared/src
COPY server/tsconfig.json server/
COPY server/src server/src
COPY --from=build /app/client/dist client/dist
COPY --from=speech /speech/ client/dist/speech/
ARG BUILD_ID=""
ENV BUILD_ID=${BUILD_ID}
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1
# node directly (not npm or the tsx CLI), so SIGTERM reaches the server's graceful shutdown.
CMD ["node", "--import", "tsx", "server/src/index.ts"]
