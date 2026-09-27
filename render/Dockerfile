# ClipForge render worker (Remotion + ffmpeg).
FROM node:22-bookworm-slim

# ffmpeg for loudness normalisation; the rest are the shared libraries
# Remotion's Chrome Headless Shell needs on Debian, plus fonts for fallback glyphs/emoji.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 \
      libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 \
      libpango-1.0-0 libcairo2 libcups2 \
      fonts-liberation fonts-noto-color-emoji fonts-noto-core fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --include=dev && npm cache clean --force

COPY --chown=node:node . .
# Download Chrome Headless Shell and pre-build the Remotion bundle at image build
# time so workers start rendering immediately.
RUN npx remotion browser ensure && npm run build

STOPSIGNAL SIGTERM
CMD ["npx", "tsx", "src/worker.ts"]
