#!/usr/bin/env bash
# ============================================================================
# HIS 빈 DB 설치 — 상용 릴리즈 T2-5 (2026-09-13)
#
#   빈 PostgreSQL 16 → migrate deploy → 부속 객체 확인 → 필수 마스터 적재 → 기관 초기화(빈 값)
#   → 관리자 1명 → REAL 모드 부팅 확인
#
# 🔴 검증 범위(정직하게 적는다): 2026-09-14 **로컬 컨테이너 리허설**(node:22-bookworm · postgres:16-alpine · redis:7-alpine ·
#    8GB)에서 빈 DB 부터 7단계 끝까지 성공했다 — 그 과정에서 멈춘 4곳(.env 미적재·shared 미빌드·빌드 힙 부족·재실행 불가)을
#    이 파일에 반영했다. 🔴 약가 마스터는 **합성 3행 CSV** 로 적재 경로만 확인했다(실제 원천 파일 아님).
#    릴리즈 게이트 G9 "빈 서버 설치 리허설 1회 성공"은 여전히 **실제 서버에서 사람이 확인**해야 통과로 센다.
#
# 🔴 기존 DB 에는 쓰지 않는다 — 1단계가 public 스키마에 테이블이 하나라도 있으면 멈춘다.
#    운영 DB 를 기준선으로 옮기는 절차는 이 스크립트가 아니다: docs/05-reference/sql-inventory.md §운영 적용.
# 🔴 데모 시드(prisma/seed*.ts · seeds/**)는 부르지 않는다 — REAL 에서는 seed-mode-guard 가 어차피 거부한다.
#
# 사용:
#   infra/install/install.sh --dry-run
#   DATABASE_URL=… HIS_MODE=REAL ADMIN_EMAIL=… ADMIN_PASSWORD=… ADMIN_FAMILY_NAME=… ADMIN_GIVEN_NAME=… \
#     infra/install/install.sh --masters-dir /path/to/masters [--allow-unverified-masters] [--skip-boot-check]
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
API="$ROOT/apps/api"
MANIFEST="$HERE/masters.manifest.tsv"
# 산출물 기록(BUILD_INFO.json)·빌드 메모리 판정 — 형식 정본은 deploy.sh build_info_json · 기계 대조 install-build-info.spec.ts
# shellcheck source=infra/install/build-info.sh
. "$HERE/build-info.sh"

DRY_RUN=0
MASTERS_DIR=""
ALLOW_UNVERIFIED=0
SKIP_BOOT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --masters-dir) MASTERS_DIR="${2:-}"; shift 2 ;;
    --allow-unverified-masters) ALLOW_UNVERIFIED=1; shift ;;
    --skip-boot-check) SKIP_BOOT=1; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "🔴 알 수 없는 옵션: $1"; exit 1 ;;
  esac
done

log()  { echo "[install $(date +%H:%M:%S)] $*"; }
fail() { echo "🔴 $*" >&2; exit 1; }
run()  { if [ "$DRY_RUN" = 1 ]; then echo "  (dry-run) $*"; else eval "$@"; fi; }

# ── 0. 전제 ───────────────────────────────────────────────────────────────────
log "0/7 전제 확인"

# 🔴 설치 가이드는 루트 `.env` 를 만들라고 하는데 이 스크립트는 환경변수만 봤다 —
#    가이드대로 한 설치자가 0단계에서 "DATABASE_URL 이 비었습니다"로 멈췄다(2026-09-14 리허설 실측).
#    파일을 읽되 **이미 설정된 환경변수를 덮지 않는다**(명령행 export 가 파일을 이긴다 — dotenv 와 같은 우선순위).
if [ -f "$ROOT/.env" ]; then
  log "  .env 읽음: $ROOT/.env (이미 설정된 환경변수는 덮지 않는다)"
  while IFS= read -r line; do
    case "$line" in ''|\#*) continue ;; esac
    case "$line" in *=*) ;; *) continue ;; esac
    k="${line%%=*}"; v="${line#*=}"
    k="$(printf '%s' "$k" | tr -d '[:space:]')"
    case "$k" in ''|*[!A-Za-z0-9_]*) continue ;; esac
    [ -n "${!k:-}" ] && continue
    v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
    export "$k=$v"
  done < "$ROOT/.env"
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
WANT_NODE="$(tr -d '[:space:]' < "$ROOT/.nvmrc" 2>/dev/null || echo 22)"
[ "$NODE_MAJOR" = "$WANT_NODE" ] || { [ "$DRY_RUN" = 1 ] && log "  ⚠ Node ${NODE_MAJOR} — .nvmrc 는 ${WANT_NODE}(dry-run 이라 계속)"; } || fail "Node ${WANT_NODE} 가 필요합니다(현재 ${NODE_MAJOR}) — .nvmrc"
command -v psql >/dev/null 2>&1 || [ "$DRY_RUN" = 1 ] || fail "psql 이 필요합니다(PostgreSQL 클라이언트 — Debian/Ubuntu: apt-get install postgresql-client · 1·3단계 조회에만 쓴다)"
[ -d "$ROOT/node_modules" ] || [ "$DRY_RUN" = 1 ] || fail "의존성이 없습니다 — 저장소 루트에서 \`npm ci\` 를 먼저 실행하세요(lockfile 강제)"
# 🔴 설치본이 어느 릴리즈인지 — 빌드 전에 판정한다. 저장소 루트면 HEAD·dirty, 릴리즈 사본이면 RELEASE_COMMIT,
#    둘 다 아니면 **모름**(commit=null) — 추정하지 않는다(2026-09-14 리허설: 설치본의 공개 버전 EP 가 commit=null 이었다)
his_resolve_commit "$ROOT"
case "$HIS_BUILD_COMMIT_SOURCE" in
  git)     log "  산출물 커밋: ${HIS_BUILD_COMMIT:0:12} (저장소 HEAD · dirty=${HIS_BUILD_DIRTY:-모름})" ;;
  release) log "  산출물 커밋: ${HIS_BUILD_COMMIT:0:12} (릴리즈 사본 RELEASE_COMMIT · dirty=모름 — 풀어 둔 뒤의 수정은 알 수 없다)" ;;
  *)       log "  ⚠ 산출물 커밋: 모름 — 저장소 루트도 릴리즈 사본(RELEASE_COMMIT)도 아니다. 공개 버전 EP 는 commit=null 로 답한다" ;;
esac
# 🔴 빌드 메모리 — 빌드가 **원인을 말하지 않고** 죽었다(2026-09-14 리허설·실측 · customer-install-guide §2 메모리 표):
#    `nest build` 는 Node 기본 힙에서 134(힙 OOM)로 죽고, 힙 3072 에서 cgroup 피크 약 3.4~3.6GB 로 성공했다.
#    → 가용 메모리를 **빌드 전에** 재서 모자라면 숫자와 함께 멈추고, 힙은 가용 메모리에서 정한다(설치자가 NODE_OPTIONS 를 정했으면 그대로).
#    잴 수 없으면(비 Linux 등) 막지 않고 알린다 · 알고 진행하려면 HIS_SKIP_MEMORY_CHECK=1.
# shellcheck source=infra/install/build-memory.sh
. "$HERE/build-memory.sh"
HIS_API_BUILD_MIN_MB="${HIS_API_BUILD_MIN_MB:-4096}"
HIS_WEB_BUILD_MIN_MB=6144
MEM_AVAIL_MB="$(his_mem_available_mb)"
if [ -z "${NODE_OPTIONS:-}" ]; then
  HEAP_MB="$(his_build_heap_mb "$MEM_AVAIL_MB" "$HIS_API_BUILD_MIN_MB" 6144)"
  [ "$HEAP_MB" -lt 3072 ] && HEAP_MB=3072
  export NODE_OPTIONS="--max-old-space-size=${HEAP_MB}"
fi
if [ -z "$MEM_AVAIL_MB" ]; then
  log "  ⚠ 가용 메모리: 잴 수 없음(/sys/fs/cgroup·/proc/meminfo 없음) — 판정 없이 진행한다 · NODE_OPTIONS=${NODE_OPTIONS}"
else
  log "  가용 메모리 ${MEM_AVAIL_MB}MB · API 빌드 최소 ${HIS_API_BUILD_MIN_MB}MB · NODE_OPTIONS=${NODE_OPTIONS}"
  # 웹 빌드는 이 스크립트 범위 밖이지만 같은 서버에서 한다면 미리 알린다(4·5GB 한도에서 137 강제 종료 실측)
  [ "$MEM_AVAIL_MB" -lt "$HIS_WEB_BUILD_MIN_MB" ] && log "  ⚠ 웹 next build 는 가용 ${HIS_WEB_BUILD_MIN_MB}MB 이상이 필요했다(실측) — 이 서버에서 웹을 빌드하면 137 로 죽을 수 있다"
  if [ "$SKIP_BOOT" = 0 ] && [ "$DRY_RUN" = 0 ] && [ "$MEM_AVAIL_MB" -lt "$HIS_API_BUILD_MIN_MB" ]; then
    [ "${HIS_SKIP_MEMORY_CHECK:-}" = 1 ] \
      && log "  ⚠ 가용 메모리 ${MEM_AVAIL_MB}MB < ${HIS_API_BUILD_MIN_MB}MB — HIS_SKIP_MEMORY_CHECK=1 로 알고 진행한다(빌드가 134/137 로 죽을 수 있다)" \
      || fail "가용 메모리 ${MEM_AVAIL_MB}MB 가 API 빌드 최소 ${HIS_API_BUILD_MIN_MB}MB 보다 작습니다 — 빌드가 원인을 말하지 않고 134/137 로 죽습니다. 다른 프로세스를 줄이거나 메모리를 늘리세요(알고 진행: HIS_SKIP_MEMORY_CHECK=1)"
  fi
fi
if [ "$DRY_RUN" = 0 ]; then
  [ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL 이 비었습니다"
  # 🔴 판매본 설치는 REAL 이다 — 명시하지 않으면 멈춘다(모르면 안전측이지만, 설치는 조용히 추정하지 않는다)
  [ "${HIS_MODE:-}" = "REAL" ] || fail "HIS_MODE=REAL 을 명시하세요(현재: ${HIS_MODE:-미설정}) — 빈 DB 판매본 설치 전용"
  for k in AUTH_SECRET AUTH_REFRESH_SECRET ENCRYPTION_KEY REDIS_URL; do
    [ -n "${!k:-}" ] || fail "$k 가 비었습니다 — .env.example 의 필수 키를 채우세요"
  done
fi

# ── 1. 빈 DB 확인 ─────────────────────────────────────────────────────────────
log "1/7 빈 DB 확인(public 스키마 테이블 0 이어야 한다)"
if [ "$DRY_RUN" = 0 ]; then
  N="$(psql "$DATABASE_URL" -Atc "select count(*) from information_schema.tables where table_schema='public'")"
  # 🔴 이 스크립트는 **이어서 실행되지 않는다** — 2단계 이후에 실패했으면 DB 에 테이블이 남아 재실행이 여기서 멈춘다(리허설 실측).
  #    설치 중단 후 재시도는 **새 빈 DB** 로 한다(데이터가 있는 DB 를 비우는 명령은 일부러 적지 않는다).
  [ "$N" = "0" ] || fail "public 스키마에 테이블 ${N}개 — 빈 DB 가 아닙니다. 설치가 중간에 실패한 뒤라면 새 빈 DB 를 만들어 다시 실행하세요. 운영 중인 기존 DB 는 sql-inventory.md §운영 적용 절차를 따르세요."
  PGV="$(psql "$DATABASE_URL" -Atc "show server_version_num")"
  [ "${PGV:0:2}" = "16" ] || fail "PostgreSQL 16 전용입니다(현재 server_version_num=${PGV}) — String[]·pg_trgm·advisory lock"
else
  echo "  (dry-run) psql \$DATABASE_URL: count(public tables) == 0 · server_version_num 16xxxx"
fi

# ── 2. 스키마 ─────────────────────────────────────────────────────────────────
log "2/7 prisma migrate deploy (00000000000000 시퀀스·확장 → 00000000000001 기준선 → GIN → 부속 제약)"
run "cd '$API' && npx prisma generate >/dev/null && npx prisma migrate deploy"

# ── 3. 부속 객체 확인 ─────────────────────────────────────────────────────────
# 🔴 migrate deploy 가 "성공"이라 말해도 확인한다 — 정합성 객체(부분 유니크·트리거)가 빠지면 조용히 틀린다.
log "3/7 부속 객체 확인"
CHECK_SQL="select
  (select count(*) from pg_extension where extname='pg_trgm') as trgm,
  (select count(*) from pg_class where relkind='S' and relname='mrn_daily_seq') as mrn_seq,
  (select count(*) from pg_indexes where indexname in ('uq_er_bed_active','uq_er_visit_active','consent_templates_name_lang_latest_key','formulary_items_uniq_nn')) as uniq4,
  (select count(*) from pg_trigger where tgname='trg_voucher_events_append_only') as trg"
if [ "$DRY_RUN" = 0 ]; then
  R="$(psql "$DATABASE_URL" -Atc "$CHECK_SQL")"
  [ "$R" = "1|1|4|1" ] || fail "부속 객체가 기대와 다릅니다(trgm|seq|uniq4|trigger = ${R}, 기대 1|1|4|1)"
else
  echo "  (dry-run) 기대 trgm|seq|uniq4|trigger = 1|1|4|1"
fi

# ── 4. 필수 마스터 ────────────────────────────────────────────────────────────
log "4/7 필수 마스터 적재(매니페스트: infra/install/masters.manifest.tsv)"
UNVERIFIED=0
while IFS=$'\t' read -r key name src asof status cmd file; do
  case "$key" in ''|\#*) continue ;; esac
  echo "  · ${key} — ${name} · 출처: ${src} · 기준일: ${asof} · ${status}"
  if [ "$status" != "VERIFIED" ]; then
    UNVERIFIED=$((UNVERIFIED + 1)); echo "    🔴 원천 미확인 — 적재 경로: ${cmd}"; continue
  fi
  if [ "$DRY_RUN" = 1 ]; then echo "  (dry-run) cd apps/api && ${cmd//\{FILE\}/<masters-dir>/$file}"; continue; fi
  [ -n "$MASTERS_DIR" ] || fail "--masters-dir 가 필요합니다(${file})"
  [ -f "$MASTERS_DIR/$file" ] || fail "마스터 파일이 없습니다: $MASTERS_DIR/$file"
  run "cd '$API' && ${cmd//\{FILE\}/$MASTERS_DIR/$file}"
done < "$MANIFEST"
if [ "$UNVERIFIED" -gt 0 ] && [ "$ALLOW_UNVERIFIED" = 0 ] && [ "$DRY_RUN" = 0 ]; then
  fail "원천 미확인 마스터 ${UNVERIFIED}건 — 판매본에 원천 모를 코드표를 넣지 않습니다. 확정 전이면 --allow-unverified-masters 로 **빈 상태를 알고** 진행하세요."
fi
[ "$UNVERIFIED" -gt 0 ] && log "  ⚠ 원천 미확인 ${UNVERIFIED}건은 적재하지 않았습니다(진단·수가·검사 코드가 빈 상태)"

# ── 5. 기관 초기화 ────────────────────────────────────────────────────────────
# 🔴 기관 정보는 **넣지 않는다**(빈 값). 개발용 기본값(Hospital RUN·02-1234-5678)으로 떨어지지 않게,
#    부팅 후 /admin/ai-settings(「시스템 설정」 · 값을 바꾸는 화면)에서 설치 기관이 직접 입력한다.
#    🔴 /admin/config 는 같은 값을 보기만 하는 읽기 전용 목록이다(2026-09-13 외부 실측 S8 — 거기로 안내해 입력이 안 됐다).
#    미입력 상태의 법정 서식 발급 차단은 T3-2(go-live 게이트)가 맡는다.
log "5/7 기관 초기화 — 값을 넣지 않는다. 부팅 후 /admin/ai-settings(시스템 설정)에서 hospital.* 필수 키를 입력하세요"
echo "    hospital.name · hospital.nameEn · hospital.address · hospital.phone · hospital.emergency · hospital.code(요양기관기호)"
echo "    hospital.bizNo · hospital.ceo · hospital.license · hospital.country · hospital.hours.*"

# ── 6. 관리자 1명 ─────────────────────────────────────────────────────────────
log "6/7 관리자 1명 생성(비밀번호는 환경변수로만 — 명령행 인자 금지)"
run "cd '$API' && node '$HERE/create-admin.cjs'"

# ── 7. REAL 부팅 확인 ─────────────────────────────────────────────────────────
if [ "$SKIP_BOOT" = 1 ]; then
  log "7/7 부팅 확인 건너뜀(--skip-boot-check) — 🔴 G9 통과로 세지 않는다"
  log "  ⚠ 빌드도 건너뛰므로 산출물 기록(apps/api/BUILD_INFO.json)을 쓰지 않는다 — 공개 버전 EP 는 buildInfo=unavailable 로 답한다"
else
  log "7/7 REAL 모드 부팅 확인(nest build → dist/main.js 기동 → /health → 종료)"
  if [ "$DRY_RUN" = 0 ]; then
    # 🔴 shared 를 먼저 빌드한다 — `packages/shared/dist` 는 저장소에 없다(gitignore). 없으면 API 빌드가
    #    `@hospital-run/shared` 를 못 찾아 178 오류로 죽는다(2026-09-14 리허설 실측 · 개발기는 dist 가 남아 있어 안 보였다).
    log "  shared 빌드(packages/shared → dist)"
    (cd "$ROOT/packages/shared" && npm run build >/dev/null) || fail "shared 빌드 실패 — packages/shared 에서 npm run build 를 직접 실행해 오류를 보세요"
    log "  API 빌드(nest build · NODE_OPTIONS=${NODE_OPTIONS})"
    (cd "$API" && npx nest build >/tmp/his-install-build.log 2>&1) || fail "API 빌드 실패 — /tmp/his-install-build.log (메모리 부족이면 NODE_OPTIONS 힙을 늘리세요)"
    # 🔴 산출물 기록은 빌드가 **성공한 뒤에만** 쓴다(deploy.sh 와 같은 규약 — 실패한 빌드가 새 커밋을 말하지 않게)
    test -f "$API/dist/main.js" || fail "API 빌드가 dist/main.js 를 만들지 않았습니다 — /tmp/his-install-build.log"
    his_build_info_json "$ROOT/packages/shared/src/constants.ts" "$HIS_BUILD_COMMIT" "$HIS_BUILD_DIRTY" "install.sh" "$HIS_BUILD_COMMIT_SOURCE" > "$API/BUILD_INFO.json"
    log "  산출물 기록: $(cat "$API/BUILD_INFO.json")"
    PORT_CHECK="${PORT:-4000}"
    # 🔴 (2026-09-14 리허설 실측) 포트에 이미 무언가 떠 있으면 /health 응답은 **방금 빌드한 서버의 것이 아니다.**
    #    옛 부팅 확인이 남긴 고아 프로세스가 4시간 동안 대신 답했고, 새 서버는 EADDRINUSE 로 죽었는데 7단계는 "성공"이었다.
    if curl -fsS -o /dev/null "http://127.0.0.1:${PORT_CHECK}/health" 2>/dev/null; then
      fail "포트 ${PORT_CHECK} 에 이미 서버가 응답합니다 — 부팅 확인이 그 서버의 응답을 대신 읽게 됩니다. 그 프로세스를 끄거나 PORT 를 바꾸세요."
    fi
    # 🔴 `(cd … && node … &)` 는 $! 가 **서브셸** PID 라 kill 이 node 를 못 죽였다(고아 프로세스의 원인) — node 를 직접 띄운다
    cd "$API"
    HIS_MODE=REAL node dist/main.js > /tmp/his-install-boot.log 2>&1 &
    BOOT_PID=$!
    cd "$ROOT"
    echo "$BOOT_PID" > /tmp/his-install-boot.pid
    OK=0
    for _ in $(seq 1 60); do
      if curl -fsS "http://127.0.0.1:${PORT_CHECK}/health" >/tmp/his-install-health.json 2>/dev/null; then OK=1; break; fi
      # 부팅 거부(REAL 보안 기본값 위반)면 프로세스가 곧 끝난다 — 120초를 기다리지 않는다
      kill -0 "$BOOT_PID" 2>/dev/null || break
      sleep 2
    done
    VERSION_JSON="$(curl -fsS "http://127.0.0.1:${PORT_CHECK}/api/v1/public/version" 2>/dev/null || true)"
    # 응답한 것이 우리 프로세스인지 — 응답 직후 우리 프로세스가 살아 있어야 한다(죽었으면 다른 무언가가 답한 것)
    if [ "$OK" = 1 ] && ! kill -0 "$BOOT_PID" 2>/dev/null; then
      fail "/health 는 응답했지만 방금 띄운 API(PID ${BOOT_PID})는 이미 끝났습니다 — 다른 프로세스가 응답했습니다. /tmp/his-install-boot.log"
    fi
    kill "$BOOT_PID" 2>/dev/null || true
    wait "$BOOT_PID" 2>/dev/null || true
    if [ "$OK" != 1 ]; then
      grep -E "부팅을 거부|║" /tmp/his-install-boot.log 2>/dev/null | head -12 >&2 || true
      fail "API 가 /health 에 응답하지 않았습니다 — /tmp/his-install-boot.log (위에 부팅 거부 사유가 있으면 .env 의 [판매본 필수] 키를 채우세요)"
    fi
    log "  /health: $(cat /tmp/his-install-health.json)"
    # 🔴 설치가 REAL 이라고 말하는 것과 떠 있는 서버가 REAL 인 것은 다른 사실이다 — 서버 응답으로 확인한다
    case "$VERSION_JSON" in
      *'"mode":"REAL"'*) log "  /api/v1/public/version: $VERSION_JSON" ;;
      *) fail "서버가 보고한 운영 모드가 REAL 이 아닙니다: ${VERSION_JSON:-응답 없음}" ;;
    esac
    # 🔴 기록을 쓴 것과 떠 있는 서버가 그 기록을 읽는 것은 다른 사실이다 — 서버가 말한 커밋으로 확인한다
    if [ -n "$HIS_BUILD_COMMIT" ]; then EXPECT_COMMIT="\"commit\":\"${HIS_BUILD_COMMIT}\""; else EXPECT_COMMIT='"commit":null'; fi
    case "$VERSION_JSON" in
      *"$EXPECT_COMMIT"*'"buildInfo":"file"'*) log "  서버가 보고한 산출물 커밋이 기록과 같다(${HIS_BUILD_COMMIT:-모름})" ;;
      *) fail "서버가 보고한 산출물 기록이 방금 쓴 기록과 다릅니다(기대 ${EXPECT_COMMIT} · buildInfo=file): ${VERSION_JSON:-응답 없음}" ;;
    esac
  else
    echo "  (dry-run) nest build · HIS_MODE=REAL node dist/main.js · curl 127.0.0.1:\${PORT:-4000}/health"
  fi
fi

log "설치 단계 완료 — 🔴 이것은 스키마·필수 마스터·관리자까지다. 판매본 전환(REAL 체크리스트)은 docs/05-reference/real-mode-cutover.md"
