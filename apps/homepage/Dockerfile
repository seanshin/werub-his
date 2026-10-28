# hospital.example.org 홈페이지 — AWS 컨테이너(App Runner / ECS Fargate)용 멀티스테이지 빌드
# apps/homepage 는 워크스페이스 내부 의존이 없는 자기완결 앱이라 단독 빌드 가능.
# 빌드: docker build -f apps/homepage/Dockerfile -t werubyhosp-homepage apps/homepage

# ── deps ──
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund

# ── build ──
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 프록시 대상은 BUILD 시점에 고정됨 → 빌드 ARG 로 주입(환경별 이미지). 기본 HIS API.
ARG HOMEPAGE_API_ORIGIN=https://his.example.org
ENV HOMEPAGE_API_ORIGIN=${HOMEPAGE_API_ORIGIN}
# SSG/ISR pre-render 시 publicFetch 실데이터용(필수 — 없으면 빈 목록 정적생성)
ENV INTERNAL_API_URL=${HOMEPAGE_API_ORIGIN}
ENV NEXT_TELEMETRY_DISABLED=1
# 브라우저는 상대경로(/api·/media) 호출 → rewrites 서버 프록시(same-origin·CORS 불요)
ENV NEXT_PUBLIC_API_URL=""
RUN npm run build

# ── runner ──
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs
# standalone 산출물 + 정적 자산(public 없음)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
USER nextjs
EXPOSE 3001
# 런타임 env 주입: INTERNAL_API_URL(SSR 내부) / NEXT_PUBLIC_API_URL(클라 빌드시 대체)
# 예: INTERNAL_API_URL=https://his.example.org
CMD ["node", "server.js"]
