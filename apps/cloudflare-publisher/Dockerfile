FROM node:22-alpine AS base
RUN corepack enable

# Build stage
FROM base AS builder
WORKDIR /app

# Copy workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY packages ./packages
COPY apps/cloudflare-publisher ./apps/cloudflare-publisher

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build the service and its dependencies
RUN pnpm --filter "@webstudio-is/cloudflare-publisher..." build

# Production stage
FROM base AS runner
WORKDIR /app

# Copy built application
COPY --from=builder /app/apps/cloudflare-publisher/dist ./dist
COPY --from=builder /app/apps/cloudflare-publisher/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["node", "dist/index.js"]
