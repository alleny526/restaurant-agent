FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV DATA_FILE=/app/data/restaurant-agent.sqlite

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "src/server.js"]
