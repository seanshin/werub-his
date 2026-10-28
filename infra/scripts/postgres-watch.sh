#!/bin/bash
# HIS PostgreSQL 자기치유 감시 — 컨테이너 부재/불건강 시 개별 서비스 재기동(볼륨 보존·데이터 무손실)
# 배경: 2026-07-15 공유 서버에서 타 프로젝트 compose가 docker-postgres-1을 orphan 제거 → HIS 전면 다운 인시던트
#       (docs/handoff/HIS_인시던트_공유서버_postgres제거.md). pm2 api는 online으로 보여 무증상이라 호스트 크론으로 감시.
# 설치(서버): crontab에  */2 * * * * /home/deploy/his-backup/weruby/hospital-run/infra/scripts/postgres-watch.sh
# 🔴 2026-09-09 서버 이전: 신 서버의 postgres compose 는 저장소 밖 ~/his-backup/docker 다(볼륨 his-backup_his_pgdata).
#    저장소 안 infra/docker 로 up 하면 **다른 프로젝트명·빈 볼륨**의 postgres 가 뜬다 — 반드시 이 경로.
set -u
CONTAINER=${1:-docker-postgres-1}
COMPOSE_DIR=${COMPOSE_DIR:-/home/deploy/his-backup/docker}
LOG=${POSTGRES_WATCH_LOG:-/home/deploy/backups/postgres-watch.log}

state=$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null)

# 정상(healthy) 또는 기동 중(starting)이면 조용히 종료 — 크론 로그 오염 방지
if [ "$state" = "healthy" ] || [ "$state" = "starting" ]; then
  exit 0
fi

echo "[$(date '+%F %T')] postgres 이상 감지 (state='${state:-absent}') — 자동 복구 시도" >> "$LOG"

if [ -z "$state" ]; then
  # 컨테이너 자체가 없음(인시던트 패턴) — compose로 postgres 서비스만 재생성 (전체 restart 금지 규칙 준수)
  (cd "$COMPOSE_DIR" && docker compose up -d postgres) >> "$LOG" 2>&1
else
  # 존재하나 unhealthy/exited — 개별 재시작
  docker restart "$CONTAINER" >> "$LOG" 2>&1
fi

sleep 15
state2=$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null)
echo "[$(date '+%F %T')] 복구 결과: state='${state2:-absent}'" >> "$LOG"
