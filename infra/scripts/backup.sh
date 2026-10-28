#!/bin/bash
# Hospital RUN — PostgreSQL 자동 백업 스크립트
# cron: 0 3 * * * /home/deploy/his-backup/weruby/hospital-run/infra/scripts/backup.sh
# 🔴 2026-09-09 서버 이전(ML 서버 203.0.113.10): OS timezone=Asia/Seoul 이라 위 `0 3` 은 **KST 새벽 3시**다.
#    (구 서버는 UTC 라 `0 3` 이 KST 정오였다 — 서버가 바뀌면 크론 시간대부터 다시 본다)
#
# EMR 인증 요구사항: BR-1 (정기 백업), BR-2 (백업 암호화)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# (T10-5) 사본 대상·삭제 정책 키를 deploy.env 에서도 읽는다 — 파일 값은 **비어 있는 변수에만**(환경변수 우선) · 파일이 없으면 종전 기본값
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-${SCRIPT_DIR}/deploy.env}"
if [ -f "${DEPLOY_ENV_FILE}" ]; then
  while IFS='=' read -r _k _v || [ -n "${_k:-}" ]; do
    [[ "${_k}" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    if [ -z "${!_k:-}" ]; then export "${_k}=${_v}"; fi
  done < "${DEPLOY_ENV_FILE}"
fi

# 설정
# 🔴 (2026-09-21 갈래 E · 형제 프로젝트 R52) DB 이름·사용자·호스트·보관일이 **코드에 박혀** 있어
#    다른 기관 설치본에서는 고칠 곳을 찾아야 했고, 같은 PostgreSQL 에 형제 시스템 DB(ERP 등)를 두는
#    배치에서는 그 DB 가 **백업에서 통째로 빠졌다**. 전부 환경변수로 뺀다 — 기본값은 종전 운영 값 그대로.
DB_NAME="${HIS_BACKUP_DB_NAME:-hospitalrun}"
DB_USER="${HIS_BACKUP_DB_USER:-hospital}"
DB_HOST="${HIS_BACKUP_DB_HOST:-localhost}"
DB_PORT="${HIS_BACKUP_DB_PORT:-5432}"
# 🔴 (2026-09-13 상용 릴리즈 T3-5) 설치 대상별로 바꿀 수 있게 환경변수로 뺐다 — **기본값은 종전 운영 값 그대로**(크론은 env 없이 돈다)
BACKUP_DIR="${HIS_BACKUP_DIR:-/home/deploy/backups/hospitalrun}"
PASSPHRASE_FILE="${HIS_BACKUP_PASSPHRASE_FILE:-/home/deploy/.backup-passphrase}"
RETENTION_DAYS="${HIS_BACKUP_RETENTION_DAYS:-30}"
DATE=$(date +%Y%m%d_%H%M%S)
# 🔴 파일 이름 접두는 **DB 이름에서 만들지 않는다.** 정기 백업 이름 패턴의 정본은 코드 쪽
#    `apps/api/src/common/backup-files.ts` `PERIODIC_BACKUP_PATTERN`(`hospitalrun_<ts>.sql.gz[.gpg]`)이고,
#    go-live `security.dbBackup` · 감시자 `pipe.backup` 이 그 패턴으로 판정한다. DB 이름을 바꿨다고
#    접두가 따라 바뀌면 **판정기가 정기 백업을 못 찾아 "백업 없음"** 이 된다(같은 사실에 정본이 둘).
BACKUP_FILE="${BACKUP_DIR}/hospitalrun_${DATE}.sql.gz"
# 추가 대상 DB — 쉼표로 나열(예: `HIS_BACKUP_EXTRA_DBS=erp,edu`). 기본은 비어 있다(종전과 같음).
# 🔴 이름은 `extra-<db>_<DATE>.sql.gz[.gpg]` 다 — 정기 백업 패턴과 **일부러 다르게** 둔다.
#    (배포 백업 `.gpg` 를 정기 백업으로 세어 거짓 안심을 말한 이력이 있다 — 같은 실수를 만들지 않는다)
EXTRA_DBS="${HIS_BACKUP_EXTRA_DBS:-}"

# 디렉토리 생성
mkdir -p "${BACKUP_DIR}"

# 1. pg_dump + gzip 압축 (Docker 컨테이너 경유)
DOCKER_CONTAINER="${HIS_PG_CONTAINER:-docker-postgres-1}"
echo "[$(date)] Starting backup: ${BACKUP_FILE}"
docker exec ${DOCKER_CONTAINER} pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U ${DB_USER} -d ${DB_NAME} \
  --no-owner --no-privileges --format=plain \
  | gzip > "${BACKUP_FILE}"

# 2. 파일 크기 확인
SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
echo "[$(date)] Backup completed: ${SIZE}"

# 3. GPG 암호화 (대칭키)
# 🔴 패스프레이즈 파일이 없으면 암호화하지 않았다고 **말한다**(set -e 로 조용히 죽으면 평문 파일만 남고 아무도 모른다).
#    go-live `security.dbBackup` 은 .gpg 생성 시각으로 판정하므로 평문만 있으면 NOT_READY 가 맞다.
if command -v gpg &> /dev/null && [ ! -r "${PASSPHRASE_FILE}" ]; then
  echo "[$(date)] 🔴 ${PASSPHRASE_FILE} 없음 — 암호화 생략(평문 백업만 남음). 파일을 만들면 다음 실행부터 .gpg 생성"
elif command -v gpg &> /dev/null; then
  ENCRYPTED_FILE="${BACKUP_FILE}.gpg"
  gpg --batch --yes --symmetric --cipher-algo AES256 \
    --passphrase-file "${PASSPHRASE_FILE}" \
    --output "${ENCRYPTED_FILE}" "${BACKUP_FILE}"
  rm -f "${BACKUP_FILE}"
  echo "[$(date)] Encrypted: ${ENCRYPTED_FILE}"
else
  echo "[$(date)] Warning: GPG not found, backup saved unencrypted"
fi

# 3-a. 추가 대상 DB — 같은 PostgreSQL 에 형제 시스템 DB 를 두는 배치용. 기본은 비어 있다.
# 🔴 한 DB 라도 덤프에 실패하면 **이 스크립트는 실패다**(종료 코드 1) — "HIS 는 받았으니 성공"이라고
#    말하면 빠진 DB 를 아무도 모른다. 암호화할 수 없으면 평문 덤프를 남기지 않고 지운다.
EXTRA_RC=0
if [ -n "${EXTRA_DBS}" ]; then
  IFS=',' read -r -a _EXTRA_ARR <<< "${EXTRA_DBS}"
  for _db in "${_EXTRA_ARR[@]}"; do
    _db="$(echo "${_db}" | tr -d '[:space:]')"
    [ -n "${_db}" ] || continue
    _EXTRA_FILE="${BACKUP_DIR}/extra-${_db}_${DATE}.sql.gz"
    echo "[$(date)] Starting extra backup: ${_EXTRA_FILE}"
    if ! docker exec ${DOCKER_CONTAINER} pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U ${DB_USER} -d "${_db}" \
         --no-owner --no-privileges --format=plain | gzip > "${_EXTRA_FILE}"; then
      echo "[$(date)] 🔴 추가 DB 덤프 실패: ${_db}"
      rm -f "${_EXTRA_FILE}"
      EXTRA_RC=1
      continue
    fi
    if command -v gpg &> /dev/null && [ -r "${PASSPHRASE_FILE}" ]; then
      if gpg --batch --yes --symmetric --cipher-algo AES256 \
           --passphrase-file "${PASSPHRASE_FILE}" \
           --output "${_EXTRA_FILE}.gpg" "${_EXTRA_FILE}"; then
        rm -f "${_EXTRA_FILE}"
        echo "[$(date)] Encrypted: ${_EXTRA_FILE}.gpg"
      else
        echo "[$(date)] 🔴 추가 DB 암호화 실패: ${_db} — 평문 덤프를 남기지 않고 지운다"
        rm -f "${_EXTRA_FILE}"
        EXTRA_RC=1
      fi
    else
      echo "[$(date)] 🔴 ${PASSPHRASE_FILE} 없음 — 추가 DB(${_db}) 평문 덤프를 남기지 않고 지운다"
      rm -f "${_EXTRA_FILE}"
      EXTRA_RC=1
    fi
  done
fi

# 3-b. 파일 저장소 아카이브(상용 릴리즈 T10 · 2026-09-13)
# 🔴 DB 만 복원하면 첨부·원음·서류 행은 돌아오는데 가리키는 파일이 없다 — 같은 <DATE> 짝으로 파일도 담는다.
#    대상 경로·meta 상태·짝 규칙 정본: lib/backup-files.sh · 결과는 hospitalrun-files_<DATE>.meta → backup-copy.sh 가 상태 파일에 옮긴다.
#    경로 없음(NO_PATHS)은 파일 0개와 다르게 기록 · 암호화 불가면 평문 아카이브를 만들지 않는다 · tar/gpg 실패는 FAILED + 이 스크립트 exit 1
# shellcheck source=lib/backup-files.sh
source "${SCRIPT_DIR}/lib/backup-files.sh"
APP_ROOT="${HIS_APP_ROOT:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
FILES_RC=0
create_files_archive "${APP_ROOT}" "${BACKUP_DIR}" "${DATE}" "${PASSPHRASE_FILE}" || FILES_RC=$?

# 4. 2차 사본(상용 릴리즈 T10-5) — 🔴 암호문만 복사·크기/sha256 대조·결과는 backup-status.json
#    대상(HIS_BACKUP_COPY_TARGET)이 없으면 실패가 아니라 "2차 사본 없음"을 **매번** 기록한다.
#    사본 실패가 백업 자체를 실패로 만들지는 않는다(원본 백업은 이미 남았다) — 대신 로그·상태 파일·감시자가 말한다.
COPY_RC=0
# 실행 비트에 기대지 않는다(실행 비트가 빠져 크론이 89일 막힌 적이 있다)
# 백업 디렉터리는 이 스크립트가 쓴 곳을 그대로 넘긴다(두 스크립트가 다른 디렉터리를 보면 사본이 엉뚱한 파일을 본다)
HIS_BACKUP_DIR="${BACKUP_DIR}" bash "${SCRIPT_DIR}/backup-copy.sh" "${BACKUP_FILE}${ENCRYPTED_FILE:+.gpg}" || COPY_RC=$?
echo "[$(date)] 2차 사본 단계 종료 코드: ${COPY_RC} (0=검증 통과 또는 미설정 기록 · 1=복사/검증 실패 · 2=평문 거부) — 상세 ${BACKUP_DIR}/backup-status.json"

# 5. 오래된 백업 삭제 (30일 보관)
# 🔴 기본 동작은 종전 그대로(30일 지나면 사본 여부와 무관하게 삭제).
#    "사본 검증된 것만 지운다"를 기본으로 하면 사본 대상이 없는 지금 **디스크가 찬다**(백업 1개도 못 지운다) —
#    그래서 옵트인(HIS_BACKUP_PRUNE_REQUIRES_COPY=1)으로만 켠다. 켜면 copy-manifest.tsv 에 **같은 sha256** 으로
#    검증 기록이 있는 파일만 지우고, 나머지는 남긴 채 몇 개 남겼는지 말한다.
if [ "${HIS_BACKUP_PRUNE_REQUIRES_COPY:-0}" = "1" ]; then
  MANIFEST_FILE="${BACKUP_DIR}/copy-manifest.tsv"
  KEPT=0
  while IFS= read -r OLD; do
    [ -n "${OLD}" ] || continue
    OLD_NAME="$(basename "${OLD}")"
    OLD_SHA="$( (command -v sha256sum >/dev/null 2>&1 && sha256sum "${OLD}" || shasum -a 256 "${OLD}") | awk '{print $1}')"
    if [ -f "${MANIFEST_FILE}" ] && awk -F'\t' -v n="${OLD_NAME}" -v s="${OLD_SHA}" '$1==n && $2==s {found=1} END {exit found?0:1}' "${MANIFEST_FILE}"; then
      rm -f "${OLD}"
    else
      KEPT=$((KEPT + 1))
    fi
  done < <(find "${BACKUP_DIR}" \( -name "hospitalrun_*.sql.gz*" -o -name "hospitalrun-files_*.tar.gz.gpg" -o -name "extra-*_*.sql.gz*" \) -mtime +${RETENTION_DAYS})
  echo "[$(date)] Cleaned backups older than ${RETENTION_DAYS} days (사본 검증분만) — 🔴 사본 기록이 없어 남긴 파일 ${KEPT}개"
else
  find "${BACKUP_DIR}" -name "hospitalrun_*.sql.gz*" -mtime +${RETENTION_DAYS} -delete
  find "${BACKUP_DIR}" -name "hospitalrun-files_*.tar.gz.gpg" -mtime +${RETENTION_DAYS} -delete
  find "${BACKUP_DIR}" -name "extra-*_*.sql.gz*" -mtime +${RETENTION_DAYS} -delete
  echo "[$(date)] Cleaned backups older than ${RETENTION_DAYS} days"
fi
# 파일 아카이브 기록(meta)은 짝 아카이브가 지워진 뒤에만 지운다 — 아카이브가 남아 있는데 기록만 사라지면 검증이 짝을 못 찾는다
while IFS= read -r OLD_META; do
  [ -n "${OLD_META}" ] || continue
  [ -f "${OLD_META%.meta}.tar.gz.gpg" ] || rm -f "${OLD_META}"
done < <(find "${BACKUP_DIR}" -name "hospitalrun-files_*.meta" -mtime +${RETENTION_DAYS})

# 6. 백업 목록 출력
echo "[$(date)] Current backups:"
ls -lh "${BACKUP_DIR}"/hospitalrun_*.sql.gz* "${BACKUP_DIR}"/hospitalrun-files_*.tar.gz.gpg 2>/dev/null | tail -6 || true  # 한쪽 glob 이 비면 ls 가 1 → pipefail 로 여기서 죽지 않게

# 🔴 파일 아카이브 실패는 백업 실패다 — DB 덤프가 남았어도 "성공(exit 0)"으로 끝내지 않는다
if [ "${FILES_RC}" = "1" ]; then
  echo "[$(date)] 🔴 파일 아카이브 실패로 종료 코드 1 — 상세 ${BACKUP_DIR}/hospitalrun-files_${DATE}.meta"
  exit 1
fi

# 🔴 추가 대상 DB 실패도 백업 실패다 — 빠진 DB 를 "성공"으로 덮지 않는다
if [ "${EXTRA_RC}" = "1" ]; then
  echo "[$(date)] 🔴 추가 대상 DB 백업 실패로 종료 코드 1 (HIS_BACKUP_EXTRA_DBS=${EXTRA_DBS})"
  exit 1
fi
