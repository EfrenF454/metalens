FROM node:22-slim

# ffmpeg aporta ffprobe (detalle técnico de video); perl es requisito
# del binario de ExifTool que incluye exiftool-vendored.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg perl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY public ./public
RUN npm ci --omit=dev

COPY server.js ./

ENV NODE_ENV=production
EXPOSE 3000

USER node
CMD ["node", "server.js"]
