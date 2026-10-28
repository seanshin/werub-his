# shellcheck shell=bash
# ============================================================================
# 설치본 산출물 기록 — `apps/api/BUILD_INFO.json` (install.sh 가 source 한다 · 2026-09-14)
#
# 🔴 왜: 리허설(2026-09-14)에서 설치본의 공개 버전 EP 가 `buildInfo: unavailable`·`commit: null` 이었다 —
#    deploy.sh 는 기록을 쓰는데 설치 경로는 쓰지 않아, **설치된 서버가 어느 릴리즈인지 증명할 길이 없었다.**
#
# 🔴 형식 정본은 `infra/scripts/deploy.sh` 의 `build_info_json` 이다. 이 파일은 같은 형식을 쓰고,
#    `apps/api/test/architecture/install-build-info.spec.ts` 가 **두 함수를 같은 입력으로 돌려 출력이 같은지** 기계 대조한다
#    (deploy.sh 를 고치지 않은 이유: 그 함수는 배포 체인 테스트가 텍스트로 떼어 실행한다 — 옮기면 그 가드가 헛돈다).
#    읽는 쪽 정본은 `apps/api/src/modules/health/build-info.ts` — hex 가 아닌 commit·boolean 이 아닌 dirty 는 `null` 로 읽는다.
#
# 🔴 **모르면 지어내지 않는다** — 커밋의 출처는 셋뿐이다:
#    git       설치 위치가 git 작업 트리의 **루트**다(다른 저장소 안에 풀어 둔 사본이 바깥 저장소의 HEAD 를 말하지 않게)
#    release   `git archive` 로 만든 릴리즈 사본 — `infra/install/RELEASE_COMMIT` 이 export-subst 로 치환돼 40자 hex 다
#              · dirty 는 **모름**(풀어 둔 뒤 누가 파일을 고쳤는지 알 수 없다)
#    unknown   둘 다 아니다 — commit·dirty 모두 null(빈 문자열·추정 커밋·"unknown" 문자열을 쓰지 않는다)
# ============================================================================

# his_build_info_json <constants.ts> <commit|""> <dirty: true|false|""> <source> [commitSource]
his_build_info_json() {
  local constants="$1" commit="${2:-}" dirty="${3:-}" source="$4" commit_source="${5:-}"
  local version c d extra=""
  version="$(grep -oE "HIS_VERSION = 'v[^']+'" "${constants}" | sed -E "s/.*'v([^']+)'/\1/" || true)"
  # 형식이 아닌 값은 기록하지 않는다 — 읽는 쪽이 어차피 null 로 읽지만, 파일에 틀린 값이 남으면 사람이 오독한다
  printf '%s' "${commit}" | grep -Eq '^[0-9a-f]{7,40}$' || commit=""
  case "${dirty}" in true|false) ;; *) dirty="" ;; esac
  c="${commit:+\"${commit}\"}"; c="${c:-null}"
  d="${dirty:-null}"
  [ -n "${commit_source}" ] && extra=",\"commitSource\":\"${commit_source}\""
  printf '{"version":"%s","commit":%s,"dirty":%s,"builtAt":"%s","source":"%s"%s}' \
    "${version}" "${c}" "${d}" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "${source}" "${extra}"
}

# his_resolve_commit <root> — 전역 HIS_BUILD_COMMIT · HIS_BUILD_DIRTY · HIS_BUILD_COMMIT_SOURCE 를 채운다
his_resolve_commit() {
  local root="$1" top changes rel
  HIS_BUILD_COMMIT=""; HIS_BUILD_DIRTY=""; HIS_BUILD_COMMIT_SOURCE="unknown"
  if command -v git >/dev/null 2>&1 && top="$(git -C "${root}" rev-parse --show-toplevel 2>/dev/null)" \
     && [ "$(cd "${top}" && pwd -P)" = "$(cd "${root}" && pwd -P)" ]; then
    HIS_BUILD_COMMIT="$(git -C "${root}" rev-parse HEAD 2>/dev/null || true)"
    if [ -n "${HIS_BUILD_COMMIT}" ]; then
      HIS_BUILD_COMMIT_SOURCE="git"
      # deploy.sh 와 같은 범위 — 산출물에 들어가는 경로만 본다
      changes="$(git -C "${root}" status --porcelain --untracked-files=all -- apps packages infra scripts package.json package-lock.json 2>/dev/null)" \
        && { [ -z "${changes}" ] && HIS_BUILD_DIRTY="false" || HIS_BUILD_DIRTY="true"; }
      return 0
    fi
  fi
  rel="$(tr -d '[:space:]' < "${root}/infra/install/RELEASE_COMMIT" 2>/dev/null || true)"
  if printf '%s' "${rel}" | grep -Eq '^[0-9a-f]{40}$'; then
    HIS_BUILD_COMMIT="${rel}"; HIS_BUILD_DIRTY=""; HIS_BUILD_COMMIT_SOURCE="release"
  fi
  return 0
}
