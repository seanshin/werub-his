# ============================================================================
# HIS API 이미지 — 컨테이너 설치 경로(`infra/docker/docker-compose.prod.yml`)
#
# 🔴 2026-09-21 설치 재현성(갈래 E · 형제 프로젝트 R1·R5·R7·R49 회신): 저장소 원본만으로는 이 경로로
#    설치본을 만들 수 없었다. 막힌 곳을 여기서 닫는다.
#    · Node 20 이었는데 `package.json` engines 는 `>=22 <23`·`.nvmrc` 는 22 였다 → 22 로 맞춘다.
#    · `nest build` 가 Node **기본 힙**에서 134(힙 부족)로 죽었다 → 빌드 명령에만 힙을 준다(R1).
#      실측(customer-install-guide §2.1): 힙 3072 · cgroup 피크 3,441MB · 한도 4GB 이상 필요.
#      🔴 `ENV NODE_OPTIONS` 로 두지 않는다 — 런타임 컨테이너는 메모리 한도 1G 라 힙 상한 3GB 는 위험하다.
#    · 운영 이미지는 `npm prune --production` 이라 **`prisma` CLI(devDependency)가 없다** —
#      compose 의 `migrate` 서비스가 이 이미지로 `prisma migrate deploy` 를 부를 수 없었다(R5·R7).
#      → 단계를 갈라 `builder` 를 남긴다. migrate 는 `target: builder` 로 이 단계를 쓴다.
#
# 🔴 확인한 것/못한 것: 아래 구조는 **파일 대조**로 고쳤고 `docker build` 를 돌려 보지는 않았다.
#    `test/architecture/container-install-contract.spec.ts` 가 compose ↔ Dockerfile ↔ next.config 의
#    계약(단계 이름·힙·prune 대상·Node 판)만 기계 대조한다 — 빌드 성공을 보증하지 않는다.
# ============================================================================

# ── builder — 개발 의존성(prisma CLI·nest CLI·ts-node)이 살아 있는 단계 ──
FROM node:22-alpine AS builder

WORKDIR /app

# Install all dependencies
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN npm install

# Copy source and build
COPY . .
# shared 패키지 먼저 빌드(dist) → @hospital-run/shared 모듈 resolve
RUN npm run build --workspace=@hospital-run/shared
RUN cd apps/api && npx prisma generate
# 🔴 힙은 이 RUN 에서만 (실측 3072 성공 · 기본 힙은 134 로 죽는다)
RUN cd apps/api && NODE_OPTIONS=--max-old-space-size=3072 npx nest build

# ── runtime — 운영 이미지(api·sentinel 이 함께 쓴다) ──
FROM builder AS runtime

# Prune dev dependencies, but keep workspace packages
# 🔴 `apps/api/src` 는 지우지 않는다 — 상시 감시자(sentinel)의 `pipe.unconsumedEvents` 관측점이
#    저장소 소스를 읽는다. 지우면 컨테이너 설치 기관에서 그 축이 영구 '관측 불가'가 된다.
RUN npm prune --production && \
    rm -rf node_modules/@hospital-run && \
    mkdir -p node_modules/@hospital-run && \
    cp -r packages/shared node_modules/@hospital-run/shared && \
    rm -rf apps/web .next .git

EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
