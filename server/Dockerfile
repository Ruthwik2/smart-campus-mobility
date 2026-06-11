# ---- build stage -----------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

# ---- runtime stage ----------------------------------------------------------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
# tsx runs the TypeScript seed; the prisma CLI powers boot-time `db push`
RUN npm ci --omit=dev && npm install --no-save tsx@^4 prisma@^6

COPY prisma ./prisma
RUN npx prisma generate

COPY --from=build /app/dist ./dist

EXPOSE 4000

# First boot: sync schema (idempotent), seed demo data (idempotent), serve.
# Production deployments should switch `db push` for `migrate deploy` with
# committed migrations — see docs/DEPLOYMENT.md.
CMD ["sh", "-c", "npx prisma db push --skip-generate && npx tsx prisma/seed.ts && node dist/index.js"]
