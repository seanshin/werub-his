#!/bin/bash
# Hospital RUN — 안전한 배포 스크립트
# 사용법: ./infra/scripts/deploy.sh [--schema] [--seed] [--api] [--web] [--all] [--mode dev|rehearsal|real]
#
# --schema: Prisma 스키마 변경 배포 (자동 백업 포함)
# --seed:   시드 데이터 실행
# --api:    API 소스 배포 + 빌드
# --web:    Web 소스 배포 + 빌드
# --all:    전체 배포 (schema + api + web)
# --mode:   운영 모드 전환 (dev|rehearsal|real) — 🔴 **주면 서버에 못박히고, 안 주면 서버의 현재 값을 이어받는다.**
#           리얼이 아니면 ①시드 로그인 패널이 번들에 포함되고 ②대외 발신이 전부 차단되며 ③모드 배너가 뜬다.
#           정본 packages/shared/src/his-mode.ts · 런타임 토글은 /admin 설정(빌드보다 넓힐 수는 없다)

set -euo pipefail

# ============================================================
# 설정 — 🔴 2026-09-09 서버 이전: ML 서버(203.0.113.10:22). 도메인 his.example.org 은 그대로이며
#   Cloudflare Tunnel(pm2 `his-tunnel`) 이 :4000/:3000 으로 직접 분기한다(nginx 없음).
#   🔴 배포는 **로컬 working tree → rsync → 서버 빌드** 뿐이다. git pull·GitHub Actions·컨테이너 레지스트리 등
#   GitHub 기능은 어떤 단계에서도 쓰지 않는다(서버에 .git 도 없다).
# ============================================================
LOCAL_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
# 🔴 (2026-09-13 상용 릴리즈 T3-5) 서버 종속 값을 **설정 파일로** 뺐다 — 종전엔 IP·포트·경로가 이 파일에 박혀
#    다른 설치 대상에 쓸 수 없었다. 규약:
#    · `infra/scripts/deploy.env`(gitignore)가 있으면 읽는다 — 형식은 `deploy.env.example`.
#    · 🔴 **없으면 종전 값 그대로**(아래 기본값) — 이 변경이 기존 배포를 한 글자도 바꾸지 않게 한다.
#    · 환경변수로 넘긴 값이 파일보다 우선한다(`HIS_SERVER=... ./deploy.sh`).
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-$(dirname "$0")/deploy.env}"
if [ -f "${DEPLOY_ENV_FILE}" ]; then
  # 파일 값은 **아직 비어 있는 변수에만** 적용한다(환경변수 우선)
  # 🔴 `[ … ] && export` 로 쓰면 조건이 거짓인 마지막 줄이 루프 종료 코드가 되어 `set -e` 가 스크립트를 죽인다 — if 로 쓴다.
  while IFS='=' read -r _k _v || [ -n "${_k:-}" ]; do
    [[ "${_k}" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    if [ -z "${!_k:-}" ]; then export "${_k}=${_v}"; fi
  done < "${DEPLOY_ENV_FILE}"
fi
SERVER="${HIS_SERVER:-deploy@203.0.113.10}"
SSH_PORT="${HIS_SSH_PORT:-22}"
REMOTE_DIR="${HIS_REMOTE_DIR:-/home/deploy/his-backup/weruby/hospital-run}"
# 공개 URL — 부팅 확인·스모크 웜업·FRONTEND_URL 이 쓴다
HIS_PUBLIC_URL="${HIS_PUBLIC_URL:-https://his.example.org}"
# 원격 백업 위치(배포 전 백업·복원 안내문)
HIS_BACKUP_DIR="${HIS_BACKUP_DIR:-/home/deploy/backups/hospitalrun}"
HIS_BACKUP_PASSPHRASE_FILE="${HIS_BACKUP_PASSPHRASE_FILE:-/home/deploy/.backup-passphrase}"
# 🔴 비대화형 ssh 에는 node/npm/pm2 가 PATH 에 없다(nvm). pm2 God Daemon 이 v22.22.1 로 떠 있으므로
#    같은 버전을 못박는다 — 다른 node 의 pm2 를 부르면 데몬 소켓은 같아도 버전이 갈릴 수 있다.
REMOTE_NODE_BIN="${HIS_REMOTE_NODE_BIN:-/home/deploy/.nvm/versions/node/v22.22.1/bin}"
# 서버 Node 주 버전 — engines(`>=22 <23`)·CI 와 같은 값이어야 한다(네 갈래로 갈라져 있었다: 로컬 25·서버 22·CI 20·engines >=20)
HIS_NODE_MAJOR="${HIS_NODE_MAJOR:-22}"
REMOTE_ENV="export PATH=${REMOTE_NODE_BIN}:\$PATH TZ=Asia/Seoul;"
# 모든 원격 명령은 이 함수로 — PATH 주입을 한 곳에서 한다(직접 ssh 를 부르면 node 를 못 찾는다)
remote() { ssh -p "${SSH_PORT}" "${SERVER}" "${REMOTE_ENV} $1"; }
rsync_run() { rsync -avz -e "ssh -p ${SSH_PORT}" "$@"; }

# ============================================================
# 🔴 긴 원격 작업은 **분리 실행**한다 (2026-09-10 신설)
#
# 종전에는 웹/API 빌드가 **단일 ssh 세션 안에서** 돌았다. 세션이 끊기면 빌드→검증→스왑 체인이
# 통째로 날아간다 — 실제로 웹 배포가 연속 2회 `Connection closed by remote host` 로 죽었다
# (메모리 13.8GB 여유·부하 1.16·OOM 흔적 없음 → 자원 문제가 아니라 세션이 끊긴 것이다).
# 그때 `.next-build` 가 남아 **스왑 전** 상태였고 사이트는 직전 빌드를 계속 서비스했다(그건 정상 동작).
#
# 규약
#  · 체인(빌드→검증→스왑)은 **서버 쪽 스크립트 안에서 그대로** 돈다 — 원자성은 손대지 않는다.
#  · 스크립트는 **파일로 올린다.** 인라인 인용은 깨지기 쉽다(실제로 깨져 아무것도 실행되지 않은 적이 있다).
#  · 🔴 성공은 **완료 파일**로만 판정한다(로그 문자열이 아니다). 로그에서 마커를 찾는 방식은
#    본문이 그 문자열을 **출력만 해도** 완료로 읽힌다 — 자체 시험에서 실제로 뚫렸고, 앞서
#    사람이 수동 배포할 때도 오류 메시지 안의 문자열을 보고 "완료"라 오판한 적이 있다.
#    완료 파일은 `set -e` 를 통과한 **마지막 줄에서만** 만들어진다.
#  · 🔴 시한을 넘기면 **실패로 말하지 않고 "판정 불가"** 로 말한다(아직 돌고 있을 수 있다).
# ============================================================
remote_detached() {
  local name="$1" body="$2" max_wait="${3:-1800}"
  local donef="/tmp/his-deploy-${name}.done"
  local script="/tmp/his-deploy-${name}.sh"
  local logf="/tmp/his-deploy-${name}.log"
  local pidf="/tmp/his-deploy-${name}.pid"

  ssh -p "${SSH_PORT}" "${SERVER}" "cat > ${script} && chmod +x ${script}" <<REMOTE_SCRIPT
#!/bin/bash
set -e
export PATH=${REMOTE_NODE_BIN}:\$PATH
export TZ=Asia/Seoul
echo \$\$ > ${pidf}
${body}
touch ${donef}
REMOTE_SCRIPT

  remote "rm -f ${logf} ${pidf} ${donef}; nohup ${script} > ${logf} 2>&1 & disown; echo started" >/dev/null
  log "${name} 원격 실행 시작(분리) — 로그 ${logf}"

  local waited=0 st=""
  while [ "${waited}" -lt "${max_wait}" ]; do
    sleep 15; waited=$((waited + 15))
    # 🔴 마커를 먼저 본다 — 끝난 프로세스는 pid 로는 '없음'이라 실패로 오독된다
    st="$(ssh -p "${SSH_PORT}" -o ConnectTimeout=20 "${SERVER}" "
      if [ -f ${donef} ]; then echo DONE;
      elif [ -f ${pidf} ] && kill -0 \$(cat ${pidf}) 2>/dev/null; then echo RUNNING;
      else echo STOPPED; fi" 2>/dev/null || echo UNREACHABLE)"
    case "${st}" in
      DONE)    log "${name} 완료(완료 파일 확인)"; return 0 ;;
      STOPPED) log "🔴 ${name} 실패 — 완료 파일 없이 종료. 로그 끝:"; remote "tail -25 ${logf}" || true; return 1 ;;
      UNREACHABLE) log "  (연결 일시 실패 — 원격 작업은 계속된다. 재시도)" ;;
      *)       [ $((waited % 60)) -eq 0 ] && log "  ${name} 진행 중... ${waited}s" ;;
    esac
  done
  # 🔴 시한 초과는 실패가 아니다 — 모르는 것이다. 단정하지 않는다.
  log "🔴 ${name} 시한(${max_wait}s) 안에 끝나지 않았다 — **실패로 단정하지 않는다.**"
  log "   서버에서 확인: tail -f ${logf} · 끝나면 ${donef} 가 생긴다."
  return 2
}
# pm2 프로세스 이름 — 서버 ecosystem.config.js(~/his-backup) 정본: his-api · his-web · his-tunnel · his-proxy
PM2_API="his-api"; PM2_WEB="his-web"; PM2_SENTINEL="his-sentinel"

# PM2 환경변수 — CLINIC_*·시크릿은 서버 .env에서 로드(여기 하드코딩 금지: 스테일 키로 .env 덮어쓰던 버그)
PM2_ENV="TZ=Asia/Seoul FRONTEND_URL=${HIS_PUBLIC_URL} BUILD_INFO_PATH=${REMOTE_DIR}/apps/api/BUILD_INFO.json"

# ============================================================
# 함수
# ============================================================
log() { echo "[$(date '+%H:%M:%S')] $1"; }

# ============================================================
# 🔴 릴리즈 고정 사전 점검 (2026-09-13 · 상용 릴리즈 기획 T1-4 · T2-6)
#
# 배포 원천은 **로컬 working tree → rsync** 다. 그래서 종전엔
#   ① 커밋되지 않은 변경도 그대로 운영에 나갔고 ② 운영 산출물이 어느 커밋인지 기록이 없었으며
#   ③ 서버 빌드가 의존성을 설치하지 않아 새 의존성이 없는 채로 빌드됐고("빌드 실패해도 배포 완료" 전례)
#   ④ 서버 Node 버전을 확인하지 않았다(로컬 25·서버 22·CI 20·engines >=20 네 갈래).
# 규약: 모르면 막고, 알고 진행하려면 **명시 플래그**로 — 그리고 그 사실을 산출물·로그에 남긴다.
# ============================================================
ALLOW_DIRTY="${ALLOW_DIRTY:-}"
INSTALL_DEPS="${INSTALL_DEPS:-}"
SKIP_DEPS_CHECK="${SKIP_DEPS_CHECK:-}"
BUILD_COMMIT=""
BUILD_DIRTY=""
NEED_NPM_CI=""

# 배포 대상 경로의 커밋·dirty 판정. 전역 BUILD_COMMIT·BUILD_DIRTY 를 채운다.
preflight_git() {
  if ! git -C "${LOCAL_DIR}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    BUILD_COMMIT=""; BUILD_DIRTY=""
    if [ -n "${ALLOW_DIRTY}" ]; then
      log "⚠️ git 저장소가 아니다 — 산출물 커밋을 고정할 수 없다(--allow-dirty 로 진행 · 기록은 commit=null)"
      return 0
    fi
    log "🔴 git 저장소가 아니다 — 어느 커밋을 배포하는지 증명할 수 없어 중단한다(진행하려면 --allow-dirty)"
    return 1
  fi
  BUILD_COMMIT="$(git -C "${LOCAL_DIR}" rev-parse HEAD)"
  local changes n
  # 🔴 배포되는 경로만 본다 — `.claude/worktrees`(병행 에이전트 사본)·docs 는 운영에 나가지 않는다
  changes="$(git -C "${LOCAL_DIR}" status --porcelain --untracked-files=all -- apps packages infra scripts package.json package-lock.json 2>/dev/null || true)"
  if [ -z "${changes}" ]; then
    BUILD_DIRTY="false"
    log "산출물 커밋: ${BUILD_COMMIT:0:12} (clean)"
    return 0
  fi
  BUILD_DIRTY="true"
  n="$(printf '%s\n' "${changes}" | wc -l | tr -d ' ')"
  if [ -n "${ALLOW_DIRTY}" ]; then
    log "⚠️ 커밋되지 않은 변경 ${n}건을 포함해 배포한다(--allow-dirty) — 산출물은 ${BUILD_COMMIT:0:12}+dirty 로 기록된다(커밋으로 증명할 수 없는 코드)"
    return 0
  fi
  log "🔴 커밋되지 않은 변경 ${n}건 — 배포 원천이 working tree(rsync)라 커밋되지 않은 코드가 운영에 나간다. 중단한다."
  printf '%s\n' "${changes}" | head -10 | sed 's/^/     /'
  log "   커밋한 뒤 다시 실행하거나, 알고 진행하려면 --allow-dirty"
  return 1
}

# 서버 Node 주 버전 확인 — engines·CI 와 같은 값이어야 한다
preflight_remote_node() {
  local v
  v="$(remote "node -v" 2>/dev/null | tr -d '\r' || true)"
  case "${v}" in
    v${HIS_NODE_MAJOR}.*) log "서버 Node ${v}"; return 0 ;;
    "") log "🔴 서버 Node 버전을 확인하지 못했다(${REMOTE_NODE_BIN}) — 빌드가 어떤 Node 로 돌지 모른다. 중단한다"; return 1 ;;
    *)  log "🔴 서버 Node ${v} — 요구 v${HIS_NODE_MAJOR}.x(engines·CI 와 같아야 한다). 중단한다(HIS_REMOTE_NODE_BIN·HIS_NODE_MAJOR 확인)"; return 1 ;;
  esac
}

# 워크스페이스 매니페스트 동기화 — npm ci 전에만 부른다(ci 는 package.json 과 lock 이 맞아야 한다)
sync_manifests() {
  rsync_run "${LOCAL_DIR}/package.json" "${LOCAL_DIR}/package-lock.json" "${SERVER}:${REMOTE_DIR}/"
  local ws
  for ws in apps/api apps/web apps/homepage apps/mobile packages/shared; do
    remote "mkdir -p ${REMOTE_DIR}/${ws}"
    rsync_run "${LOCAL_DIR}/${ws}/package.json" "${SERVER}:${REMOTE_DIR}/${ws}/package.json"
  done
}

# 의존성 점검 — lockfile **지문**(워크스페이스 자기 버전·engines 제외 · infra/scripts/lock-fingerprint.mjs)을 서버와 대조한다.
#  같으면 설치 생략(종전과 같다) · 다르면 --install-deps 없이는 중단 · --skip-deps-check 는 종전 동작(경고)
deps_preflight() {
  if [ -n "${SKIP_DEPS_CHECK}" ]; then
    log "⚠️ 의존성 점검 생략(--skip-deps-check) — 서버 node_modules 가 lockfile 과 같은지 확인하지 않는다(새 의존성 미설치 사고의 자리)"
    return 0
  fi
  local local_fp remote_fp reason
  local_fp="$(node "${LOCAL_DIR}/infra/scripts/lock-fingerprint.mjs" "${LOCAL_DIR}/package-lock.json")" || {
    log "🔴 로컬 lockfile 지문을 계산하지 못했다 — 중단"; return 1; }
  rsync_run "${LOCAL_DIR}/infra/scripts/lock-fingerprint.mjs" "${SERVER}:${REMOTE_DIR}/infra/scripts/lock-fingerprint.mjs" >/dev/null
  remote_fp="$(remote "cd ${REMOTE_DIR} && test -f package-lock.json && node infra/scripts/lock-fingerprint.mjs package-lock.json" 2>/dev/null | tr -d '\r' || true)"
  if [ -n "${remote_fp}" ] && [ "${local_fp}" = "${remote_fp}" ]; then
    log "의존성 lockfile 지문 일치(${local_fp:0:12}) — 설치 생략"
    return 0
  fi
  if [ -z "${remote_fp}" ]; then
    reason="서버에 package-lock.json 이 없거나 지문을 계산하지 못했다"
  else
    reason="로컬 ${local_fp:0:12} ≠ 서버 ${remote_fp:0:12}"
  fi
  if [ -n "${INSTALL_DEPS}" ]; then
    log "의존성이 서버와 다르다(${reason}) — 매니페스트 동기화 후 빌드 전에 npm ci 를 실행한다(--install-deps)"
    sync_manifests
    NEED_NPM_CI=1
    return 0
  fi
  log "🔴 의존성이 서버와 다르다(${reason}) — 설치 없이 빌드하면 새 의존성이 없는 채로 빌드·재시작된다. 중단한다."
  log "   --install-deps 로 다시 실행하라(npm ci 는 node_modules 를 다시 깐다 — 수 분간 실행 중 프로세스의 지연 로딩이 실패할 수 있어 한가한 시간에)."
  log "   확인하고 종전처럼 설치 없이 진행하려면 --skip-deps-check"
  return 1
}

# 분리 실행 체인 앞에 붙일 설치 명령을 전역 CI_CMD 에 담는다 — 한 번만 설치한다(--api --web 이면 먼저 도는 체인에서).
# 🔴 `$(...)` 로 부르면 서브셸이라 NEED_NPM_CI 를 비운 것이 남지 않아 두 번 설치된다 — 반드시 그냥 호출한다.
# 🔴 설치가 실패하면 체인이 set -e 로 멈춰 완료 파일이 안 생긴다 → 재시작하지 않고 "배포 완료"도 찍지 않는다.
CI_CMD=":"
take_npm_ci() {
  CI_CMD=":"
  if [ -n "${NEED_NPM_CI}" ]; then
    # 🔴 (2026-09-28) npm ci 는 node_modules 를 통째로 다시 깔아 **생성된 Prisma 클라이언트를 지운다** — 그 뒤 nest build 가
    #    타입 오류 4,024건으로 실패했고, 실행 중 API 는 클라이언트 없는 node_modules 위에 남았다(재시작하면 죽는다).
    #    설치 뒤 생성을 **다음 줄로** 붙인다(웹만 배포해도 API·감시자가 같은 node_modules 를 쓰므로 항상 생성).
    #    🔴 `npm ci && …` 로 한 줄에 묶으면 set -e 가 && 목록 앞쪽 실패를 무시해 **설치가 실패해도 빌드가 돈다**(재주입 테스트가 잡았다).
    CI_CMD=$'npm ci --no-audit --no-fund\n(cd apps/api && npx prisma generate)'
    NEED_NPM_CI=""
  fi
}

# 산출물 기록 — 🔴 **빌드가 성공한 뒤에만** 쓴다(체인 안). 실패한 배포가 새 커밋을 말하면 거짓이다.
build_info_json() {
  local version commit dirty
  version="$(grep -oE "HIS_VERSION = 'v[^']+'" "${LOCAL_DIR}/packages/shared/src/constants.ts" | sed -E "s/.*'v([^']+)'/\1/" || true)"
  commit="${BUILD_COMMIT:+\"${BUILD_COMMIT}\"}"; commit="${commit:-null}"
  dirty="${BUILD_DIRTY:-null}"
  printf '{"version":"%s","commit":%s,"dirty":%s,"builtAt":"%s","source":"deploy.sh"}' \
    "${version}" "${commit}" "${dirty}" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
}

# 🔴 홈페이지 소스 동기화(2026-09-15) — '빌드·발행' 버튼(3306)은 **서버에 있는 apps/homepage 사본**을 빌드한다.
#    종전엔 `--homepage` 만 이 사본을 갱신해서, 09-15 실측 서버 사본이 **09-01 소스**였다 — 키가 정상이었다면
#    버튼은 2주 전 코드를 발행하고 '발행 완료'라고 말했을 것이다. HIS 배포(--api)마다 소스만 올린다(빌드는 안 함).
#    SOURCE_INFO.json 은 **어느 커밋의 소스인가**를 기록한다 — 빌드 스크립트가 스탬프에 싣고 화면이 HIS 커밋과 대조한다.
sync_homepage_source() {
  log "홈페이지 소스 동기화(빌드·발행 버튼용 — 빌드는 하지 않음)..."
  if rsync_run --delete --exclude node_modules --exclude .next --exclude SOURCE_INFO.json \
       "${LOCAL_DIR}/apps/homepage/" "${SERVER}:${REMOTE_DIR}/apps/homepage/" >/dev/null 2>&1 \
     && remote "printf '%s' '$(build_info_json)' > ${REMOTE_DIR}/apps/homepage/SOURCE_INFO.json"; then
    log "  → 서버 홈페이지 소스 = 커밋 ${BUILD_COMMIT:-알 수 없음}(dirty=${BUILD_DIRTY:-알 수 없음})"
  else
    log "  WARNING: 홈페이지 소스 동기화 실패 — '빌드·발행' 버튼은 이전 소스를 빌드합니다(화면이 소스 커밋을 표시)"
  fi
}

# DB 백업 (스키마 변경 전 필수)
# 🔴 배포 백업도 암호화한다(2026-09-11). 종전엔 정기 백업(backup.sh)만 `.gpg` 였고 이 백업은 평문 `.sql.gz` 가
#    7일치 남았다 — 게다가 권한이 0664 라 같은 그룹이면 읽혔다. 환자 DB 전량이 평문으로 남는 경로였다.
#    순서: 평문으로 떠서 **무결성 검사** → 암호화 → **복호화해 다시 검사**(열 수 없는 암호문은 백업이 아니다) → 평문 삭제.
#    암호화가 안 되면(패스프레이즈·gpg 부재·실패) 평문을 남기고 그 사실을 **말한다** — 유효한 백업이 있으니 배포는 막지 않는다.
#    🔴 이름은 계속 `pre-deploy_*` — 정기 백업 판정기(go-live·감시자)는 `hospitalrun_*` 만 센다(정본 `apps/api/src/common/backup-files.ts`).
backup_db() {
  log "DB 백업 시작..."
  remote "
    umask 077
    BACKUP_DIR=${HIS_BACKUP_DIR}
    PASSPHRASE_FILE=${HIS_BACKUP_PASSPHRASE_FILE}
    mkdir -p \${BACKUP_DIR}
    DATE=\$(date +%Y%m%d_%H%M%S)
    BACKUP_FILE=\${BACKUP_DIR}/pre-deploy_\${DATE}.sql.gz

    # ⚠️ hospitalrun DB(hospital role)를 가진 컨테이너를 정확히 선택.
    #    과거 'grep postgres | head -1' 은 sign-postgres/twin-postgres 를 먼저 잡아 pg_dump 가
    #    'role hospital does not exist' 로 실패 → 빈(20B) 백업이 무음 생성되던 버그(2026-06-15 수정).
    set -o pipefail
    PGC=\"\"
    for c in \$(docker ps --format '{{.Names}}' | grep -i postgres); do
      if docker exec \"\$c\" psql -U hospital -d hospitalrun -tAc 'SELECT 1' >/dev/null 2>&1; then PGC=\"\$c\"; break; fi
    done

    if command -v pg_dump &>/dev/null && PGPASSWORD=CHANGE_ME psql -U hospital -h localhost -d hospitalrun -tAc 'SELECT 1' >/dev/null 2>&1; then
      PGPASSWORD=CHANGE_ME pg_dump -U hospital -h localhost hospitalrun --no-owner --no-privileges | gzip > \${BACKUP_FILE}
    elif [ -n \"\$PGC\" ]; then
      docker exec \"\$PGC\" pg_dump -U hospital hospitalrun --no-owner --no-privileges | gzip > \${BACKUP_FILE}
    else
      echo 'ERROR: hospitalrun postgres(hospital role) 컨테이너를 찾지 못함 — 백업 중단' && exit 1
    fi

    # 백업 무결성 검증 — CREATE TABLE 이 없으면 빈 백업으로 간주하고 배포 중단(과거 무음 실패 재발 방지)
    if [ \"\$(gunzip -c \${BACKUP_FILE} 2>/dev/null | grep -c 'CREATE TABLE')\" -eq 0 ]; then
      echo \"ERROR: 백업이 비어있음(CREATE TABLE 0건) — 배포 중단. file=\${BACKUP_FILE}\" && rm -f \${BACKUP_FILE} && exit 1
    fi

    # 암호화 — 검사를 통과한 평문만 암호화하고, 암호문을 열어 같은 검사를 통과해야 평문을 지운다
    FINAL_FILE=\${BACKUP_FILE}
    ENC_STATE='🔴 평문'
    if ! command -v gpg >/dev/null 2>&1; then
      echo \"🔴 gpg 없음 — 암호화 생략(평문 배포 백업이 남는다)\"
    elif [ ! -r \${PASSPHRASE_FILE} ]; then
      echo \"🔴 \${PASSPHRASE_FILE} 없음 — 암호화 생략(평문 배포 백업이 남는다)\"
    elif gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file \${PASSPHRASE_FILE} \
           --output \${BACKUP_FILE}.gpg \${BACKUP_FILE} \
         && [ \"\$(gpg --batch --quiet --decrypt --passphrase-file \${PASSPHRASE_FILE} \${BACKUP_FILE}.gpg 2>/dev/null | gunzip -c 2>/dev/null | grep -c 'CREATE TABLE')\" -gt 0 ]; then
      rm -f \${BACKUP_FILE}
      FINAL_FILE=\${BACKUP_FILE}.gpg
      ENC_STATE='암호화(AES256·복호화 검증)'
    else
      rm -f \${BACKUP_FILE}.gpg
      echo \"🔴 암호화 또는 복호화 검증 실패 — 평문 배포 백업을 남긴다(배포는 계속)\"
    fi

    SIZE=\$(du -sh \${FINAL_FILE} | cut -f1)
    echo \"백업 완료: \${FINAL_FILE} (\${SIZE}) · \${ENC_STATE}\"

    # 7일 이상 배포 백업 자동 삭제(평문·암호문 모두)
    find \${BACKUP_DIR} -name 'pre-deploy_*.sql.gz*' -mtime +7 -delete
  "
  log "DB 백업 완료"
}

# Prisma 스키마 배포 (안전하게)
deploy_schema() {
  log "스키마 배포 시작..."

  # 1. 백업 먼저
  backup_db

  # 2. 스키마 파일 전송
  rsync_run "${LOCAL_DIR}/apps/api/prisma/" "${SERVER}:${REMOTE_DIR}/apps/api/prisma/"

  # 3. 안전한 스키마 적용 (--accept-data-loss 사용 안 함)
  log "Prisma generate + db push (safe mode)..."
  remote "cd ${REMOTE_DIR}/apps/api && npx prisma generate && npx prisma db push 2>&1" || {
    log "WARNING: db push 실패 — 수동 확인 필요"
    log "데이터 손실이 필요한 경우만 수동으로: npx prisma db push --accept-data-loss"
    log "백업에서 복원(암호문): gpg --batch --decrypt --passphrase-file ${HIS_BACKUP_PASSPHRASE_FILE} ${HIS_BACKUP_DIR}/pre-deploy_<TS>.sql.gz.gpg | gunzip -c | docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun"
    log "  (평문 백업이면): gunzip -c ${HIS_BACKUP_DIR}/pre-deploy_<TS>.sql.gz | docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun"
    return 1
  }

  log "스키마 배포 완료"
}

# 웹 빌드용 모드 환경파일 동기화.
# 🔴 `NEXT_PUBLIC_*` 는 **빌드 시 인라인**되므로 값이 빌드 프로세스에 있어야 한다.
#    딜러 계정 JSON 은 따옴표가 많아 ssh 명령줄로 넘기면 깨진다 → Next 가 운영 빌드에서 읽는
#    `.env.production.local`(gitignore 대상)로 옮긴다. 값의 정본은 커밋된 `.env.development` 하나다
#    (두 곳에 적으면 갈라진다).
# 🔴 REAL 이면 파일을 **지운다** — 남겨두면 이후 어떤 빌드든 시드를 실어 나른다.
sync_web_mode_env() {
  if [ "$HIS_MODE" = "REAL" ]; then
    log "웹 모드 환경파일 제거(REAL)..."
    remote "rm -f ${REMOTE_DIR}/apps/web/.env.production.local"
  else
    log "웹 모드 환경파일 동기화(${HIS_MODE})..."
    _tmp="$(mktemp)"
    {
      echo "# deploy.sh --mode ${HIS_MODE} 가 생성한다. 손으로 고치지 말 것(다음 배포에 덮인다)."
      echo "NEXT_PUBLIC_HIS_MODE=${HIS_MODE}"
      grep '^NEXT_PUBLIC_DEALER_TEST_ACCOUNTS=' "${LOCAL_DIR}/apps/web/.env.development" || true
    } > "$_tmp"
    rsync_run "$_tmp" "${SERVER}:${REMOTE_DIR}/apps/web/.env.production.local"
    rm -f "$_tmp"
  fi
}

# packages/shared 동기화 — 공유 타입/상수(웹·API 공용). 로컬 빌드된 dist 포함(서버 재빌드 불요).
# 🔴 종전엔 packages/가 배포에서 누락돼 shared 변경이 서버에 반영되지 않던 갭(2026-07-23 발견·보강).
sync_shared() {
  log "packages/shared 동기화..."
  rsync_run --delete --exclude node_modules --exclude .turbo "${LOCAL_DIR}/packages/shared/" "${SERVER}:${REMOTE_DIR}/packages/shared/"
}

# API 소스 배포
deploy_sentinel() {
  # 상시 감시자 — 별도 pm2 프로세스(dist/sentinel.js). 기획 his-sentinel-monitoring.plan.md
  #
  # 🔴 감시자는 **정합성 SQL 파일을 읽는다**(infra/scripts/data-integrity-scan.sql).
  #    소스만 올리고 스크립트를 빠뜨리면 감시자가 매 주기 실패한다 — 함께 올린다.
  # 🔴 API 배포에 딸려 재시작한다. 감시자가 낡으면 감시가 낡는다.
  log "감시자 스크립트 동기화..."
  rsync_run "${LOCAL_DIR}/infra/scripts/data-integrity-scan.sql" "${SERVER}:${REMOTE_DIR}/infra/scripts/data-integrity-scan.sql"
  # 🔴 홈페이지 '빌드·발행' 버튼도 서버의 이 스크립트를 실행한다(2026-09-03 실측: --homepage 만
  #    동기화해 서버 사본이 6/17 에 멈춰 있었고, 빌드 스탬프가 첫 회에 안 실렸다). 같은 이유로 함께 올린다.
  rsync_run "${LOCAL_DIR}/infra/scripts/build-homepage.sh" "${SERVER}:${REMOTE_DIR}/infra/scripts/build-homepage.sh"
  remote "chmod +x ${REMOTE_DIR}/infra/scripts/build-homepage.sh" 2>/dev/null || true
  sync_homepage_source

  # 🔴 산출물이 없으면 pm2 는 'Script not found' 만 남기고 배포는 계속된다 —
  #    그러면 감시자가 없는 채로 화면만 '미판정'이 된다. 먼저 확인하고 명확히 말한다.
  if ! remote "test -f ${REMOTE_DIR}/apps/api/dist/sentinel.main.js"; then
    log "🔴 dist/sentinel.main.js 가 없습니다 — API 빌드가 감시자 진입점을 만들지 못했습니다"
    return 1
  fi

  log "감시자 재시작..."
  # 없으면 start, 있으면 restart. cwd 는 저장소 루트(SENTINEL_REPO_ROOT 기본값이 여기서 유도된다)
  # 🔴 (2026-09-13 운영 실측) 종전 `${PM2_ENV} pm2 describe … && pm2 restart … || pm2 start …` 는 셸 규칙상
  #    **환경 변수 접두가 `pm2 describe` 에만 붙고 restart·start 에는 붙지 않았다.** 그래서 `pm2 jlist` 에서
  #    his-api 는 `HIS_MODE=REHEARSAL` 인데 **his-sentinel 은 HIS_MODE 가 없었다** — HIS_MODE 미설정은 REAL 로 판정되므로
  #    리허설 운영에서 감시자만 REAL 로 돌 수 있었다. 접두를 **실제로 기동하는 명령**에 붙인다.
  #    또 `a && b || c` 는 restart 가 실패해도 start 로 넘어가 같은 이름의 두 번째 인스턴스를 만들 수 있다 → if/else 로 가른다.
  remote "cd ${REMOTE_DIR} && if pm2 describe ${PM2_SENTINEL} >/dev/null 2>&1; then \
${PM2_ENV} pm2 restart ${PM2_SENTINEL} --update-env; \
else ${PM2_ENV} pm2 start apps/api/dist/sentinel.main.js --name ${PM2_SENTINEL} --max-memory-restart 400M --time; fi"
  # 🔴 재부팅 복원은 ~/.pm2/dump.pm2 뿐이다(크론 @reboot pm2 resurrect) — 새로 start 한 프로세스는 save 해야 살아난다
  remote "pm2 save >/dev/null 2>&1 || true"

  # 🔴 부팅 확인 — 감시자는 HTTP 가 없으므로 pm2 상태와 로그로 본다.
  #    '기동' 로그가 없으면 조용히 죽은 것이다(그러면 화면이 영원히 '미판정'이다).
  sleep 6
  if remote "pm2 logs ${PM2_SENTINEL} --lines 40 --nostream 2>/dev/null | grep -q '감시자 기동'"; then
    log "감시자 기동 OK"
  else
    log "🔴 감시자가 기동 로그를 남기지 않았습니다 — pm2 logs ${PM2_SENTINEL} 로 확인하세요"
    remote "pm2 logs ${PM2_SENTINEL} --lines 20 --nostream 2>/dev/null | tail -10" || true
  fi
  log "감시자 배포 완료"
}

deploy_api() {
  sync_shared
  log "API 소스 배포..."
  rsync_run --delete "${LOCAL_DIR}/apps/api/src/" "${SERVER}:${REMOTE_DIR}/apps/api/src/"
  # prisma 디렉터리(시드 스크립트·manual SQL) 동기화 — seed 최신화용.
  # generate/db push 는 하지 않음(스키마 적용은 --schema 전용). --delete 미사용(서버측 산출물 보존).
  rsync_run "${LOCAL_DIR}/apps/api/prisma/" "${SERVER}:${REMOTE_DIR}/apps/api/prisma/"

  # 🔴 **분리 실행**(2026-09-10) — 웹과 같은 이유다. API 빌드도 수 분이 걸려 세션이 끊기면
  #    빌드가 통째로 날아가고, 그 상태로 `pm2 restart` 가 이어지면 **낡은 dist 로 무증상 재시작**된다
  #    (이 저장소가 겪은 "구 dist 무증상 재시작"의 자리다). 빌드 성공을 확인한 뒤에만 재시작한다.
  log "API 빌드... (분리 실행)"
  take_npm_ci
  # 🔴 BUILD_INFO.json 은 빌드·산출물 확인을 통과한 **뒤에** 쓴다 — 실패한 배포가 새 커밋을 말하지 않게.
  #    `/health`·`/api/v1/public/version` 이 이 파일을 읽는다(없으면 commit=null — 지어내지 않는다).
  remote_detached "api" "cd ${REMOTE_DIR}
${CI_CMD}
npm run build --workspace=@hospital-run/api
test -f apps/api/dist/main.js
printf '%s' '$(build_info_json)' > apps/api/BUILD_INFO.json" 1800 || {
    local rc=$?
    log "🔴 API 빌드 실패/판정 불가(rc=${rc}) — **재시작하지 않는다**(낡은 dist 로 도는 것을 막는다)."
    return $rc
  }

  log "API 재시작..."
  # --max-memory-restart: 메모리 폭주 시 자동 회수. 이 서버(ML)는 OpenPACS·LIS·sign·cerno·twin·edu·ERP·
  # LLM 매니저가 공존하고 GPU 워크로드가 같이 돈다 — werub-shuttle(512M) 등 다른 앱은 이미 상한이 있었고 api/web 만
  # 없었다(2026-08-03 설정). web 은 무중단 `pm2 reload` 라 재시작 옵션을 붙이지 않는다 —
  # 설정은 pm2 프로세스 목록에 남고 reload 가 보존한다(재부팅 복원은 `pm2 save` 로 반영됨).
  remote "cd ${REMOTE_DIR} && ${PM2_ENV} pm2 restart ${PM2_API} --update-env --max-memory-restart 1G"

  # 🔴 **부팅 확인** — 2026-08-26 사고: DI 배선 누락으로 API 가 부팅하지 못해 502(로그인 전건 실패).
  #    tsc·9,482 테스트·nest build 는 전부 통과했다. **Nest 부팅만 잡는 층**이 있다.
  #    스모크는 배포 맨 끝에서야 도는데, 그 전에 여기서 먼저 확인해 사고를 짧게 만든다.
  log "API 부팅 확인..."
  BOOT_OK=""
  for i in $(seq 1 20); do
    sleep 3
    CODE=$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST "${HIS_PUBLIC_URL}/api/v1/auth/login" \
      -H 'Content-Type: application/json' -d '{"email":"boot@check","password":"x"}' || true)
    # 400/401/429 = 앱이 살아서 요청을 처리했다는 뜻. 502/000 = 부팅 실패·미기동
    case "$CODE" in 400|401|429) BOOT_OK=1; break;; esac
  done
  if [ -n "$BOOT_OK" ]; then
    log "API 부팅 OK"
  else
    log "🔴 API 가 부팅하지 못했습니다(마지막 응답: ${CODE}) — pm2 logs ${PM2_API} 로 원인을 확인하세요"
    remote "pm2 logs ${PM2_API} --lines 30 --nostream 2>/dev/null | grep -iE 'error|exception|cannot resolve' | tail -8" || true
    exit 1
  fi

  log "API 배포 완료"
}

# Web 소스 배포
deploy_web() {
  sync_shared
  log "Web 소스 배포..."
  rsync_run --delete "${LOCAL_DIR}/apps/web/src/" "${SERVER}:${REMOTE_DIR}/apps/web/src/"
  # public 정적 자산(서비스워커 등) — --delete 없이(서버 런타임 미디어 보존)
  rsync_run "${LOCAL_DIR}/apps/web/public/" "${SERVER}:${REMOTE_DIR}/apps/web/public/"
  # 🔴 next.config.ts 동기화 — src/만 동기화하던 탓에 NEXT_DIST_DIR(distDir) 지원이 서버에 누락되어
  #    .next-build가 생성되지 않고 라이브 .next에 직접 빌드(비원자)된 뒤 검증 체인이 실패하던 결함(2026-07-21 발견)
  rsync_run "${LOCAL_DIR}/apps/web/next.config.ts" "${SERVER}:${REMOTE_DIR}/apps/web/next.config.ts"

  sync_web_mode_env

  # 무중단: 임시 디렉터리(.next-build)에 빌드 → **무결성 검증 통과 시에만** 원자적 스왑 → graceful reload.
  # 빌드 중(2~5분) 기존 .next가 그대로라 화면 정상, 전환은 mv 순간(ms)만.
  # 🔴 빌드·검증·스왑을 하나의 && 체인으로 — 빌드 실패/불완전 산출물이 스왑되어 .next를 손상시키던 결함 방지.
  # 🔴 **분리 실행**(2026-09-10) — 종전엔 이 체인이 단일 ssh 세션 안에서 돌아, 연결이 끊기면
  #    빌드→검증→스왑이 통째로 날아갔다(실측 2회 연속). 체인 자체와 검증 조건은 그대로다.
  log "Web 빌드(.next-build)→검증→스왑... (분리 실행)"
  take_npm_ci
  remote_detached "web" "cd ${REMOTE_DIR}
${CI_CMD}
rm -rf apps/web/.next-build
NEXT_PUBLIC_API_URL='' NEXT_PUBLIC_HIS_MODE=${HIS_MODE} NEXT_DIST_DIR=.next-build npm run build --workspace=@hospital-run/web
test -f apps/web/.next-build/BUILD_ID
test -d apps/web/.next-build/static/chunks
[ \"\$(find apps/web/.next-build/static/chunks -name '*.js' | wc -l)\" -gt 0 ]
cd apps/web
rm -rf .next-old
mv .next .next-old 2>/dev/null || true
mv .next-build .next
cd ${REMOTE_DIR}
pm2 reload ${PM2_WEB}" 2400 || {
    local rc=$?
    if [ "$rc" = "2" ]; then
      log "🔴 Web 배포 판정 불가 — 사이트는 **직전 빌드**를 계속 서비스한다(스왑 전이면 무해)."
    else
      log "🔴 Web 배포 실패 — 스왑되지 않았다. 사이트는 직전 빌드를 계속 서비스한다."
    fi
    return $rc
  }

  log "Web 배포 완료"
}

# 시드 실행
deploy_seed() {
  log "시드 데이터 실행..."
  rsync_run "${LOCAL_DIR}/apps/api/prisma/seed.ts" "${SERVER}:${REMOTE_DIR}/apps/api/prisma/seed.ts"
  remote "cd ${REMOTE_DIR}/apps/api && npx prisma db seed 2>&1 | tail -20"
  log "시드 완료"
}

# ============================================================
# 홈페이지(hospital.example.org) 아티팩트 빌드·발행 — AWS EC2(별도 인프라)용
#   격리 빌드(모노레포 hoisting 회피) → standalone 조립(static+public+ecosystem)
#   → tar → S3 deploy 버킷 업로드. 서버 배포(SSM)는 인프라 측이 S3에서 수행.
#   환경변수(override 가능): HOMEPAGE_API_ORIGIN, HOMEPAGE_S3, HOMEPAGE_S3_REGION
# ============================================================
deploy_homepage() {
  local HP_SRC="${LOCAL_DIR}/apps/homepage"
  local API_ORIGIN="${HOMEPAGE_API_ORIGIN:-https://his.example.org}"
  local S3="${HOMEPAGE_S3:-s3://weruby-aws-cost/deploy}"
  local REGION="${HOMEPAGE_S3_REGION:-ap-northeast-2}"
  local TS; TS=$(date +%Y%m%d-%H%M)
  local ART="/tmp/homepage-${TS}.tgz"

  command -v aws >/dev/null || { log "ERROR: aws CLI 필요"; return 1; }
  [ -d "$HP_SRC" ] || { log "ERROR: ${HP_SRC} 없음"; return 1; }

  log "홈페이지 격리 빌드 시작 (API_ORIGIN=${API_ORIGIN})..."
  local ISO; ISO=$(mktemp -d)
  # 1) 격리 복사(모노레포 node_modules hoisting 배제 — standalone 추적 보장)
  rsync -a --exclude node_modules --exclude .next "${HP_SRC}/" "${ISO}/"
  # 🔴 (2026-09-15) 이 경로는 빌드 스탬프를 안 심었다 — 인프라가 1502 를 전환했더니 라이브 /build-stamp.txt 가
  #    404 라 화면이 "스탬프 도입 이전 빌드"(= 낡음)로 말했다. 서버 빌드(build-homepage.sh)와 같은 표본을 심는다.
  mkdir -p "${ISO}/public" && printf '%s' "$TS" > "${ISO}/public/build-stamp.txt"
  [ -n "${BUILD_COMMIT:-}" ] && printf '%s' "$BUILD_COMMIT" > "${ISO}/public/build-source.txt"
  # 2) 의존성 + standalone 빌드
  #    HOMEPAGE_API_ORIGIN: 클라 /api 프록시 대상(빌드 고정) / NEXT_PUBLIC_API_URL='': 클라 상대경로
  #    INTERNAL_API_URL: SSG/ISR pre-render 시 publicFetch 가 실데이터를 가져오도록(필수 — 없으면 빈 목록 정적생성)
  ( cd "$ISO" && npm install --no-audit --no-fund \
      && HOMEPAGE_API_ORIGIN="$API_ORIGIN" INTERNAL_API_URL="$API_ORIGIN" NEXT_PUBLIC_API_URL='' NEXT_TELEMETRY_DISABLED=1 npm run build ) \
    || { log "ERROR: 홈페이지 빌드 실패"; rm -rf "$ISO"; return 1; }
  # 3) 조립 — static + public(있으면) + ecosystem 을 standalone 에 동봉
  cp -r "$ISO/.next/static" "$ISO/.next/standalone/.next/static"
  [ -d "$ISO/public" ] && cp -r "$ISO/public" "$ISO/.next/standalone/public"
  cp "$ISO/ecosystem.config.cjs" "$ISO/.next/standalone/"
  # 4) tar (standalone 내용을 루트로)
  tar czf "$ART" -C "$ISO/.next/standalone" .
  # 5) S3 업로드 + 무결성 해시
  log "S3 업로드: ${S3}/homepage-${TS}.tgz ..."
  aws s3 cp "$ART" "${S3}/" --region "$REGION" || { log "ERROR: S3 업로드 실패"; rm -rf "$ISO"; return 1; }
  local SHA; SHA=$(shasum -a 256 "$ART" | awk '{print $1}')
  local SIZE; SIZE=$(du -h "$ART" | awk '{print $1}')
  rm -rf "$ISO"
  log "홈페이지 발행 완료 ─ ${S3}/homepage-${TS}.tgz (${SIZE}, sha256 ${SHA})"

  # 서버 빌드 버튼(3306)용 — HIS 서버에 소스 + 빌드스크립트 동기화(다음 재빌드 대비)
  rsync_run "${LOCAL_DIR}/infra/scripts/build-homepage.sh" "${SERVER}:${REMOTE_DIR}/infra/scripts/" >/dev/null 2>&1 \
    && remote "chmod +x ${REMOTE_DIR}/infra/scripts/build-homepage.sh" 2>/dev/null || true
  sync_homepage_source

  # 🔴 여기까지는 **아티팩트 발행**이다 — 이 명령만으로 hospital.example.org 이 바뀌지 않는다.
  #    (관리 화면 '빌드·발행' 버튼은 서버 build-homepage.sh 가 SSM 전환까지 트리거한다. 이 경로는 안 한다.)
  log "  🔴 아직 라이브가 아닙니다 — 전환은 인프라 SSM(§7-2) 또는 /admin/homepage/deploy 의 '빌드·발행'"
}

# ── 공개 사이트가 낡았는지 알린다 (비차단) ──────────────────────────────────
# 🔴 2026-09-02 실측: hospital.example.org 이 2026-06-17 빌드를 76일째 서비스하고 있었다. HIS 는 매일 배포되는데
#    공개 사이트는 `--all` 에 없어서(= "전체 배포"가 전체가 아니다) 아무도 낡은 줄 몰랐다.
#    표본은 예약 페이지의 AI 표기 유무. 문자열은 **정본 파일에서 뽑는다**(여기 다시 적으면 갈라진다).
#    🔴 확인 실패는 '낡음'이 아니다 — 그대로 말하고 넘어간다.
# 🔴 2026-09-03 표본 교체: 종전 표본(예약 페이지 AI 표기)은 그 페이지 본문이 Suspense 셸이라
#    초기 HTML 에 구조적으로 나올 수 없었다 — 발행이 성공해도(청크 대조 실증) 영원히 '낡음'이라 말했다.
#    이제 빌드가 심는 /build-stamp.txt(빌드 TS)를 읽는다. 최신 여부 판정은 관리 화면(트리거 ts 대조)이 하고,
#    여기서는 라이브가 어느 빌드인지와 스탬프 부재(=2026-09-03 이전 빌드)만 말한다.
check_public_site() {
  local url="${HOMEPAGE_PUBLIC_URL:-https://hospital.example.org}/build-stamp.txt"
  local code stamp
  # 🔴 (2026-09-11) 공개 사이트가 응답하지 않으면 이 함수가 **스크립트를 죽였다** — curl 이 파일을 안 만들어 `head` 가 실패하고
  #    `set -euo pipefail` 이 그 대입에서 exit 1. 로그 한 줄 없이 끝나 **배포 후 스모크가 건너뛰어졌고** '확인 불가' 분기는 도달 불가였다.
  #    또 `-w` 는 실패해도 `000` 을 찍는데 `|| echo 000` 이 하나를 더 붙여 `000000` 이 됐다. 확인 불가는 확인 불가로 말하고 다음 단계로 간다.
  code=$(curl -s -o /tmp/hp-stamp.$$ -w '%{http_code}' -m 10 "$url" 2>/dev/null) || true
  code="${code:-000}"
  stamp=$( { head -c 20 /tmp/hp-stamp.$$ 2>/dev/null || true; } | tr -d '\n'); rm -f /tmp/hp-stamp.$$
  if [ "$code" = "200" ] && echo "$stamp" | grep -qE '^[0-9]{8}-[0-9]{4}$'; then
    log "공개 사이트(hospital.example.org) 라이브 빌드 스탬프: ${stamp} (최신 여부는 /admin/homepage/deploy 가 트리거 기록과 대조)"
  elif [ "$code" = "404" ]; then
    log "🔴 공개 사이트에 빌드 스탬프가 없습니다 — 스탬프 도입(2026-09-03) 이전 빌드가 서비스 중입니다."
    log "   → /admin/homepage/deploy 의 '빌드·발행' 으로 공개 사이트를 갱신하세요."
  elif [ "$code" = "000" ]; then
    log "공개 사이트 확인 불가 — ${url} 에 연결하지 못했습니다(낡음 여부는 판정하지 않음)"
  else
    log "공개 사이트 스탬프 확인 불가(HTTP ${code}·본문 '${stamp}') — 낡음 여부는 판정하지 않음"
  fi
}

# ============================================================
# 메인
# ============================================================
if [ $# -eq 0 ]; then
  echo "사용법: $0 [--schema] [--seed] [--api] [--web] [--all]"
  echo ""
  echo "  --schema  Prisma 스키마 변경 배포 (자동 백업 포함)"
  echo "  --seed    시드 데이터 실행"
  echo "  --api      API 소스 배포 + 빌드 + 재시작"
  echo "  --web      Web 소스 배포 + 빌드 + 재시작"
  echo "  --homepage hospital.example.org 홈페이지 아티팩트 빌드·S3 발행 (AWS EC2용·인프라가 SSM 배포)"
  echo "  --all      HIS 전체 배포 (schema + api + web) — 🔴 공개 사이트(hospital.example.org)는 포함하지 않는다"
  echo "  --backup   DB 백업만 실행"
  echo ""
  echo "  릴리즈 고정 점검(코드를 보내는 액션 전에 자동 실행):"
  echo "  --allow-dirty      커밋되지 않은 변경을 포함해 배포(산출물에 dirty 로 기록)"
  echo "  --install-deps     lockfile 이 서버와 다르면 빌드 전 npm ci(수 분간 실행 중 프로세스 영향 가능)"
  echo "  --skip-deps-check  의존성 점검 생략(종전 동작 · 경고)"
  echo "  설정: infra/scripts/deploy.env(없으면 종전 기본값) · 형식은 deploy.env.example"
  echo ""
  echo "예시:"
  echo "  $0 --api              # API만 배포"
  echo "  $0 --api --web        # API + Web 배포"
  echo "  $0 --schema --api     # 스키마 변경 + API 배포"
  echo "  $0 --homepage         # hospital.example.org 홈페이지 빌드·S3 업로드"
  echo "  $0 --all              # 전체 배포"
  exit 0
fi

# ── 운영 모드 결정 (액션 실행 전) ────────────────────────────────────────────
# 🔴 `--mode` 를 주지 않으면 **서버의 현재 값을 그대로 이어받는다.** 배포할 때마다 리얼로 되돌아가면
#    리허설 중 시드 로그인이 예고 없이 사라진다(2026-08-25 에 실제로 그 혼란이 있었다).
#    반대로 서버에 값이 없으면 REAL 이다 — 위험한 쪽은 명시적 옵트인.
HIS_MODE_ARG=""
_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --mode)   HIS_MODE_ARG="$(echo "${2:-}" | tr '[:lower:]' '[:upper:]')"; shift 2 ;;
    --mode=*) HIS_MODE_ARG="$(echo "${1#*=}" | tr '[:lower:]' '[:upper:]')"; shift ;;
    --allow-dirty)     ALLOW_DIRTY=1; shift ;;
    --install-deps)    INSTALL_DEPS=1; shift ;;
    --skip-deps-check) SKIP_DEPS_CHECK=1; shift ;;
    *)        _ARGS+=("$1"); shift ;;
  esac
done
set -- ${_ARGS[@]+"${_ARGS[@]}"}

# ── 릴리즈 고정: 산출물 커밋 판정 — 🔴 **서버에 닿기 전에**(모드 기록보다도 먼저) ─────────────
#    dirty 로 중단될 배포가 서버 .env 의 모드부터 바꿔 놓으면 안 된다.
_SHIPS_CODE=""; _BUILDS_ON_SERVER=""
for arg in "$@"; do
  case $arg in
    --api|--web|--all) _SHIPS_CODE=1; _BUILDS_ON_SERVER=1 ;;
    --schema|--seed|--sentinel) _SHIPS_CODE=1 ;;
  esac
done
if [ -n "${_SHIPS_CODE}" ]; then
  preflight_git || exit 1
fi

if [ -n "$HIS_MODE_ARG" ]; then
  case "$HIS_MODE_ARG" in
    DEV|REHEARSAL|REAL) ;;
    *) echo "🔴 --mode 는 dev|rehearsal|real 중 하나여야 합니다 (받은 값: $HIS_MODE_ARG)"; exit 1 ;;
  esac
  HIS_MODE="$HIS_MODE_ARG"
  log "운영 모드를 ${HIS_MODE} 로 못박습니다(서버 .env + pm2 env)"
  remote "cd ${REMOTE_DIR} && touch .env && sed -i '/^HIS_MODE=/d' .env && echo 'HIS_MODE=${HIS_MODE}' >> .env"
else
  HIS_MODE="$(remote "grep -m1 '^HIS_MODE=' ${REMOTE_DIR}/.env 2>/dev/null | cut -d= -f2-" 2>/dev/null | tr -d '\r' || true)"
  HIS_MODE="${HIS_MODE:-REAL}"
  log "운영 모드: ${HIS_MODE} (서버 현재 값 — 바꾸려면 --mode)"
fi
if [ "$HIS_MODE" != "REAL" ]; then
  log "⚠️ ${HIS_MODE} 모드 — 시드 로그인이 노출되고 대외 발신(문자·메일·기관 전송)이 차단됩니다."
fi
PM2_ENV="${PM2_ENV} HIS_MODE=${HIS_MODE}"

# ── 서버 빌드 사전 점검(Node·의존성) — 액션을 하나라도 실행하기 **전에** 판정한다 ─────────
# 🔴 중간에 멈추면 API 만 새것·웹은 옛것인 반쪽 배포가 된다.
if [ -n "${_BUILDS_ON_SERVER}" ]; then
  preflight_remote_node || exit 1
  deps_preflight || exit 1
fi

for arg in "$@"; do
  case $arg in
    --backup)   backup_db ;;
    --schema)   deploy_schema ;;
    --seed)     deploy_seed ;;
    --api)      deploy_api; deploy_sentinel ;;
    --sentinel) deploy_sentinel ;;
    --web)      deploy_web ;;
    --homepage) deploy_homepage ;;
    --all)
      deploy_schema
      deploy_api
      deploy_sentinel
      deploy_web
      ;;
    *) echo "알 수 없는 옵션: $arg"; exit 1 ;;
  esac
done

# --mode 를 명시했는데 API 를 배포하지 않은 경우에도 API 가 새 모드를 알아야 한다
# (모드는 대외 발신 차단을 좌우한다 — 안 반영되면 리허설인데 문자가 나갈 수 있다).
if [ -n "$HIS_MODE_ARG" ]; then
  log "API 에 모드 반영(pm2 --update-env)..."
  remote "cd ${REMOTE_DIR} && ${PM2_ENV} pm2 restart ${PM2_API} --update-env --max-memory-restart 1G" || \
    log "⚠️ API 재시작 실패 — 모드가 API 에 반영되지 않았습니다(대외 발신 차단이 적용 안 될 수 있음)"
fi

log "배포 완료!"

# HIS 만 배포됐다는 사실을 분명히 한다 — 공개 사이트는 별도 경로다(2026-09-02 76일 방치 재발 방지)
check_public_site

# 배포 후 스모크(비파괴 29항목) — 실패해도 배포는 유지, 경고만 (구 dist 무증상 재시작 감지용)
SMOKE="$(dirname "$0")/smoke-e2e.sh"
if [ -x "$SMOKE" ]; then
  log "배포 후 스모크 실행(API 웜업 대기)..."
  for i in $(seq 1 30); do
    CODE=$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST "${HIS_PUBLIC_URL}/api/v1/auth/login" -H 'Content-Type: application/json' -d '{"email":"warmup@x","password":"x"}' || true)
    [ "$CODE" = "401" ] || [ "$CODE" = "400" ] || [ "$CODE" = "429" ] && break
    sleep 3
  done
  if "$SMOKE" > /tmp/deploy-smoke.log 2>&1; then
    log "스모크 PASS ($(grep -o 'PASS=[0-9]*' /tmp/deploy-smoke.log | tail -1))"
  else
    log "⚠️ 스모크 FAIL — /tmp/deploy-smoke.log 확인 필요"
    grep '✗' /tmp/deploy-smoke.log || true
  fi
fi
