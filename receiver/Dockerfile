FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
COPY public ./public

ENV NODE_ENV=production

EXPOSE 4000

# Default command runs the API. The worker uses the same image with a
# different command (see docker-compose.yml / the deployment README),
# so both are built from a single Dockerfile.
CMD ["node", "src/server.js"]
