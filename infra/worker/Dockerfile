FROM node:20-alpine

WORKDIR /app

COPY . .

RUN corepack enable \
  && pnpm install --frozen-lockfile \
  && pnpm --filter @mlbb/worker build

ENV NODE_ENV=production

WORKDIR /app/apps/worker

CMD ["node", "--experimental-specifier-resolution=node", "dist/index.js"]
