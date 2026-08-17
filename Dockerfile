FROM node:20-slim AS base

# Install dependencies only when needed
FROM base AS deps

WORKDIR /app

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

# Production image — runs custom-server.ts (not `next start`), which is a
# plain Node http.Server wrapping Next's request handler. That's the only
# way to accept the raw WebSocket 'upgrade' event Twilio's Media Stream
# needs at /api/telephony/stream — App Router route handlers never see
# upgrade requests, and Next's auto-generated standalone server.js has no
# 'upgrade' listener either. So this stage ships the full build output and
# full production node_modules (tsx included) instead of the pruned
# standalone trace.
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/custom-server.ts ./custom-server.ts
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV PORT=3000
# set hostname to localhost
ENV HOSTNAME="0.0.0.0"

CMD ["npx", "tsx", "custom-server.ts"]
