FROM node:18-alpine AS pnpm
RUN apk add --no-cache libc6-compat curl
WORKDIR /app
RUN curl -f https://get.pnpm.io/v6.16.js | node - add --global pnpm
COPY ./package.json ./pnpm-lock.yaml /app/

FROM pnpm as deps
RUN pnpm install;

FROM pnpm as builder
COPY --from=deps /app/node_modules ./node_modules/
# enumerate specifically to exclude .git etc 
COPY ./package.json ./pnpm-lock.yaml ./.swcrc /app/
COPY ./src /app/src
# Rebuild the source code only when needed
RUN pnpm run build

# Production image, copy all the files and run next
FROM node:18-alpine AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs # eh

COPY --from=deps /app/node_modules ./node_modules/
COPY --from=builder /app/dist/index.js /app/

USER nextjs

EXPOSE 3000

ENV PORT 3000
ENTRYPOINT ["/usr/local/bin/node", "/app/index.js"]
