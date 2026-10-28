#!/bin/bash
# Hospital RUN — 백업 **복원 검증** 장치 (상용 릴리즈 T10-5 · 2026-09-13)
#
# 🔴 왜: 열어 본 적 없는 백업은 백업이 아니다. 운영 문서끼리도 "복원 확인됨"(production-operations §7.1)과
#    "미수행"(backup-and-key-rotation §1.4)이 모순이었다 — 복원이 되는지 **기록으로 남는 경로**가 없었다.
#
# 사용:
#   backup-verify.sh [백업 파일]                                   # 무결성까지(복호화 → gunzip → CREATE TABLE 수)
#   backup-verify.sh [백업 파일] --restore-db <scratch DB URL>     # + 빈 임시 DB 에 실제 복원 → 테이블·핵심 행 수 대조
#   (백업 파일 생략 시 백업 디렉터리의 가장 최근 정기 백업)
# 설정: HIS_BACKUP_DIR · HIS_BACKUP_PASSPHRASE_FILE (환경변수 우선 · 없으면 infra/scripts/deploy.env)
#
# 🔴 복원 대상 안전장치(이름·주소 판정 — 운영 DB 에 복원하면 운영 데이터를 덮는다):
#   ① DB 이름에 `verify`·`restore`·`scratch` 중 하나가 **들어 있어야** 한다(허용 목록 — 모르는 이름은 거부)
#   ② 운영 DB 이름(`hospitalrun`·`openpacs`)·시스템 DB(`postgres`·`template0/1`)는 거부
#   ③ 현재 환경의 DATABASE_URL 과 같은 주소면 거부
#   ④ 대상 DB 의 public 스키마에 테이블이 **하나라도 있으면** 거부(빈 DB 에만 복원)
#
# 🔴 파일 아카이브(같은 시각 짝 `hospitalrun-files_<TS>.tar.gz.gpg` · lib/backup-files.sh): 기록이 ARCHIVED 면
#    sha256 대조 → 복호화 → 목록의 파일 수 = 기록된 원본 파일 수. 틀리면 백업 한 벌이 복원 불가이므로 **전체 FAIL**.
#    기록이 FAILED·NOT_ENCRYPTED 면 이 백업에 파일이 없다 → 전체 FAIL(DB 가 열려도 행이 가리키는 파일은 돌아오지 않는다).
#    기록 없음(NOT_RUN — 파일 단계 이전 백업)·경로 없음(NO_PATHS)은 DB 판정을 유지하되 상세에 "파일 없음"을 밝힌다.
#    파일을 실제로 풀어 놓지는 않는다(--restore-db 도 DB 만 복원한다).
#
# 결과는 ${HIS_BACKUP_DIR}/backup-status.json 의 `lastRestoreVerified*`·`lastFilesVerify*` 필드에 남긴다(backup-copy.sh 와 같은 파일).
# 종료 코드: 0 = PASS · 1 = FAIL · 3 = 복원 대상 거부

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-${SCRIPT_DIR}/deploy.env}"
if [ -f "${DEPLOY_ENV_FILE}" ]; then
  while IFS='=' read -r _k _v || [ -n "${_k:-}" ]; do
    [[ "${_k}" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    if [ -z "${!_k:-}" ]; then export "${_k}=${_v}"; fi
  done < "${DEPLOY_ENV_FILE}"
fi

# shellcheck source=lib/backup-files.sh
source "${SCRIPT_DIR}/lib/backup-files.sh"

BACKUP_DIR="${HIS_BACKUP_DIR:-/home/deploy/backups/hospitalrun}"
PASSPHRASE_FILE="${HIS_BACKUP_PASSPHRASE_FILE:-/home/deploy/.backup-passphrase}"
STATUS_FILE="${BACKUP_DIR}/backup-status.json"
PERIODIC_RE='^hospitalrun_[0-9]{8}_[0-9]{6}\.sql\.gz(\.gpg)?$'
# 행 수를 대조할 핵심 테이블 — 진료기록부·처방·동의·접속기록의 대표
KEY_TABLES=(patients encounters prescriptions consent_forms audit_logs)

log() { echo "[$(date)] $*"; }
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
json_str() {
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\n'/ }"; s="${s//$'\r'/ }"; s="${s//$'\t'/ }"
  printf '"%s"' "$s"
}
# 기존 상태 파일에서 한 키의 원문 값(JSON 조각) — backup-copy.sh 와 같은 규칙
prev_raw() {
  local key="$1"
  [ -f "${STATUS_FILE}" ] || { printf 'null'; return; }
  local v
  v=$(grep -oE "\"${key}\":(null|true|false|-?[0-9]+|\"([^\"\\\\]|\\\\.)*\")" "${STATUS_FILE}" | head -1 | sed -E "s/^\"${key}\"://") || true
  [ -n "${v}" ] && printf '%s' "${v}" || printf 'null'
}

# 🔴 복원해도 되는 DB 주소인가 — 0=허용 · 1=거부(사유를 표준출력에)
is_scratch_db_url() {
  local url="$1"
  local noq="${url%%\?*}"
  # 스킴(`postgresql://`)을 떼고 나서 경로가 있어야 DB 이름이다 — 없으면 호스트 이름(`restore-host`)을 DB 이름으로 오판한다
  local rest="${noq#*://}"
  case "${rest}" in */*) ;; *) echo "DB 이름을 읽지 못했다(주소에 /DB이름 이 없다)"; return 1 ;; esac
  local db="${rest##*/}"
  if [ -z "${db}" ]; then echo "DB 이름을 읽지 못했다"; return 1; fi
  case "${db}" in
    hospitalrun|openpacs|postgres|template0|template1) echo "운영·시스템 DB 이름(${db})이다"; return 1 ;;
  esac
  if [ -n "${DATABASE_URL:-}" ] && [ "${DATABASE_URL%%\?*}" = "${noq}" ]; then echo "현재 DATABASE_URL 과 같은 주소다"; return 1; fi
  case "${db}" in
    *verify*|*restore*|*scratch*) return 0 ;;
  esac
  echo "DB 이름(${db})에 verify·restore·scratch 가 없다 — 임시 DB 로 확인할 수 없다"
  return 1
}

# 상태 파일의 복원 검증 필드만 바꾼다(없으면 최소 상태 파일을 만든다 — 사본 필드는 null 로 둔다)
record_verify() {
  # $1 status(PASS|FAIL) · $2 level(INTEGRITY|RESTORE) · $3 file · $4 detail
  local at; at="$(now_iso)"
  local set_at; set_at="$(json_str "${at}")"
  local set_level; set_level="$(json_str "$2")"
  local set_status; set_status="$(json_str "$1")"
  local set_file; set_file="$(json_str "$3")"
  local set_detail; set_detail="$(json_str "$4")"
  mkdir -p "${BACKUP_DIR}"
  # 🔴 PASS 일 때만 lastRestoreVerifiedAt 을 갱신한다 — 실패한 시도를 "검증됨" 시각으로 남기지 않는다
  local verified_at; verified_at="$(prev_raw lastRestoreVerifiedAt)"
  [ "$1" = "PASS" ] && verified_at="${set_at}"
  # 사본 필드는 backup-copy.sh 몫 — 원문 그대로 옮긴다. 상태 파일이 없으면 "사본 모름"(UNKNOWN·missing=true)
  local copy_status; copy_status="$(prev_raw copyStatus)"
  local missing; missing="$(prev_raw secondCopyMissing)"
  local scope; scope="$(prev_raw backupScope)"
  local copy_detail; copy_detail="$(prev_raw copyDetail)"
  local kind; kind="$(prev_raw copyTargetKind)"
  if [ ! -f "${STATUS_FILE}" ]; then
    copy_status='"UNKNOWN"'; missing='true'; scope='"DB_ONLY"'; kind='"NONE"'
    copy_detail='"backup-copy.sh 가 아직 돌지 않았습니다 — 2차 사본 여부를 모릅니다"'
  fi
  local tmp="${STATUS_FILE}.tmp.$$"
  {
    printf '{"schema":1'
    printf ',"updatedAt":%s' "${set_at}"
    printf ',"backupScope":%s' "${scope}"
    printf ',"lastBackupAt":%s' "$(prev_raw lastBackupAt)"
    printf ',"lastBackupFile":%s' "$(prev_raw lastBackupFile)"
    printf ',"lastBackupBytes":%s' "$(prev_raw lastBackupBytes)"
    printf ',"lastBackupSha256":%s' "$(prev_raw lastBackupSha256)"
    printf ',"lastBackupEncrypted":%s' "$(prev_raw lastBackupEncrypted)"
    printf ',"copyTarget":%s' "$(prev_raw copyTarget)"
    printf ',"copyTargetKind":%s' "${kind}"
    printf ',"copyStatus":%s' "${copy_status}"
    printf ',"copyAt":%s' "$(prev_raw copyAt)"
    printf ',"copySha256":%s' "$(prev_raw copySha256)"
    printf ',"copySameDeviceAsSource":%s' "$(prev_raw copySameDeviceAsSource)"
    printf ',"copyDetail":%s' "${copy_detail}"
    printf ',"secondCopyMissing":%s' "${missing}"
    printf ',"lastRestoreVerifiedAt":%s' "${verified_at}"
    printf ',"lastRestoreVerifyLevel":%s' "${set_level}"
    printf ',"lastRestoreVerifyStatus":%s' "${set_status}"
    printf ',"lastRestoreVerifyFile":%s' "${set_file}"
    printf ',"lastRestoreVerifyDetail":%s' "${set_detail}"
    # 파일 아카이브 필드 — 아카이브·사본 쪽은 backup-copy.sh 몫이라 원문 그대로 · 검증 쪽만 이번 결과로
    local k
    for k in filesArchiveStatus filesArchiveFile filesArchiveFileCount filesArchiveSha256 filesArchivePathsMissing filesArchiveDetail filesCopyStatus filesCopyDetail; do
      printf ',"%s":%s' "${k}" "$(prev_raw "${k}")"
    done
    printf ',"lastFilesVerifyStatus":%s' "$(json_str "${FV_STATUS}")"
    printf ',"lastFilesVerifyDetail":%s' "$(json_str "${FV_DETAIL}")"
    printf '}\n'
  } > "${tmp}"
  mv -f "${tmp}" "${STATUS_FILE}"
}

decrypt_stream() {
  local f="$1"
  case "$f" in
    *.gpg)
      [ -r "${PASSPHRASE_FILE}" ] || { echo "패스프레이즈 파일을 읽지 못했다(${PASSPHRASE_FILE})" >&2; return 1; }
      gpg --batch --quiet --decrypt --passphrase-file "${PASSPHRASE_FILE}" "$f"
      ;;
    *) cat "$f" ;;
  esac
}

# 파일 아카이브 검증 결과(record_verify 가 쓴다)
FV_STATUS="NOT_CHECKED"; FV_DETAIL="파일 아카이브를 확인하기 전에 끝났습니다"

# 같은 시각 짝의 파일 아카이브를 확인한다 — 0 = 문제 없음(또는 짝 없음을 밝힘) · 1 = 백업 한 벌이 불완전
verify_files_archive() {
  local db_file="$1" dir; dir="$(dirname "${db_file}")"
  load_files_meta "${dir}" "$(files_ts_of "${db_file}")"
  case "${FA_STATUS}" in
    ARCHIVED) ;;
    NO_PATHS) FV_STATUS="NOT_APPLICABLE"; FV_DETAIL="파일 저장소 경로가 없어 담은 파일이 없습니다 — ${FA_DETAIL}"; return 0 ;;
    NOT_RUN)  FV_STATUS="NOT_RUN"; FV_DETAIL="${FA_DETAIL}"; return 0 ;;
    *)        FV_STATUS="FAIL"; FV_DETAIL="이 백업에는 파일 아카이브가 없습니다(${FA_STATUS}) — ${FA_DETAIL}"; return 1 ;;
  esac
  local archive="${dir}/${FA_FILE}"
  if [ ! -f "${archive}" ]; then
    FV_STATUS="FAIL"; FV_DETAIL="기록은 있는데 파일 아카이브가 없습니다(${FA_FILE})"; return 1
  fi
  local sha; sha="$(_bf_sha256 "${archive}")"
  if [ "${sha}" != "${FA_SHA}" ]; then
    FV_STATUS="FAIL"; FV_DETAIL="파일 아카이브 sha256 가 기록과 다릅니다(${FA_FILE})"; return 1
  fi
  if [ ! -r "${PASSPHRASE_FILE}" ]; then
    FV_STATUS="FAIL"; FV_DETAIL="패스프레이즈 파일을 읽지 못해 파일 아카이브를 열지 못했습니다"; return 1
  fi
  local listed=""
  if ! listed=$(files_archive_entry_count "${archive}" "${PASSPHRASE_FILE}"); then
    FV_STATUS="FAIL"; FV_DETAIL="파일 아카이브 복호화·압축 해제 실패(${FA_FILE})"; return 1
  fi
  if [ "${listed}" != "${FA_COUNT}" ]; then
    FV_STATUS="FAIL"; FV_DETAIL="파일 아카이브 목록 ${listed}개 ≠ 기록된 원본 ${FA_COUNT}개(${FA_FILE})"; return 1
  fi
  FV_STATUS="PASS"; FV_DETAIL="파일 아카이브 목록 ${listed}개 = 기록 ${FA_COUNT}개(${FA_FILE} · 풀어 놓지는 않음)"
  return 0
}

main() {
  local file="" restore_url=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --restore-db) restore_url="${2:-}"; shift 2 ;;
      *) file="$1"; shift ;;
    esac
  done
  if [ -z "${file}" ]; then
    file=$(ls -1t "${BACKUP_DIR}" 2>/dev/null | grep -E "${PERIODIC_RE}" | head -1 || true)
    [ -n "${file}" ] && file="${BACKUP_DIR}/${file}"
  fi
  if [ -z "${file}" ] || [ ! -f "${file}" ]; then
    log "🔴 검증할 백업 파일이 없다(${BACKUP_DIR})"
    return 1
  fi
  local name; name="$(basename "${file}")"

  if [ -n "${restore_url}" ]; then
    local why
    if ! why=$(is_scratch_db_url "${restore_url}"); then
      log "🔴 복원 대상 거부 — ${why}. 운영 DB 에는 복원하지 않는다"
      return 3
    fi
  fi

  # 1) 무결성 — 복호화 → gunzip → CREATE TABLE 수(평문 단계에서 비어 있으면 백업이 아니다)
  local creates
  if ! creates=$(decrypt_stream "${file}" | gunzip -c | grep -c 'CREATE TABLE'); then
    creates=0
  fi
  if [ "${creates}" -lt 1 ]; then
    log "🔴 무결성 실패 — 복호화/압축 해제가 실패했거나 CREATE TABLE 이 0 개다(${name})"
    record_verify "FAIL" "INTEGRITY" "${name}" "복호화·압축 해제 실패 또는 CREATE TABLE 0개"
    return 1
  fi
  log "무결성 통과 — CREATE TABLE ${creates}개(${name})"

  # 1-b) 파일 아카이브 짝 — 🔴 DB 가 열려도 파일이 없으면 백업 한 벌은 복원 불가다
  if ! verify_files_archive "${file}"; then
    log "🔴 파일 아카이브 검증 실패 — ${FV_DETAIL}"
    record_verify "FAIL" "INTEGRITY" "${name}" "DB 무결성은 통과(CREATE TABLE ${creates}개)했지만 ${FV_DETAIL}"
    return 1
  fi
  log "파일 아카이브 — ${FV_STATUS} · ${FV_DETAIL}"

  if [ -z "${restore_url}" ]; then
    record_verify "PASS" "INTEGRITY" "${name}" "복호화·압축 해제 통과 · CREATE TABLE ${creates}개(실제 복원은 하지 않음) · 파일 ${FV_STATUS}"
    return 0
  fi

  # 2) 실제 복원 — 빈 임시 DB 에만
  command -v psql >/dev/null 2>&1 || { log "🔴 psql 이 없다 — 복원 검증 불가"; record_verify "FAIL" "RESTORE" "${name}" "psql 없음"; return 1; }
  local existing
  existing=$(psql "${restore_url}" -Atc "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null || echo "ERR")
  if [ "${existing}" = "ERR" ]; then
    log "🔴 복원 대상 DB 에 접속하지 못했다"; record_verify "FAIL" "RESTORE" "${name}" "대상 DB 접속 실패"; return 1
  fi
  if [ "${existing}" != "0" ]; then
    log "🔴 복원 대상 거부 — public 스키마에 테이블 ${existing}개가 이미 있다(빈 DB 에만 복원)"
    return 3
  fi
  if ! decrypt_stream "${file}" | gunzip -c | psql "${restore_url}" -q -v ON_ERROR_STOP=1 >/dev/null; then
    log "🔴 복원 실패(${name})"; record_verify "FAIL" "RESTORE" "${name}" "psql 복원 중 오류"; return 1
  fi
  local restored
  restored=$(psql "${restore_url}" -Atc "select count(*) from information_schema.tables where table_schema='public'")
  local mismatch="" detail="테이블 ${restored}/${creates}"
  [ "${restored}" = "${creates}" ] || mismatch="테이블 수 불일치(복원 ${restored} ≠ 덤프 ${creates})"
  local t dump_rows db_rows
  for t in "${KEY_TABLES[@]}"; do
    # 덤프의 COPY 블록 행 수(plain 형식) — `COPY public.<t> (` 부터 `\.` 까지
    dump_rows=$(decrypt_stream "${file}" | gunzip -c | awk -v t="COPY public.${t} " 'index($0,t)==1{f=1;next} f&&$0=="\\."{f=0} f{n++} END{print n+0}')
    db_rows=$(psql "${restore_url}" -Atc "select count(*) from public.${t}" 2>/dev/null || echo "없음")
    detail="${detail} · ${t} ${db_rows}/${dump_rows}"
    if [ "${db_rows}" != "없음" ] && [ "${db_rows}" != "${dump_rows}" ]; then mismatch="${mismatch} ${t} 행 수 불일치"; fi
  done
  if [ -n "${mismatch}" ]; then
    log "🔴 복원 검증 실패 — ${mismatch}"
    record_verify "FAIL" "RESTORE" "${name}" "${mismatch} (${detail})"
    return 1
  fi
  log "복원 검증 통과 — ${detail}"
  record_verify "PASS" "RESTORE" "${name}" "빈 임시 DB 복원 통과 · ${detail}"
  return 0
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
