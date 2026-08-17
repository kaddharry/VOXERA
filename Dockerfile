FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json package-lock.json* ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js telemetry is disabled
ENV NEXT_TELEMETRY_DISABLED=1
ENV GROQ_API_KEYS="dummy"
ENV DEEPGRAM_API_KEY="dummy"
ENV SUPABASE_URL="https://dummy.supabase.co"
ENV SUPABASE_ANON_KEY="dummy"
ENV SUPABASE_SERVICE_ROLE_KEY="dummy"
ENV RESEND_API_KEY="dummy"

RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# The app runs behind a custom server (server/index.ts) so it can own the
# HTTP listener and handle the Twilio Media Stream WebSocket upgrade on
# /api/telephony/stream. That rules out Next's standalone output, whose
# tracing prunes the deps the custom server needs, so we ship .next plus a
# full node_modules and the TypeScript sources tsx loads at runtime.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/server ./server
COPY --from=builder --chown=nextjs:nodejs /app/lib ./lib
COPY --from=builder --chown=nextjs:nodejs /app/package.json /app/next.config.ts /app/tsconfig.json ./

USER nextjs

EXPOSE 3000

ENV PORT=3000
# set hostname to localhost
ENV HOSTNAME="0.0.0.0"

# Exec form so tsx is PID 1 and receives SIGTERM directly on container stop.
CMD ["./node_modules/.bin/tsx", "server/index.ts"]
