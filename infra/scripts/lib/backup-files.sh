#!/bin/bash
# Hospital RUN — 파일 저장소 아카이브 공용 함수 (상용 릴리즈 T10 · 2026-09-13)
#
# 🔴 왜: 정기 백업이 DB 덤프뿐이었다. DB 만 복원하면 첨부·원음·서류 **행**은 돌아오는데 가리키는 **파일**이 없다
#    (화면 404 · MediaService 자가 복구는 파일→DB 방향이라 못 살린다). 근거 docs/05-reference/record-transfer-inventory.md §1.2
#
# 이 파일은 backup.sh · backup-copy.sh · backup-verify.sh 가 `source` 한다(실행하지 않는다).
#
# 짝 규칙: DB 백업 `hospitalrun_<TS>.sql.gz[.gpg]` ↔ 파일 아카이브 `hospitalrun-files_<TS>.tar.gz.gpg` + 기록 `hospitalrun-files_<TS>.meta`
#   🔴 이름이 정기 백업 정본 패턴(`^hospitalrun_…`)에 걸리지 않게 `hospitalrun-files_` 로 둔다 — 걸리면 감시자·go-live 가 파일 아카이브를 DB 백업으로 센다.
#   🔴 복원은 **같은 <TS> 짝**으로만 한다(행↔파일이 맞는 시점이 그것뿐이다).
#
# meta 상태(`status=`):
#   ARCHIVED       경로 1개 이상을 담아 암호화했고, 복호화한 목록 수 = 원본 파일 수를 확인했다(파일 0개도 ARCHIVED · fileCount=0)
#   NO_PATHS       대상 경로가 **하나도 없다**(파일 0개와 다른 사실이다)
#   NOT_ENCRYPTED  gpg/패스프레이즈 없음 — 🔴 평문 아카이브는 만들지 않는다(환자 파일 평문 사본을 늘리지 않는다)
#   FAILED         tar/gpg 실패 또는 목록 수 불일치 — 아카이브를 남기지 않는다

# 대상 경로(앱 루트 기준) — API cwd 가 apps/api 라 `uploads/`·`storage/` 가 거기 생긴다
#   (encounter.service·scribe.service `join(process.cwd(), 'storage', …)` · main.ts `/uploads`)
#   루트 `uploads/` 는 저장소 루트 cwd 로 도는 프로세스(감시자)가 만든 것으로 추정 — 있으면 함께 담는다
BACKUP_FILE_PATHS=(apps/api/uploads apps/api/storage uploads)

files_ts_of() {
  # DB 백업 파일 이름에서 <TS> — 정기 백업 이름이 아니면 빈 문자열
  local n; n="$(basename "$1")"
  if [[ "${n}" =~ ^hospitalrun_([0-9]{8}_[0-9]{6})\.sql\.gz(\.gpg)?$ ]]; then printf '%s' "${BASH_REMATCH[1]}"; fi
}
files_archive_path() { printf '%s/hospitalrun-files_%s.tar.gz.gpg' "$1" "$2"; }   # $1 dir · $2 TS
files_meta_path() { printf '%s/hospitalrun-files_%s.meta' "$1" "$2"; }

_bf_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

# 암호화 아카이브의 파일(디렉터리 아닌 항목) 수 — 복호화·압축 해제가 실패하면 return 1
files_archive_entry_count() {
  local archive="$1" pp="$2" listing rc_g rc_t
  listing=$(gpg --batch --quiet --decrypt --passphrase-file "${pp}" "${archive}" 2>/dev/null | tar -tzf - 2>/dev/null; echo "__RC__ ${PIPESTATUS[0]} ${PIPESTATUS[1]}")
  read -r _ rc_g rc_t <<< "$(printf '%s\n' "${listing}" | tail -1)"
  if [ "${rc_g}" != "0" ] || [ "${rc_t}" != "0" ]; then return 1; fi
  printf '%s\n' "${listing}" | sed '$d' | { grep -v '/$' || true; } | { grep -c . || true; }
}

_bf_write_meta() {
  # $1 meta 경로 · 나머지 key=value 줄
  local meta="$1"; shift
  local tmp="${meta}.tmp.$$"
  printf '%s\n' "$@" > "${tmp}"
  mv -f "${tmp}" "${meta}"
}

# 파일 아카이브를 만든다 — $1 앱 루트 · $2 백업 디렉터리 · $3 TS · $4 패스프레이즈 파일
# 반환: 0 = ARCHIVED 또는 NO_PATHS · 1 = FAILED · 2 = NOT_ENCRYPTED  (결과는 항상 meta 에 남는다)
create_files_archive() {
  local root="$1" dir="$2" ts="$3" pp="$4"
  local archive meta; archive="$(files_archive_path "${dir}" "${ts}")"; meta="$(files_meta_path "${dir}" "${ts}")"
  local included=() missing=() p count=0 c
  for p in "${BACKUP_FILE_PATHS[@]}"; do
    if [ -d "${root}/${p}" ]; then
      included+=("${p}")
      c=$(find "${root}/${p}" \( -type f -o -type l \) | wc -l | tr -d ' ')
      count=$((count + c))
    else
      missing+=("${p}")
    fi
  done
  local inc_s="" miss_s=""
  if [ "${#included[@]}" -gt 0 ]; then inc_s="$(IFS=,; printf '%s' "${included[*]}")"; fi
  if [ "${#missing[@]}" -gt 0 ]; then miss_s="$(IFS=,; printf '%s' "${missing[*]}")"; fi

  if [ "${#included[@]}" -eq 0 ]; then
    _bf_write_meta "${meta}" "status=NO_PATHS" "fileCount=" "bytes=" "sha256=" "included=" "missing=${miss_s}" \
      "detail=대상 경로가 하나도 없습니다(${miss_s}) — 파일 0개가 아니라 저장소 자체가 없습니다(앱 루트 ${root})"
    echo "[$(date)] 🔴 파일 아카이브 — 대상 경로 없음(${miss_s} · 앱 루트 ${root}) — 담을 파일 저장소가 없다"
    return 0
  fi
  if ! command -v gpg >/dev/null 2>&1 || [ ! -r "${pp}" ]; then
    _bf_write_meta "${meta}" "status=NOT_ENCRYPTED" "fileCount=${count}" "bytes=" "sha256=" "included=${inc_s}" "missing=${miss_s}" \
      "detail=gpg 또는 패스프레이즈 파일이 없어 파일 아카이브를 만들지 않았습니다(평문 아카이브는 만들지 않음) — 파일 ${count}개가 백업에 없습니다"
    echo "[$(date)] 🔴 파일 아카이브 생략 — 암호화 불가(gpg/패스프레이즈 없음) · 평문으로는 만들지 않는다 · 파일 ${count}개 미백업"
    return 2
  fi

  # tar | gpg 두 단계의 종료 코드를 각각 본다 — 🔴 tar 실패를 gpg 성공이 가리지 않게
  local had_e=0 old_umask rc_t rc_g
  case "$-" in *e*) had_e=1 ;; esac
  old_umask="$(umask)"
  rm -f "${archive}.partial"
  set +e
  umask 077
  tar -czf - -C "${root}" "${included[@]}" 2>"${archive}.tar-err" \
    | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file "${pp}" --output "${archive}.partial"
  # 🔴 PIPESTATUS 는 다음 명령(대입 포함)에서 바로 덮인다 — 한 번에 배열로 받는다
  local ps=("${PIPESTATUS[@]}")
  rc_t="${ps[0]:-99}"; rc_g="${ps[1]:-99}"
  umask "${old_umask}"
  [ "${had_e}" = "1" ] && set -e

  if [ "${rc_t}" != "0" ] || [ "${rc_g}" != "0" ] || [ ! -s "${archive}.partial" ]; then
    local err; err="$(tr '\n' ' ' < "${archive}.tar-err" 2>/dev/null | cut -c1-300)"
    rm -f "${archive}.partial" "${archive}.tar-err"
    _bf_write_meta "${meta}" "status=FAILED" "fileCount=${count}" "bytes=" "sha256=" "included=${inc_s}" "missing=${miss_s}" \
      "detail=아카이브 생성 실패(tar ${rc_t} · gpg ${rc_g}) ${err}"
    echo "[$(date)] 🔴 파일 아카이브 실패(tar ${rc_t} · gpg ${rc_g}) — 파일 ${count}개가 이번 백업에 없다 ${err}"
    return 1
  fi
  rm -f "${archive}.tar-err"

  # 🔴 만든 직후 열어 본다 — 목록 수가 원본 파일 수와 다르면 아카이브로 세지 않는다
  local listed=""
  if ! listed=$(files_archive_entry_count "${archive}.partial" "${pp}") || [ "${listed}" != "${count}" ]; then
    rm -f "${archive}.partial"
    _bf_write_meta "${meta}" "status=FAILED" "fileCount=${count}" "bytes=" "sha256=" "included=${inc_s}" "missing=${miss_s}" \
      "detail=아카이브를 열어 본 목록 수(${listed:-열지 못함})가 원본 파일 수(${count})와 다릅니다"
    echo "[$(date)] 🔴 파일 아카이브 검증 실패 — 목록 ${listed:-열지 못함} ≠ 원본 ${count}"
    return 1
  fi
  mv -f "${archive}.partial" "${archive}"
  local bytes sha; bytes=$(wc -c < "${archive}" | tr -d ' '); sha="$(_bf_sha256 "${archive}")"
  _bf_write_meta "${meta}" "status=ARCHIVED" "fileCount=${count}" "bytes=${bytes}" "sha256=${sha}" "included=${inc_s}" "missing=${miss_s}" \
    "detail=파일 ${count}개 암호화 아카이브(${inc_s}${miss_s:+ · 없는 경로 ${miss_s}})"
  echo "[$(date)] 파일 아카이브 완료 — $(basename "${archive}") · 파일 ${count}개 · ${bytes} 바이트${miss_s:+ · 없는 경로 ${miss_s}}"
  return 0
}

# 짝 meta 를 읽어 FA_* 변수로 — meta 가 없으면 FA_STATUS=NOT_RUN(파일 단계가 생기기 전 백업이거나 단계가 돌지 않았다)
load_files_meta() {
  local dir="$1" ts="$2"
  FA_STATUS="NOT_RUN"; FA_FILE=""; FA_COUNT=""; FA_BYTES=""; FA_SHA=""; FA_INCLUDED=""; FA_MISSING=""
  FA_DETAIL="이 백업에 짝지은 파일 아카이브 기록이 없습니다(파일 단계 이전 백업이거나 단계가 돌지 않음) — 파일은 백업에 없습니다"
  if [ -z "${ts}" ]; then FA_DETAIL="백업 이름에서 시각을 읽지 못해 파일 아카이브 짝을 찾지 못했습니다"; return 0; fi
  local meta; meta="$(files_meta_path "${dir}" "${ts}")"
  [ -f "${meta}" ] || return 0
  local k v
  while IFS='=' read -r k v || [ -n "${k:-}" ]; do
    case "${k}" in
      status) FA_STATUS="${v}" ;; fileCount) FA_COUNT="${v}" ;; bytes) FA_BYTES="${v}" ;; sha256) FA_SHA="${v}" ;;
      included) FA_INCLUDED="${v}" ;; missing) FA_MISSING="${v}" ;; detail) FA_DETAIL="${v}" ;;
    esac
  done < "${meta}"
  if [ "${FA_STATUS}" = "ARCHIVED" ]; then FA_FILE="$(basename "$(files_archive_path "${dir}" "${ts}")")"; fi
  return 0
}
