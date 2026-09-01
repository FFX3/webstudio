FROM node:22-slim

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.14.4 --activate

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build

USER node
EXPOSE 3000

WORKDIR /app/apps/builder
CMD ["sh", "-c", "cd /app/packages/prisma-client && pnpm exec prisma migrate deploy && cd /app/apps/builder && pnpm start"]
