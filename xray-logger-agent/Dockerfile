# xray-logger-agent
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

# Run as root to ensure we can read host-mounted log files
USER root
CMD ["node", "src/index.js"]
