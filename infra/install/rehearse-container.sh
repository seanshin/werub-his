#!/usr/bin/env bash
# 빈 환경 설치 리허설 — 컨테이너(node:22-bookworm + postgres:16-alpine + redis:7-alpine)에서 install.sh 를 처음부터 끝까지 돌린다.
#
# 🔴 (2026-09-14 P6) 첫 리허설(갈래 q)은 손으로 한 명령 묶음이라 재현 경로가 없었고, 그 뒤 install.sh 에 들어간
#    BUILD_INFO 기록·빌드 메모리 판정은 "스크립트 실행 테스트로만" 확인됐다. 같은 절차를 다시 돌릴 수 있게 하나로 묶는다.
#
# 원칙(가이드 §4.1 그대로):
#   - 저장소 사본은 `git archive HEAD` — 작업 트리 복사 금지(dist·.env 가 섞인다). 커밋되지 않은 변경은 리허설에 들어가지 않는다.
#   - 루트 .env 는 .env.example 을 복사해 필수 키만 채운다(무작위 비밀·REAL).
#   - 마스터는 합성 약가 CSV 3행(🔴 실제 원천 아님 — 적재 경로 확인용) · 미확인 마스터는 --allow-unverified-masters 로 **알고** 진행.
#   - 끝나면 컨테이너·네트워크·임시 파일을 지운다(REHEARSAL_KEEP=1 이면 남긴다).
#
# 결과: $OUT_DIR/install.log(설치 로그) · $OUT_DIR/result.txt(단계 판정 요약 · 공개 버전 EP 응답 · 메모리 판정 줄)
# 사용: infra/install/rehearse-container.sh [OUT_DIR]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TAG="hisrh$$"
OUT_DIR="${1:-$(mktemp -d)}"
mkdir -p "$OUT_DIR"
NET="${TAG}-net"; PG="${TAG}-pg"; RD="${TAG}-redis"; APP="${TAG}-app"
WORK="$(mktemp -d)"

cleanup() {
  if [ "${REHEARSAL_KEEP:-}" = 1 ]; then echo "[rehearse] REHEARSAL_KEEP=1 — 컨테이너 유지: $PG $RD $APP · 네트워크 $NET"; return; fi
  docker rm -f "$APP" "$PG" "$RD" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

command -v docker >/dev/null || { echo "docker 가 필요합니다"; exit 2; }
HEAD="$(git -C "$ROOT" rev-parse HEAD)"
echo "[rehearse] 사본: git archive $HEAD"
git -C "$ROOT" archive --format=tar HEAD > "$WORK/src.tar"

mkdir -p "$WORK/masters"
cat > "$WORK/masters/drug-master.utf8.csv" <<'CSV'
한글상품명,업체명,약품규격,제형구분,품목허가일자,대표코드,제품코드(개정후),일반명코드(성분명코드),취소일자
리허설정500밀리그램,리허설제약,500mg,정제,2020-01-01,8800000000001,640000001,100101ATB,
리허설캡슐,리허설제약,250mg,캡슐제,2021-02-02,8800000000002,640000002,100102ACH,
리허설시럽,리허설제약,100mL,시럽제,2022-03-03,8800000000003,640000003,100103ASY,
CSV

docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" -e POSTGRES_USER=hospital -e POSTGRES_PASSWORD=CHANGE_ME -e POSTGRES_DB=hospitalrun postgres:16-alpine >/dev/null
docker run -d --name "$RD" --network "$NET" redis:7-alpine >/dev/null
for _ in $(seq 1 60); do docker exec "$PG" pg_isready -U hospital >/dev/null 2>&1 && break; sleep 1; done

# 🔴 볼륨 마운트는 쓰지 않는다 — macOS Docker Desktop 은 mktemp 경로(/var/folders)를 공유하지 않아 컨테이너 안이 비었다(첫 실행 실측). docker cp 로 넣고 뺀다.
docker run -d --name "$APP" --network "$NET" node:22-bookworm sleep infinity >/dev/null

# 컨테이너 안 절차 — 가이드 §4.1 의 명령 순서 그대로
cat > "$WORK/inside.sh" <<INSIDE
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null && apt-get install -y -qq postgresql-client >/dev/null
mkdir -p /opt/his && cd /opt/his && tar -xf /rh/src.tar
echo "[inside] node \$(node -v)"
START_CI=\$(date +%s); npm ci --no-audit --no-fund >/rh/npm-ci.log 2>&1; echo "[inside] npm ci \$(( \$(date +%s) - START_CI ))s"
cp .env.example .env
node - <<'NODE'
const fs = require('fs');
const rnd = (n) => require('crypto').randomBytes(n).toString('hex');
const set = {
  DATABASE_URL: 'postgresql://hospital:CHANGE_ME@${PG}:5432/hospitalrun',
  REDIS_URL: 'redis://${RD}:6379',
  TZ: 'Asia/Seoul', HIS_MODE: 'REAL', NODE_ENV: 'production',
  AUTH_SECRET: rnd(32), AUTH_REFRESH_SECRET: rnd(32),
  AUTH_SSO_SIGNING_KEY: rnd(32), AUTH_STEPUP_SIGNING_KEY: rnd(32), TERMINAL_PIN_SECRET: rnd(32),
  ENCRYPTION_KEY: rnd(32), ENCRYPTION_KDF_SALT: rnd(16),
  PDF_SERVICE_URL: 'http://127.0.0.1:9', PDF_SERVICE_TOKEN: rnd(24), PDF_RENDER_SECRET: rnd(24), DOC_DOWNLOAD_SECRET: rnd(24),
  AI_PROVENANCE_SECRET: rnd(24),
  CORS_ORIGIN: 'http://localhost:3000', FRONTEND_URL: 'http://localhost:3000', PUBLIC_BASE_URL: 'http://localhost:3000', APP_BASE_URL: 'http://localhost:3000',
  NEXT_PUBLIC_API_URL: '',
};
let src = fs.readFileSync('.env', 'utf8');
for (const [k, v] of Object.entries(set)) {
  const re = new RegExp('^#?\\\\s*' + k + '=.*$', 'm');
  src = re.test(src) ? src.replace(re, k + '=' + v) : src + '\n' + k + '=' + v;
}
fs.writeFileSync('.env', src);
NODE
set +e
ADMIN_EMAIL=admin@rehearsal.local ADMIN_PASSWORD='CHANGE_ME' ADMIN_FAMILY_NAME=리허설 ADMIN_GIVEN_NAME=관리자 \
  bash infra/install/install.sh --masters-dir /rh/masters --allow-unverified-masters > /rh/install.log 2>&1
echo \$? > /rh/install.rc
set -e
cat apps/api/BUILD_INFO.json > /rh/build-info.json 2>/dev/null || echo '(BUILD_INFO.json 없음)' > /rh/build-info.json
INSIDE

START=$(date +%s)
docker exec "$APP" mkdir -p /rh
docker cp "$WORK/." "$APP:/rh/"
docker exec "$APP" bash /rh/inside.sh || true
for f in install.log install.rc build-info.json npm-ci.log; do docker cp "$APP:/rh/$f" "$WORK/$f" >/dev/null 2>&1 || true; done
ELAPSED=$(( $(date +%s) - START ))
cp "$WORK/install.log" "$OUT_DIR/install.log" 2>/dev/null || true
RC="$(cat "$WORK/install.rc" 2>/dev/null || echo '측정 불가')"
{
  echo "HEAD=$HEAD"
  echo "install.sh 종료 코드=$RC · 전체 ${ELAPSED}s"
  echo "--- 단계 줄"
  grep -E '^\[?[0-9: ]*\]? ?[0-9]/7|✅|❌|⚠|실패|거부|가용 메모리|산출물 커밋|commit|mode' "$WORK/install.log" 2>/dev/null | head -60 || true
  echo "--- BUILD_INFO.json"
  cat "$WORK/build-info.json" 2>/dev/null || true
  echo "--- npm ci 꼬리"
  tail -3 "$WORK/npm-ci.log" 2>/dev/null || true
} > "$OUT_DIR/result.txt"
cat "$OUT_DIR/result.txt"
[ "$RC" = 0 ]
