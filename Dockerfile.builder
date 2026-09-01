FROM node:22-slim

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@9.14.4

USER node
WORKDIR /app
COPY --chown=node:node . .

RUN pnpm install --frozen-lockfile
RUN pnpm build

EXPOSE 3000

WORKDIR /app/apps/builder
CMD ["sh", "-c", "cd /app/packages/prisma-client && pnpm exec prisma migrate deploy && cd /app/apps/builder && pnpm start"]
