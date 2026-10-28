#!/bin/bash
# Hospital RUN — 정기 백업의 **2차 사본** 장치 (상용 릴리즈 T10-5 · 2026-09-13)
#
# 🔴 왜: 정기 백업 `.gpg` 는 매일 만들어지지만 **DB 와 같은 디스크**에 있고, 네트워크에 연결돼 있으며,
#    보관일이 지나면 지워진다(backup.sh). 디스크 하나가 죽으면 원본과 백업이 **함께** 사라진다.
#    의료법 시행규칙 제16조는 "네트워크에 연결되지 아니한 백업저장시스템"을 요구한다(2차 출처 · 원문 대조 필요).
#    저장소 **형태**(오프라인 매체 / 원내 별도 서버 / 국내 클라우드)는 사람 결정이다 — 이 스크립트는 형태를 정하지 않고
#    ① 설정된 대상으로 **암호문만** 복사하고 ② 복사본이 원본과 **같은지 확인**하고 ③ 사본이 없으면 **없다고 말한다**.
#
# 🔴 백업 한 벌 = DB 덤프 + 같은 시각 짝의 파일 아카이브(`hospitalrun-files_<TS>.tar.gz.gpg` · lib/backup-files.sh).
#    짝 아카이브가 있으면 함께 복사·검증한다. 둘 중 하나라도 실패하면 copyStatus 는 FAILED 다(DB 만 복사하고 "통과"라 말하지 않는다).
#
# 사용: backup-copy.sh [암호화된 백업 파일]      (인자 없으면 백업 디렉터리의 가장 최근 정기 백업)
# 설정(환경변수 우선 · 없으면 infra/scripts/deploy.env):
#   HIS_BACKUP_DIR               백업 디렉터리 — 기본 /home/deploy/backups/hospitalrun
#   HIS_BACKUP_COPY_TARGET       2차 사본 대상 — 로컬 경로(외장 매체 마운트 `/mnt/his-backup`) 또는 원격 `user@host:/path`
#   HIS_BACKUP_COPY_SSH_PORT     원격 SSH 포트 — 기본 22
# 종료 코드: 0 = 사본 검증 통과 또는 대상 미설정(🔴 사본 없음을 기록함) · 1 = 복사/검증 실패 · 2 = 평문 거부
#
# 상태 파일: ${HIS_BACKUP_DIR}/backup-status.json (한 줄 JSON · 키 순서 고정 — backup-verify.sh 와 감시자 `pipe.backup.*` 가 읽는다)
# 사본 원장: ${HIS_BACKUP_DIR}/copy-manifest.tsv  (파일명 · sha256 · 대상 · 검증 시각 — 검증 통과분만)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-${SCRIPT_DIR}/deploy.env}"
if [ -f "${DEPLOY_ENV_FILE}" ]; then
  # 파일 값은 **아직 비어 있는 변수에만**(환경변수 우선) — deploy.sh 와 같은 규칙
  while IFS='=' read -r _k _v || [ -n "${_k:-}" ]; do
    [[ "${_k}" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    if [ -z "${!_k:-}" ]; then export "${_k}=${_v}"; fi
  done < "${DEPLOY_ENV_FILE}"
fi
# shellcheck source=lib/backup-files.sh
source "${SCRIPT_DIR}/lib/backup-files.sh"

BACKUP_DIR="${HIS_BACKUP_DIR:-/home/deploy/backups/hospitalrun}"
COPY_TARGET="${HIS_BACKUP_COPY_TARGET:-}"
COPY_SSH_PORT="${HIS_BACKUP_COPY_SSH_PORT:-22}"
STATUS_FILE="${BACKUP_DIR}/backup-status.json"
MANIFEST_FILE="${BACKUP_DIR}/copy-manifest.tsv"
# 정기 백업 이름 — 정본 `apps/api/src/common/backup-files.ts` PERIODIC_BACKUP_PATTERN 과 같아야 한다(가드가 대조)
PERIODIC_RE='^hospitalrun_[0-9]{8}_[0-9]{6}\.sql\.gz(\.gpg)?$'

log() { echo "[$(date)] $*"; }
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}
size_of() { wc -c < "$1" | tr -d ' '; }
device_of() { stat -c %d "$1" 2>/dev/null || stat -f %d "$1"; }
# 파일 수정 시각(UTC ISO) — GNU/BSD 양쪽(서버 Linux · 로컬 검증 macOS)
mtime_iso() {
  local s
  s=$(stat -c %Y "$1" 2>/dev/null || stat -f %m "$1")
  date -u -d "@${s}" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "${s}" +%Y-%m-%dT%H:%M:%SZ
}

# JSON 문자열 이스케이프(백슬래시·따옴표·제어문자) — 값은 우리가 만든 문장·파일명·대상 경로뿐이다
json_str() {
  if [ -z "${1+x}" ] || [ "$1" = "__NULL__" ]; then printf 'null'; return; fi
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\n'/ }"; s="${s//$'\r'/ }"; s="${s//$'\t'/ }"
  printf '"%s"' "$s"
}
# 빈 값은 null(모름) — "" 를 0 으로 그리지 않는다
json_str_or_null() { if [ -z "${1:-}" ]; then printf 'null'; else json_str "$1"; fi; }
json_int_or_null() { if [[ "${1:-}" =~ ^[0-9]+$ ]]; then printf '%s' "$1"; else printf 'null'; fi; }

# 기존 상태 파일에서 한 키의 원문 값(따옴표 포함 JSON 조각)을 꺼낸다 — 복원 검증 필드를 덮어쓰지 않으려고
prev_raw() {
  local key="$1"
  [ -f "${STATUS_FILE}" ] || { printf 'null'; return; }
  local v
  v=$(grep -oE "\"${key}\":(null|true|false|-?[0-9]+|\"([^\"\\\\]|\\\\.)*\")" "${STATUS_FILE}" | head -1 | sed -E "s/^\"${key}\"://") || true
  [ -n "${v}" ] && printf '%s' "${v}" || printf 'null'
}

# 🔴 암호문인가 — 이름만 보지 않는다. gzip 매직(1f8b)이면 `.gpg` 로 이름만 바꾼 평문이다.
#    OpenPGP 대칭 암호문은 첫 바이트가 패킷 태그 3(구형 0x8c~0x8e · 신형 0xc3)이다.
is_encrypted_backup() {
  local f="$1"
  case "$f" in *.gpg) ;; *) return 1 ;; esac
  local head2
  head2=$(head -c 2 "$f" | od -An -tx1 | tr -d ' \n')
  [ "${head2}" != "1f8b" ] || return 1
  case "${head2:0:2}" in 8c|8d|8e|c3) return 0 ;; *) return 1 ;; esac
}

# 파일 아카이브 쪽 상태(main 이 채운다) — 기본은 "짝을 아직 보지 않았다"
FA_STATUS="NOT_RUN"; FA_FILE=""; FA_COUNT=""; FA_SHA=""; FA_MISSING=""; FA_DETAIL=""
FC_STATUS="NOT_ATTEMPTED"; FC_DETAIL=""

write_status() {
  # $1 copyStatus · $2 copyDetail · $3 copyAt(ISO|__NULL__) · $4 sameDevice(true|false|null) · $5 copySha256(|__NULL__)
  local copy_status="$1" copy_detail="$2" copy_at="$3" same_dev="$4" copy_sha="$5"
  local missing="true"
  if [ "${copy_status}" = "VERIFIED" ] && [ "${same_dev}" = "false" ]; then missing="false"; fi
  local kind="NONE"
  if [ -n "${COPY_TARGET}" ]; then
    case "${COPY_TARGET}" in /*) kind="LOCAL" ;; *@*:/*) kind="REMOTE" ;; *) kind="INVALID" ;; esac
  fi
  # 🔴 범위는 **실제로 담긴 것**만 — 파일 아카이브가 ARCHIVED 일 때만 DB+FILES(경로 없음·실패·암호화 불가는 DB_ONLY)
  local scope="DB_ONLY"
  [ "${FA_STATUS}" = "ARCHIVED" ] && scope="DB+FILES"
  local tmp="${STATUS_FILE}.tmp.$$"
  {
    printf '{"schema":1'
    printf ',"updatedAt":%s' "$(json_str "$(now_iso)")"
    printf ',"backupScope":"%s"' "${scope}"
    printf ',"lastBackupAt":%s' "$(json_str "${BK_AT}")"
    printf ',"lastBackupFile":%s' "$(json_str "${BK_NAME}")"
    printf ',"lastBackupBytes":%s' "${BK_BYTES}"
    printf ',"lastBackupSha256":%s' "$(json_str "${BK_SHA}")"
    printf ',"lastBackupEncrypted":%s' "${BK_ENC}"
    printf ',"copyTarget":%s' "$( [ -n "${COPY_TARGET}" ] && json_str "${COPY_TARGET}" || printf 'null')"
    printf ',"copyTargetKind":"%s"' "${kind}"
    printf ',"copyStatus":"%s"' "${copy_status}"
    printf ',"copyAt":%s' "$(json_str "${copy_at}")"
    printf ',"copySha256":%s' "$(json_str "${copy_sha}")"
    printf ',"copySameDeviceAsSource":%s' "${same_dev}"
    printf ',"copyDetail":%s' "$(json_str "${copy_detail}")"
    printf ',"secondCopyMissing":%s' "${missing}"
    printf ',"lastRestoreVerifiedAt":%s' "$(prev_raw lastRestoreVerifiedAt)"
    printf ',"lastRestoreVerifyLevel":%s' "$(prev_raw lastRestoreVerifyLevel)"
    printf ',"lastRestoreVerifyStatus":%s' "$(prev_raw lastRestoreVerifyStatus)"
    printf ',"lastRestoreVerifyFile":%s' "$(prev_raw lastRestoreVerifyFile)"
    printf ',"lastRestoreVerifyDetail":%s' "$(prev_raw lastRestoreVerifyDetail)"
    # 파일 아카이브(T10 · 2026-09-13) — 뒤에 덧붙인다(앞 키 순서는 고정)
    printf ',"filesArchiveStatus":"%s"' "${FA_STATUS}"
    printf ',"filesArchiveFile":%s' "$(json_str_or_null "${FA_FILE}")"
    printf ',"filesArchiveFileCount":%s' "$(json_int_or_null "${FA_COUNT}")"
    printf ',"filesArchiveSha256":%s' "$(json_str_or_null "${FA_SHA}")"
    printf ',"filesArchivePathsMissing":%s' "$(json_str_or_null "${FA_MISSING}")"
    printf ',"filesArchiveDetail":%s' "$(json_str_or_null "${FA_DETAIL}")"
    printf ',"filesCopyStatus":"%s"' "${FC_STATUS}"
    printf ',"filesCopyDetail":%s' "$(json_str_or_null "${FC_DETAIL}")"
    printf ',"lastFilesVerifyStatus":%s' "$(prev_raw lastFilesVerifyStatus)"
    printf ',"lastFilesVerifyDetail":%s' "$(prev_raw lastFilesVerifyDetail)"
    printf '}\n'
  } > "${tmp}"
  mv -f "${tmp}" "${STATUS_FILE}"
}

# 파일 하나를 사본 대상으로 복사·검증 — $1 원본 · $2 기대 크기 · $3 기대 sha256
# 결과: COPY_SHA · COPY_SAME_DEV(true|false) · 실패 시 COPY_ERR 에 사유 · return 0/1
copy_one() {
  local src="$1" want_bytes="$2" want_sha="$3" name dest
  name="$(basename "${src}")"
  COPY_SHA=""; COPY_SAME_DEV="null"; COPY_ERR=""
  case "${COPY_TARGET}" in
    /*)
      if [ ! -d "${COPY_TARGET}" ]; then
        COPY_ERR="대상 디렉터리가 없습니다(매체 미마운트 의심): ${COPY_TARGET}"; return 1
      fi
      dest="${COPY_TARGET%/}/${name}"
      # 부분 파일로 쓰고 검증 뒤에 이름을 붙인다 — 중간에 끊긴 사본을 사본으로 세지 않게
      cp -f "${src}" "${dest}.partial"
      COPY_SHA="$(sha256_of "${dest}.partial")"
      if [ "$(size_of "${dest}.partial")" != "${want_bytes}" ] || [ "${COPY_SHA}" != "${want_sha}" ]; then
        rm -f "${dest}.partial"
        COPY_ERR="사본이 원본과 다릅니다(크기 또는 sha256 불일치): ${name}"; return 1
      fi
      mv -f "${dest}.partial" "${dest}"
      # 🔴 같은 장치면 "사본"이 아니다 — 디스크 하나가 죽으면 둘 다 사라진다
      if [ "$(device_of "${src}")" = "$(device_of "${COPY_TARGET}")" ]; then COPY_SAME_DEV="true"; else COPY_SAME_DEV="false"; fi
      ;;
    *@*:/*)
      local host="${COPY_TARGET%%:*}" rpath="${COPY_TARGET#*:}"
      dest="${rpath%/}/${name}"
      if ! rsync -a -e "ssh -p ${COPY_SSH_PORT} -o BatchMode=yes" "${src}" "${host}:${dest}.partial"; then
        COPY_ERR="원격 복사(rsync) 실패: ${name}"; return 1
      fi
      COPY_SHA=$(ssh -p "${COPY_SSH_PORT}" -o BatchMode=yes "${host}" "sha256sum '${dest}.partial' 2>/dev/null || shasum -a 256 '${dest}.partial'" | awk '{print $1}') || COPY_SHA=""
      if [ "${COPY_SHA}" != "${want_sha}" ]; then
        COPY_ERR="원격 사본의 sha256 가 원본과 다르거나 확인하지 못했습니다: ${name}"; return 1
      fi
      ssh -p "${COPY_SSH_PORT}" -o BatchMode=yes "${host}" "mv -f '${dest}.partial' '${dest}'"
      # 원격은 다른 기계다 — 같은 장치일 수 없다
      COPY_SAME_DEV="false"
      ;;
    *)
      COPY_ERR="대상 형식이 틀렸습니다(로컬 절대경로 또는 user@host:/path): ${COPY_TARGET}"; return 1
      ;;
  esac
  return 0
}

main() {
  mkdir -p "${BACKUP_DIR}"
  local file="${1:-}"
  if [ -z "${file}" ]; then
    # 가장 최근 정기 백업(이름 패턴 정본과 같은 규칙 — 배포 백업 pre-deploy_* 는 정기 백업이 아니다)
    file=$(ls -1t "${BACKUP_DIR}" 2>/dev/null | grep -E "${PERIODIC_RE}" | head -1 || true)
    [ -n "${file}" ] && file="${BACKUP_DIR}/${file}"
  fi
  if [ -z "${file}" ] || [ ! -f "${file}" ]; then
    log "🔴 복사할 정기 백업 파일이 없다(${BACKUP_DIR}) — 상태 파일을 갱신하지 않는다(백업이 없다는 사실은 감시자 pipe.backup 이 말한다)"
    return 1
  fi

  BK_NAME="$(basename "${file}")"
  BK_AT="$(mtime_iso "${file}")"
  BK_BYTES="$(size_of "${file}")"
  BK_SHA="$(sha256_of "${file}")"
  BK_ENC=false
  # 같은 시각 짝의 파일 아카이브 기록(없으면 NOT_RUN — 파일은 이 백업에 없다)
  load_files_meta "$(dirname "${file}")" "$(files_ts_of "${file}")"
  if [ "${FA_STATUS}" = "ARCHIVED" ]; then FC_STATUS="NOT_ATTEMPTED"; else FC_STATUS="NOT_APPLICABLE"; FC_DETAIL="복사할 파일 아카이브가 없습니다(${FA_STATUS})"; fi

  # 🔴 평문은 절대 복사하지 않는다 — 사본이 늘수록 평문 환자 DB 가 퍼진다
  if ! is_encrypted_backup "${file}"; then
    log "🔴 평문 백업(${BK_NAME})은 복사하지 않는다 — 암호화(패스프레이즈 파일)부터 고쳐야 한다. 2차 사본 없음"
    write_status "REFUSED_PLAINTEXT" "평문 백업은 복사하지 않습니다(암호화되지 않은 파일) — 2차 사본이 없습니다" "__NULL__" "null" "__NULL__"
    return 2
  fi
  BK_ENC=true

  if [ -z "${COPY_TARGET}" ]; then
    [ "${FA_STATUS}" = "ARCHIVED" ] && { FC_STATUS="NOT_CONFIGURED"; FC_DETAIL="사본 대상 미설정 — 파일 아카이브도 원본과 같은 장치에만 있습니다"; }
    log "🔴 2차 사본 없음(백업이 원본과 같은 장치에 있다) — HIS_BACKUP_COPY_TARGET 미설정 · 저장소 형태는 사람 결정(T10 ③)"
    write_status "NOT_CONFIGURED" "2차 사본 없음 — 백업이 원본과 같은 장치에 있습니다(HIS_BACKUP_COPY_TARGET 미설정)" "__NULL__" "null" "__NULL__"
    return 0
  fi

  # DB 백업 사본
  if ! copy_one "${file}" "${BK_BYTES}" "${BK_SHA}"; then
    [ "${FA_STATUS}" = "ARCHIVED" ] && { FC_STATUS="NOT_ATTEMPTED"; FC_DETAIL="DB 백업 사본이 실패해 파일 아카이브 사본은 시도하지 않았습니다"; }
    log "🔴 ${COPY_ERR}"
    write_status "FAILED" "${COPY_ERR}" "__NULL__" "null" "__NULL__"
    return 1
  fi
  local same_dev="${COPY_SAME_DEV}" copy_sha="${COPY_SHA}"
  local at; at="$(now_iso)"
  printf '%s\t%s\t%s\t%s\n' "${BK_NAME}" "${BK_SHA}" "${COPY_TARGET}" "${at}" >> "${MANIFEST_FILE}"

  # 파일 아카이브 사본 — 🔴 짝 아카이브가 있는데 사본이 없으면 "사본 검증 통과"라고 말하지 않는다(copyStatus 는 백업 한 벌 전체를 말한다)
  if [ "${FA_STATUS}" = "ARCHIVED" ]; then
    local fa_path; fa_path="$(dirname "${file}")/${FA_FILE}"
    if [ ! -f "${fa_path}" ] || [ "$(sha256_of "${fa_path}")" != "${FA_SHA}" ]; then
      FC_STATUS="FAILED"; FC_DETAIL="파일 아카이브가 없거나 기록된 sha256 과 다릅니다(${FA_FILE})"
    elif ! is_encrypted_backup "${fa_path}"; then
      FC_STATUS="FAILED"; FC_DETAIL="파일 아카이브가 암호문이 아닙니다 — 복사하지 않았습니다(${FA_FILE})"
    elif ! copy_one "${fa_path}" "$(size_of "${fa_path}")" "${FA_SHA}"; then
      FC_STATUS="FAILED"; FC_DETAIL="파일 아카이브 사본 실패 — ${COPY_ERR}"
    else
      printf '%s\t%s\t%s\t%s\n' "${FA_FILE}" "${FA_SHA}" "${COPY_TARGET}" "$(now_iso)" >> "${MANIFEST_FILE}"
      FC_STATUS="VERIFIED"; FC_DETAIL="파일 아카이브 사본 검증 통과(크기·sha256 일치 · 파일 ${FA_COUNT}개)"
    fi
    if [ "${FC_STATUS}" = "FAILED" ]; then
      log "🔴 ${FC_DETAIL}"
      write_status "FAILED" "DB 사본은 검증됐지만 ${FC_DETAIL}" "__NULL__" "null" "__NULL__"
      return 1
    fi
  fi

  if [ "${same_dev}" = "true" ]; then
    log "🔴 사본은 검증됐지만 원본과 **같은 장치**다(${COPY_TARGET}) — 디스크 장애에 함께 사라진다. 2차 사본 없음으로 기록"
    write_status "VERIFIED" "사본은 원본과 같지만 같은 장치에 있습니다 — 디스크 장애에 함께 사라집니다" "${at}" "true" "${copy_sha}"
  else
    log "2차 사본 검증 통과 — ${COPY_TARGET} (sha256 ${BK_SHA:0:12}… · 파일 아카이브 ${FC_STATUS})"
    write_status "VERIFIED" "2차 사본 검증 통과(크기·sha256 일치)" "${at}" "false" "${copy_sha}"
  fi
  return 0
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
