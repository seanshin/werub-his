# ============================================================================
# HIS 웹 이미지 — 컨테이너 설치 경로(`infra/docker/docker-compose.prod.yml`)
#
# 🔴 2026-09-21 설치 재현성(갈래 E · 형제 프로젝트 R2·R3·R4 회신):
#    · R3 `next build` 가 Node 기본 힙에서 134 로 죽었다 → 빌드 명령에만 힙을 준다.
#      실측(customer-install-guide §2.1): 힙 3072~4096 성공 · **메모리 한도 6GB 이상**이 필요하다
#      (5GB·4GB 한도는 힙을 줄여도 137 강제 종료). Docker 데몬 메모리를 먼저 본다.
#    · R4 runner 가 `.next/standalone` 을 복사하는데 `next.config.ts` 에 `output: 'standalone'` 이
#      없어 **COPY 가 실패**했다 → 빌드 단계가 `NEXT_OUTPUT=standalone` 을 켜고 next.config 가 그때만 켠다.
#      🔴 next.config 에서 무조건 켜지 않는다 — `deploy.sh` 경로(검증된 정본)의 빌드 시간·메모리를
#         건드리지 않기 위해서다. 이 파일과 next.config 의 짝은 가드가 기계 대조한다.
#    · R2 `src/lib/sanitize.ts` 가 `dompurify` 를 쓰는데 `apps/web/package.json` 에 선언이 없어
#      이 단계(web·shared 만 설치)에서 `Module not found` 였다 → 선언을 보탰다(package.json·lock).
#
# 🔴 확인한 것/못한 것: 파일 대조로 고쳤고 `docker build` 는 돌리지 않았다.
#    계약 가드: `apps/api/test/architecture/container-install-contract.spec.ts`
# ============================================================================
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci --workspace=@hospital-run/web --workspace=@hospital-run/shared

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# shared 패키지 먼저 빌드(dist) → @hospital-run/shared 모듈 resolve
RUN npm run build --workspace=@hospital-run/shared
# 🔴 standalone 산출물은 이 단계에서만 요청한다(runner 의 COPY 가 그것을 집는다)
ENV NEXT_OUTPUT=standalone
RUN cd apps/web && NODE_OPTIONS=--max-old-space-size=4096 npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000
# 🔴 모노레포 standalone 은 워크스페이스 경로를 유지한다(`apps/web/server.js`) — 루트 `server.js` 가 아니다
CMD ["node", "apps/web/server.js"]
