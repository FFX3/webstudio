# Build stage
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.14.4 --activate

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build

# Production stage
FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@9.14.4 --activate

WORKDIR /app
COPY --from=builder /app .

# Prisma for migrations
WORKDIR /prisma
COPY --from=builder /app/packages/prisma-client/prisma ./
COPY --from=builder /app/packages/prisma-client/node_modules ./node_modules/

WORKDIR /app/apps/builder

RUN addgroup -g 1000 webstudio && adduser -u 1000 -G webstudio -s /bin/sh -D webstudio
RUN chown -R webstudio:webstudio /app /prisma

USER webstudio
EXPOSE 3000

CMD ["pnpm", "start"]
