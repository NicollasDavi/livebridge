FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev 2>/dev/null || true
COPY server.js .
EXPOSE 8080
CMD ["node", "server.js"]
