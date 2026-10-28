#!/usr/bin/env bash
# HIS 서버에서 apps/homepage 빌드 → S3 발행. HIS API(홈페이지 배포 버튼)가 백그라운드 호출.
# 격리 빌드(hoisting 회피) + static/public/ecosystem 동봉 + SSG 실데이터(INTERNAL_API_URL).
# 상태는 STATUS(JSON)에 기록 → HIS API 가 읽어 진행/결과 표시.
set -uo pipefail

# 기본 경로는 이 스크립트 위치에서 유도한다(서버 이전 시 경로가 바뀌어도 따라간다 — 2026-09-09 ML 서버 이전)
SRC="${HOMEPAGE_SRC:-$(cd "$(dirname "$0")/../.." && pwd)/apps/homepage}"
S3="${HOMEPAGE_S3:-s3://weruby-aws-cost/deploy}"
REGION="${HOMEPAGE_S3_REGION:-ap-northeast-2}"
API_ORIGIN="${HOMEPAGE_API_ORIGIN:-https://his.example.org}"
STATUS="${HOMEPAGE_BUILD_STATUS:-/home/deploy/homepage-build-status.json}"
AWS_BIN="$(command -v aws || echo /home/deploy/.local/bin/aws)"

TS=$(date +%Y%m%d-%H%M)   # 아티팩트 파일명 겸용(형식 고정)
# 🔴 `ts` 는 파일명과 같은 압축 형식이라 JS `new Date()` 가 파싱하지 못한다 — 화면이 "Invalid Date" 를
#    보여줬고, 경과 시간·상태 만료 판정도 전부 죽어 있었다(2026-09-02 실측: 6월 기록이 '배포 전환 중'으로 남음).
#    상태 시각은 호출 시점의 ISO(오프셋 포함)로 따로 남긴다. `ts` 는 아티팩트 이름과의 대응 때문에 유지한다.
# 🔴 소스 커밋(2026-09-15) — 버튼은 서버의 apps/homepage 사본을 빌드한다. 그 사본이 어느 커밋인지 모르면
#    "발행 완료"가 어떤 코드를 발행했는지 말하지 못한다(09-15 실측: 서버 사본이 09-01 소스였다).
#    deploy.sh 가 남긴 SOURCE_INFO.json 의 commit 을 읽는다. 없으면 null(지어내지 않는다).
SOURCE_COMMIT="$(sed -nE 's/.*"commit":"([0-9a-f]{7,40})".*/\1/p' "$SRC/SOURCE_INFO.json" 2>/dev/null | head -1)"
SRC_META=",\"sourceCommit\":$([ -n "$SOURCE_COMMIT" ] && printf '"%s"' "$SOURCE_COMMIT" || printf 'null')"
st() { printf '{"status":"%s","ts":"%s","at":"%s"%s%s}\n' "$1" "$TS" "$(date -Iseconds)" "$SRC_META" "${2:-}" > "$STATUS"; }
# 마지막으로 **S3 발행에 성공한** 빌드 — 상태 파일은 마지막 시도라 실패하면 덮인다(라이브 대조 기준이 사라진다).
PUBLISHED="${HOMEPAGE_LAST_PUBLISHED:-$(dirname "$STATUS")/homepage-last-published.json}"
st building

# 🔴 자격 사전 확인(2026-09-15) — 만료 키로 5분짜리 빌드를 다 돌리고 S3 에서야 실패했다.
#    his-api 가 물려준 환경변수(AWS_ACCESS_KEY_ID)가 ~/.aws/credentials 보다 우선한다 — 같은 조건으로 확인한다.
if ! "$AWS_BIN" sts get-caller-identity --region "$REGION" >/tmp/hp-build.log 2>&1; then
  st failed ',"stage":"credentials"'; exit 1
fi

ISO=$(mktemp -d)
trap 'rm -rf "$ISO"' EXIT
rsync -a --exclude node_modules --exclude .next "$SRC/" "$ISO/" || { st failed ',"stage":"sync"'; exit 1; }
cd "$ISO" || { st failed ',"stage":"cd"'; exit 1; }

# 🔴 빌드 스탬프(2026-09-03) — 라이브가 "지금 어느 빌드를 서비스 중인가"를 기계로 답하는 유일한 표본.
#    종전 표본(예약 페이지 AI 표기)은 그 페이지가 Suspense 셸이라 초기 HTML 에 구조적으로 나올 수 없어
#    **어느 빌드든 영원히 '낡음'** 으로 판정했다(발행이 성공해도 화면·배포 스크립트가 낡았다고 말함).
mkdir -p public && printf '%s' "$TS" > public/build-stamp.txt
# 라이브가 어느 소스 커밋인지 — 스탬프(TS)와 따로 둔다(스탬프 형식은 화면·배포 스크립트가 고정 형식으로 읽는다)
[ -n "$SOURCE_COMMIT" ] && printf '%s' "$SOURCE_COMMIT" > public/build-source.txt

if ! npm install --no-audit --no-fund >>/tmp/hp-build.log 2>&1; then st failed ',"stage":"install"'; exit 1; fi
if ! HOMEPAGE_API_ORIGIN="$API_ORIGIN" INTERNAL_API_URL="$API_ORIGIN" NEXT_PUBLIC_API_URL='' NEXT_TELEMETRY_DISABLED=1 npm run build >>/tmp/hp-build.log 2>&1; then
  st failed ',"stage":"build"'; exit 1
fi

cp -r .next/static .next/standalone/.next/static
[ -d public ] && cp -r public .next/standalone/public
cp ecosystem.config.cjs .next/standalone/
ART="/tmp/homepage-${TS}.tgz"
tar czf "$ART" -C .next/standalone .

if ! "$AWS_BIN" s3 cp "$ART" "${S3}/" --region "$REGION" >>/tmp/hp-build.log 2>&1; then
  st failed ',"stage":"s3"'; exit 1
fi
SHA=$(sha256sum "$ART" | cut -d' ' -f1)
SIZE=$(du -h "$ART" | cut -f1)
META=",\"artifact\":\"${S3}/homepage-${TS}.tgz\",\"sha256\":\"${SHA}\",\"size\":\"${SIZE}\""
printf '{"ts":"%s","at":"%s"%s%s}\n' "$TS" "$(date -Iseconds)" "$SRC_META" "$META" > "$PUBLISHED"

# B안: 빌드·발행 성공 후 인프라 SSM Document 트리거(= EC2 배포). 미설정이면 발행까지만(success).
SSM_DOC="${HOMEPAGE_SSM_DOCUMENT:-}"
SSM_TARGET="${HOMEPAGE_SSM_TARGET:-}"
if [ -n "$SSM_DOC" ] && [ -n "$SSM_TARGET" ]; then
  CMD=$("$AWS_BIN" ssm send-command --region "$REGION" \
    --document-name "$SSM_DOC" \
    --targets "Key=InstanceIds,Values=${SSM_TARGET}" \
    --parameters "artifact=homepage-${TS}.tgz" \
    --query Command.CommandId --output text 2>>/tmp/hp-build.log)
  if [ -n "$CMD" ]; then
    st deploy_triggered "${META},\"ssmCommandId\":\"${CMD}\""
    echo "[build-homepage] published + SSM deploy triggered: ${S3}/homepage-${TS}.tgz (cmd $CMD)"
    exit 0
  fi
  st success "${META},\"deployNote\":\"SSM 트리거 실패 — 발행은 성공, 배포는 인프라 수동\""
  echo "[build-homepage] published; SSM trigger FAILED (deploy manually)"
  exit 0
fi
st success "$META"
echo "[build-homepage] success: ${S3}/homepage-${TS}.tgz ($SIZE, $SHA)"
